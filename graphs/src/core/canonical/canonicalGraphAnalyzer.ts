/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type {
	CanonicalAnalysisOptions,
	CanonicalCompleteness,
	CanonicalGraphSnapshot,
} from '../../common/types/canonicalTypes.js';
import type { GraphEdge, GraphNode, ParseResult, ScannedFile } from '../../common/types/graphTypes.js';
import { assignLayersToNodes } from '../analysis/architectureLayers.js';
import { detectEntryNodeId } from '../analysis/entryDetector.js';
import { GraphGenerator } from '../generation/graphGenerator.js';
import { extractImportsForFile, extractPackageName } from '../parsing/importExtractors.js';
import { computeCanonicalGraphDigest } from './canonicalGraphDigest.js';
import type { CancellationTokenLike, IRepositoryContentSource } from './contentSource.js';
import { createCurrentVersionMetadata } from './versioning.js';

const DEFAULT_MAX_CANONICAL_FILES = 10_000;
const DEFAULT_MAX_FILE_SIZE_BYTES = 500_000;

export class CanonicalGraphAnalyzer {
	private readonly _maxCanonicalFiles: number;
	private readonly _maxFileSizeBytes: number;
	private readonly _includeFolders: boolean;
	private readonly _includeFunctions: boolean;

	constructor(options: CanonicalAnalysisOptions = {}) {
		this._maxCanonicalFiles = options.maxCanonicalFiles ?? DEFAULT_MAX_CANONICAL_FILES;
		this._maxFileSizeBytes = options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;
		this._includeFolders = options.includeFolders ?? false;
		this._includeFunctions = options.includeFunctions ?? false;
	}

	async analyze(
		contentSource: IRepositoryContentSource,
		token?: CancellationTokenLike
	): Promise<CanonicalGraphSnapshot | undefined> {
		if (token?.isCancellationRequested) {
			return undefined;
		}

		const rawFiles = await contentSource.listFiles(token);
		if (token?.isCancellationRequested) {
			return undefined;
		}

		const files = rawFiles.slice(0, this._maxCanonicalFiles);

		const exclusionReasons: Record<string, number> = {};
		const skippedFiles: string[] = [];

		const recordExclusion = (path: string, reason: string) => {
			exclusionReasons[reason] = (exclusionReasons[reason] ?? 0) + 1;
			if (skippedFiles.length < 50) {
				skippedFiles.push(path);
			}
		};

		const parseResults: ParseResult[] = [];
		const batchSize = 16;

		for (let i = 0; i < files.length; i += batchSize) {
			if (token?.isCancellationRequested) {
				return undefined;
			}
			const batch = files.slice(i, i + batchSize);
			const parsedBatch = await Promise.all(
				batch.map(file => this._parseSingleFile(contentSource, file, recordExclusion, token))
			);
			for (const result of parsedBatch) {
				if (result) {
					parseResults.push(result);
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

		// Normalize node and edge ordering deterministically
		const sortedNodes: GraphNode[] = [...layeredNodes].sort((a, b) => a.id.localeCompare(b.id));
		const sortedEdges: GraphEdge[] = [...partial.edges].sort((a, b) => a.id.localeCompare(b.id));

		const digest = computeCanonicalGraphDigest({
			nodes: sortedNodes,
			edges: sortedEdges,
			entryNodeId,
		});

		const completeness: CanonicalCompleteness = {
			isComplete: Object.keys(exclusionReasons).length === 0,
			analyzedFileCount: parseResults.length,
			excludedFileCount: files.length - parseResults.length,
			exclusionReasons,
			skippedFiles: skippedFiles.length > 0 ? skippedFiles : undefined,
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
			completeness,
		};
	}

	private async _parseSingleFile(
		contentSource: IRepositoryContentSource,
		file: ScannedFile,
		recordExclusion: (path: string, reason: string) => void,
		token?: CancellationTokenLike
	): Promise<ParseResult | undefined> {
		if (token?.isCancellationRequested) {
			return undefined;
		}

		try {
			if (contentSource.getFileSize) {
				const size = await contentSource.getFileSize(file.relativePath);
				if (typeof size === 'number' && size > this._maxFileSizeBytes) {
					recordExclusion(file.relativePath, 'oversized-file');
					return undefined;
				}
			}

			const content = await contentSource.readFile(file.relativePath, token);
			if (content === undefined) {
				recordExclusion(file.relativePath, 'file-read-error');
				return undefined;
			}

			if (content.length > this._maxFileSizeBytes) {
				recordExclusion(file.relativePath, 'oversized-file');
				return undefined;
			}

			// Binary guard
			if (this._isLikelyBinary(content)) {
				recordExclusion(file.relativePath, 'binary-file');
				return undefined;
			}

			const imports = extractImportsForFile(file, content);
			const packageName = extractPackageName(file, content);
			const exports: ParseResult['exports'] = [];

			const exportRe = /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+([A-Za-z0-9_]+)/g;
			let match: RegExpExecArray | null;
			while ((match = exportRe.exec(content)) !== null && exports.length < 50) {
				exports.push({ name: match[1] });
			}

			return {
				filePath: file.absolutePath,
				relativePath: file.relativePath,
				imports,
				exports,
				functions: [],
				components: [],
				isComponentFile: file.extension === '.tsx' || file.extension === '.jsx',
				packageName,
			};
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
