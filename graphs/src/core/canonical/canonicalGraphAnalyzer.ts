/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type {
	AnalysisManifest,
	AnalysisManifestEntry,
	CanonicalAnalysisOptions,
	CanonicalCoverage,
	CanonicalExclusionCode,
	CanonicalGraphSnapshot,
} from '../../common/types/canonicalTypes.js';
import type { GraphEdge, GraphNode, ParseResult, ScannedFile } from '../../common/types/graphTypes.js';
import { assignLayersToNodes } from '../analysis/architectureLayers.js';
import { detectEntryNodeId } from '../analysis/entryDetector.js';
import { GraphGenerator } from '../generation/graphGenerator.js';
import { computeCanonicalGraphDigest } from './canonicalGraphDigest.js';
import type { CancellationTokenLike, IRepositoryContentSource } from './contentSource.js';
import { createCurrentVersionMetadata } from './versioning.js';
import { CanonicalParseServiceError, type ICanonicalParseService, UnavailableCanonicalParseService } from './canonicalParseService.js';

import {
	type BlobParseArtifact,
	type ICanonicalParseArtifactCache,
	materializeParseResult,
} from './parseArtifactCache.js';

const DEFAULT_MAX_CANONICAL_FILES = 10_000;
const DEFAULT_MAX_FILE_SIZE_BYTES = 500_000;
const utf8Encoder = new TextEncoder();

