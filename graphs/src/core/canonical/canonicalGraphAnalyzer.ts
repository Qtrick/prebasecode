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
import { ParserEngine } from '../parsing/parserEngine.js';
import { computeCanonicalGraphDigest } from './canonicalGraphDigest.js';
import type { CancellationTokenLike, IRepositoryContentSource } from './contentSource.js';
import { createCurrentVersionMetadata } from './versioning.js';

const DEFAULT_MAX_CANONICAL_FILES = 10_000;
const DEFAULT_MAX_FILE_SIZE_BYTES = 500_000;

function stableCompare(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

export class CanonicalGraphAnalyzer {
	private readonly _maxCanonicalFiles: number;
	private readonly _maxFileSizeBytes: number;
	private readonly _includeFolders: boolean;
	private readonly _includeFunctions: boolean;
	private readonly _parserEngine: ParserEngine;

	constructor(options: CanonicalAnalysisOptions = {}) {
		this._maxCanonicalFiles = options.maxCanonicalFiles ?? DEFAULT_MAX_CANONICAL_FILES;
		this._maxFileSizeBytes = options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;
		this._includeFolders = options.includeFolders ?? false;
		this._includeFunctions = options.includeFunctions ?? false;
		this._parserEngine = new ParserEngine();
	}

	async analyze(
		contentSource: IRepositoryContentSource,
		token?: CancellationTokenLike
	): Promise<CanonicalGraphSnapshot | undefined> {
		if (token?.isCancellationRequested) {
			return undefined;
		}

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

		// Populate architectureLayer in analysis manifest entries
		const nodeLayerMap = new Map<string, string>();
		for (const node of layeredNodes) {
			if (node.path && node.meta?.architectureLayer) {
				nodeLayerMap.set(node.path, node.meta.architectureLayer);
			}
		}
		const enrichedManifestEntries: AnalysisManifestEntry[] = manifestEntries.map(entry => ({
			...entry,
			architectureLayer: nodeLayerMap.get(entry.path),
		}));

		// Normalize node and edge ordering deterministically using code-unit comparator
		const sortedNodes: GraphNode[] = [...layeredNodes].sort((a, b) => stableCompare(a.id, b.id));
		const sortedEdges: GraphEdge[] = [...partial.edges].sort((a, b) => stableCompare(a.id, b.id));

		const digest = computeCanonicalGraphDigest({
			nodes: sortedNodes,
			edges: sortedEdges,
			entryNodeId,
		});

		const totalExcluded = Object.values(exclusionBreakdown).reduce((a, b) => a + b, 0);
		const completeWithinProfile = !isTruncated && failedCount === 0;
		const discoveredCount = Math.max(inventory.discoveredCount, rawFiles.length);

		const coverage: CanonicalCoverage = {
			completeWithinProfile,
			isComplete: completeWithinProfile,
			discoveredCount,
			analyzedCount: parseResults.length,
			analyzedFileCount: parseResults.length,
			excludedCount: totalExcluded,
			excludedFileCount: totalExcluded,
			failedCount,
			truncated: isTruncated,
			truncationReason: isTruncated
				? (inventory.truncationReason ?? `Exceeded maxCanonicalFiles budget of ${this._maxCanonicalFiles}`)
				: undefined,
			exclusionBreakdown,
			exclusionReasons: exclusionBreakdown,
			skippedFiles: skippedFiles.length > 0 ? skippedFiles : undefined,
		};

		const manifest: AnalysisManifest = {
			entries: enrichedManifestEntries,
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

			const content = await contentSource.readFile(file.relativePath, token);
			if (content === undefined) {
				recordExclusion(file.relativePath, 'parse-error');
				return undefined;
			}

			const actualSize = fileSize ?? content.length;
			if (content.length > this._maxFileSizeBytes) {
				recordExclusion(file.relativePath, 'oversized-file');
				return undefined;
			}

			// Binary guard
			if (this._isLikelyBinary(content)) {
				recordExclusion(file.relativePath, 'binary-file');
				return undefined;
			}

			// Use ParserEngine with content override for full Babel AST / fallback / Vue / Svelte parity
			const parseResult = await this._parserEngine.parseFile(file, content);
			if (!parseResult) {
				recordExclusion(file.relativePath, 'parse-error');
				return undefined;
			}

			let contentIdentity: string | undefined;
			if (contentSource.getContentIdentity) {
				try {
					contentIdentity = await contentSource.getContentIdentity(file.relativePath);
				} catch {
					contentIdentity = undefined;
				}
			}

			const manifestEntry: AnalysisManifestEntry = {
				path: file.relativePath,
				contentIdentity,
				size: actualSize,
				analyzedAt: Date.now(),
				isComponent: !!parseResult.isComponentFile,
			};

			return { parseResult, manifestEntry };
		} catch {
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