function stableCompare(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

export class CanonicalGraphAnalyzer {
	private readonly _maxCanonicalFiles: number;
	private readonly _maxFileSizeBytes: number;
	private readonly _includeFolders: boolean;
	private readonly _includeFunctions: boolean;
	private readonly _parseService: ICanonicalParseService;
	private readonly _parseArtifactCache?: ICanonicalParseArtifactCache;

	constructor(options: CanonicalAnalysisOptions = {}) {
		this._maxCanonicalFiles = options.maxCanonicalFiles ?? DEFAULT_MAX_CANONICAL_FILES;
		this._maxFileSizeBytes = options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;
		this._includeFolders = options.includeFolders ?? false;
		this._includeFunctions = options.includeFunctions ?? false;
		this._parseArtifactCache = options.parseArtifactCache;
		this._parseService = options.parseService ?? new UnavailableCanonicalParseService();
	}

	async analyze(
		contentSource: IRepositoryContentSource,
		token?: CancellationTokenLike
	): Promise<CanonicalGraphSnapshot | undefined> {
		if (token?.isCancellationRequested) {
			return undefined;
		}

		const startTime = Date.now();
		const inventory = await contentSource.listFiles(token);
		if (token?.isCancellationRequested) {
			return undefined;
		}

		const rawFiles = inventory.files;
		const isTruncated = inventory.isTruncated || rawFiles.length > this._maxCanonicalFiles;
		const files = rawFiles.slice(0, this._maxCanonicalFiles);

		const exclusionBreakdown: Record<CanonicalExclusionCode, number> = {
			'oversized-file': 0,
			'binary-file': 0,
			'unsupported-language': 0,
			'parse-error': 0,
			'permission-denied': 0,
			'ignored-pattern': 0,
			'policy-excluded': 0,
			'other': 0,
		};
		const skippedFiles: string[] = [];
		let failedCount = 0;

		const recordExclusion = (path: string, code: CanonicalExclusionCode) => {
			exclusionBreakdown[code] = (exclusionBreakdown[code] ?? 0) + 1;
			if (code === 'parse-error') {
				failedCount++;
			}
			if (skippedFiles.length < 50) {
				skippedFiles.push(path);
			}
		};

		const parseResults: ParseResult[] = [];
		const manifestEntries: AnalysisManifestEntry[] = [];
		const batchSize = 16;

		for (let i = 0; i < files.length; i += batchSize) {
			if (token?.isCancellationRequested) {
				return undefined;
			}
			const batch = files.slice(i, i + batchSize);
			const parsedBatch = await Promise.all(
				batch.map(file => this._parseSingleFile(contentSource, file, recordExclusion, token))
			);
			for (const item of parsedBatch) {
				if (item) {
					parseResults.push(item.parseResult);
					manifestEntries.push(item.manifestEntry);
				}
			}
		}

		if (token?.isCancellationRequested) {
			return undefined;
		}

		const generator = new GraphGenerator({
			includeFolders: this._includeFolders,
			includeFunctions: this._includeFunctions,
		});

		const projectName = contentSource.projectName || 'workspace';
		const partial = generator.buildFromParseResults(contentSource.rootPath, projectName, parseResults);

		let packageMain: string | null = null;
		if (contentSource.readPackageMain) {
			try {
				packageMain = await contentSource.readPackageMain(token);
			} catch {
				packageMain = null;
			}
		}

		if (token?.isCancellationRequested) {
			return undefined;
		}

		const entryNodeId = detectEntryNodeId(contentSource.rootPath, partial.nodes, partial.edges, packageMain);
		const layeredNodes = assignLayersToNodes(partial.nodes, entryNodeId);

		// Populate architectureLayer and language in analysis manifest entries
		const nodeMetaMap = new Map<string, { layer?: string; language?: string }>();
		for (const node of layeredNodes) {
			if (node.path) {
				nodeMetaMap.set(node.path, {
					layer: node.meta?.architectureLayer,
					language: node.meta?.language,
				});
			}
		}
		const enrichedManifestEntries: AnalysisManifestEntry[] = manifestEntries.map(entry => {
			const meta = nodeMetaMap.get(entry.path);
			return {
				...entry,
				architectureLayer: meta?.layer,
				language: meta?.language,
			};
		});

		// Normalize node and edge ordering deterministically using code-unit comparator
		const sortedNodes: GraphNode[] = [...layeredNodes].sort((a, b) => stableCompare(a.id, b.id));
		const sortedEdges: GraphEdge[] = [...partial.edges].sort((a, b) => stableCompare(a.id, b.id));

		const digest = computeCanonicalGraphDigest({
			nodes: sortedNodes,
			edges: sortedEdges,
			entryNodeId,
		});

		const totalExcluded = Object.values(exclusionBreakdown).reduce((a, b) => a + b, 0);
		// Files inside the supported profile that exceed the source-size budget leave
		// the canonical state partial just like parser failures. Treating such a commit
		// as complete would make persisted Temporal status falsely become `ready`.
		const completeWithinProfile = !isTruncated && failedCount === 0 && exclusionBreakdown['oversized-file'] === 0;
		const discoveredCount = Math.max(inventory.discoveredCount, rawFiles.length);

		const coverage: CanonicalCoverage = {
			completeWithinProfile,
			isComplete: completeWithinProfile,
			discoveredCount,
			analyzedCount: manifestEntries.length,
			analyzedFileCount: manifestEntries.length,
			excludedCount: totalExcluded,
			excludedFileCount: totalExcluded,
			failedCount,
			truncated: isTruncated,
			truncationReason: isTruncated
				? (inventory.truncationReason ?? `Exceeded max canonical file budget of ${this._maxCanonicalFiles}`)
				: undefined,
			exclusionBreakdown,
			exclusionReasons: exclusionBreakdown,
			skippedFiles: skippedFiles.length > 0 ? skippedFiles : undefined,
		};

		const durationMs = Date.now() - startTime;
		const manifest: AnalysisManifest = {
			entries: enrichedManifestEntries,
			runMetadata: {
				analyzedAt: startTime,
				durationMs,
			},
		};

		return {
			nodes: sortedNodes,
			edges: sortedEdges,
			projectPath: contentSource.rootPath,
			projectName,
			entryNodeId,
			analyzedAt: Date.now(),
			sourceIdentity: contentSource.identity,
			digest,
			versions: createCurrentVersionMetadata(),
			coverage,
			completeness: coverage,
			manifest,
		};
	}

	private async _parseSingleFile(
		contentSource: IRepositoryContentSource,
		file: ScannedFile,
		recordExclusion: (path: string, code: CanonicalExclusionCode) => void,
		token?: CancellationTokenLike
	): Promise<{ parseResult: ParseResult; manifestEntry: AnalysisManifestEntry } | undefined> {
		if (token?.isCancellationRequested) {
			return undefined;
		}

		try {
			let fileSize: number | undefined;
			if (contentSource.getFileSize) {
				fileSize = await contentSource.getFileSize(file.relativePath);
				if (typeof fileSize === 'number' && fileSize > this._maxFileSizeBytes) {
					recordExclusion(file.relativePath, 'oversized-file');
					return undefined;
				}
			}

			let contentIdentity: string | undefined = file.blobOid;
			if (!contentIdentity && contentSource.getContentIdentity) {
				try {
					contentIdentity = await contentSource.getContentIdentity(file.relativePath);
				} catch {
					contentIdentity = undefined;
				}
			}

			// 1. Check path-independent parse artifact cache
			if (contentIdentity && this._parseArtifactCache) {
				try {
					const cachedArtifact = await this._parseArtifactCache.get(contentIdentity, file.extension);
					if (cachedArtifact) {
						const parseResult = materializeParseResult(file, cachedArtifact);
						const manifestEntry: AnalysisManifestEntry = {
							path: file.relativePath,
							contentIdentity,
							size: fileSize ?? 0,
							isComponent: Boolean(parseResult.isComponentFile),
							language: cachedArtifact.language,
						};
						return { parseResult, manifestEntry };
					}
				} catch {
					// Cache miss -> fallback to full parse
				}
			}

			const content = await contentSource.readFile(file.relativePath);
			if (content === undefined || token?.isCancellationRequested) {
				if (content === undefined) {
					recordExclusion(file.relativePath, 'parse-error');
				}
				return undefined;
			}

			const actualSize = fileSize ?? utf8Encoder.encode(content).byteLength;
			if (actualSize > this._maxFileSizeBytes) {
				recordExclusion(file.relativePath, 'oversized-file');
				return undefined;
			}

			// Binary guard
			if (this._isLikelyBinary(content)) {
				recordExclusion(file.relativePath, 'binary-file');
				return undefined;
			}

			let artifact: BlobParseArtifact | undefined;
			try {
				artifact = await this._parseService.parse({ file, content }, token);
			} catch (err) {
				if (err instanceof CanonicalParseServiceError && (err.code === 'service-unavailable' || err.code === 'worker-terminated')) {
					throw err;
				}
				recordExclusion(file.relativePath, 'parse-error');
				return undefined;
			}
			if (!artifact) {
				recordExclusion(file.relativePath, 'parse-error');
				return undefined;
			}
			const parseResult = materializeParseResult(file, artifact);

			// 2. Store extracted path-independent parse artifact in cache
			if (contentIdentity && this._parseArtifactCache) {
				try {
				await this._parseArtifactCache.set(contentIdentity, file.extension, artifact);
				} catch {
					// Non-fatal cache store failure
				}
			}

			const manifestEntry: AnalysisManifestEntry = {
				path: file.relativePath,
				contentIdentity,
				size: actualSize,
				isComponent: !!parseResult.isComponentFile,
			};

			return { parseResult, manifestEntry };
		} catch (error) {
			if (error instanceof CanonicalParseServiceError) {
				if (error.code === 'cancelled') {
					return undefined;
				}
				throw error;
			}
			recordExclusion(file.relativePath, 'parse-error');
			return undefined;
		}
	}

	private _isLikelyBinary(content: string): boolean {
		const sampleLength = Math.min(content.length, 1024);
		for (let i = 0; i < sampleLength; i++) {
			if (content.charCodeAt(i) === 0) {
				return true;
			}
		}
		return false;
	}
}
