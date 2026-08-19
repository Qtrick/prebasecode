/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationTokenLike, IRepositoryContentSource } from '../../core/canonical/contentSource.js';
import type { ParseResult } from '../../common/types/graphTypes.js';
import type { GitExactDiffChange } from '../../history/git/gitTypes.js';
import { ParserEngine } from '../../core/parsing/parserEngine.js';
import { normalizePath } from '../../core/resolution/paths.js';
import {
	CURRENT_ANALYZER_VERSION,
	CURRENT_PROFILE_VERSION,
	CURRENT_SCHEMA_VERSION,
} from '../common/temporalVersioning.js';
import { BlobAnalysisCache } from './blobAnalysisCache.js';
import { TemporalLineageResolver, type FileToResolve } from '../core/temporalLineageResolver.js';
import { TemporalEdgeLineageResolver, type RawEdgeInfo } from '../core/temporalEdgeLineage.js';
import { TemporalDeltaEngine } from '../core/temporalDelta.js';
import type {
	ArchitectureGraphData,
	BlobAnalysisRecord,
	GraphNodeData,
	TemporalEdgeKind,
	TemporalEntityLineageEvent,
	TemporalGraphSnapshot,
	TemporalStructuralDelta,
} from '../common/temporalTypes.js';

export interface IncrementalAnalysisOptions {
	readonly maxCanonicalFiles?: number;
	readonly maxFileSizeBytes?: number;
	readonly schemaVersion?: number;
	readonly analyzerVersion?: number;
	readonly profileVersion?: number;
}

export interface IncrementalAnalysisInput {
	readonly commitSha: string;
	readonly contentSource: IRepositoryContentSource;
	readonly diffChanges?: readonly GitExactDiffChange[];
	readonly parentSnapshot?: TemporalGraphSnapshot;
	readonly isCheckpoint?: boolean;
	readonly token?: CancellationTokenLike;
}

export interface IncrementalAnalysisOutput {
	readonly snapshot: TemporalGraphSnapshot;
	readonly delta?: TemporalStructuralDelta;
	readonly lineageEvents: readonly TemporalEntityLineageEvent[];
}

export class IncrementalGraphAnalyzer {
	private readonly _maxCanonicalFiles: number;
	private readonly _maxFileSizeBytes: number;
	private readonly _schemaVersion: number;
	private readonly _analyzerVersion: number;
	private readonly _profileVersion: number;
	private readonly _parserEngine: ParserEngine;
	private readonly _blobCache: BlobAnalysisCache;
	private readonly _lineageResolver: TemporalLineageResolver;
	private readonly _edgeLineageResolver: TemporalEdgeLineageResolver;
	private readonly _deltaEngine: TemporalDeltaEngine;

	constructor(
		options: IncrementalAnalysisOptions = {},
		blobCache: BlobAnalysisCache = new BlobAnalysisCache(),
		lineageResolver: TemporalLineageResolver = new TemporalLineageResolver(),
		edgeLineageResolver: TemporalEdgeLineageResolver = new TemporalEdgeLineageResolver(),
		deltaEngine: TemporalDeltaEngine = new TemporalDeltaEngine()
	) {
		this._maxCanonicalFiles = options.maxCanonicalFiles ?? 10_000;
		this._maxFileSizeBytes = options.maxFileSizeBytes ?? 1_000_000;
		this._schemaVersion = options.schemaVersion ?? CURRENT_SCHEMA_VERSION;
		this._analyzerVersion = options.analyzerVersion ?? CURRENT_ANALYZER_VERSION;
		this._profileVersion = options.profileVersion ?? CURRENT_PROFILE_VERSION;

		this._blobCache = blobCache;
		this._lineageResolver = lineageResolver;
		this._edgeLineageResolver = edgeLineageResolver;
		this._deltaEngine = deltaEngine;
		this._parserEngine = new ParserEngine(async (p: string) => undefined, this._maxFileSizeBytes);
	}

	async analyzeCommit(input: IncrementalAnalysisInput): Promise<IncrementalAnalysisOutput> {
		const {
			commitSha,
			contentSource,
			diffChanges = [],
			parentSnapshot,
			isCheckpoint = false,
			token,
		} = input;

		const inventory = await contentSource.listFiles(token);
		const rawFiles = inventory.files.slice(0, this._maxCanonicalFiles);

		const filesToResolve: FileToResolve[] = [];
		const allRawEdges: RawEdgeInfo[] = [];

		for (const file of rawFiles) {
			if (token?.isCancellationRequested) {
				break;
			}

			const relPath = normalizePath(file.relativePath);
			const blobOid = file.blobOid ?? '';
			const language = file.extension ? file.extension.replace(/^\./, '') : 'text';

			// 1. Check BlobAnalysisCache
			let record: BlobAnalysisRecord | undefined;
			if (blobOid) {
				record = this._blobCache.get(blobOid, this._analyzerVersion, this._profileVersion, language);
			}

			// 2. Parse if cache miss
			if (!record) {
				const content = await contentSource.readFile(file.relativePath, token);
				let parseResult: ParseResult | null = null;
				if (content !== undefined) {
					parseResult = await this._parserEngine.parseFile(file, content);
				}

				const nodeData: GraphNodeData = {
					id: relPath,
					kind: 'file',
					label: file.relativePath.split('/').pop() || relPath,
					path: relPath,
					meta: {
						language,
						architectureLayer: 'domain',
						exports: parseResult?.exports?.map(e => e.name) ?? [],
						imports: parseResult?.imports?.map(i => i.source) ?? [],
					},
				};

				const outgoingEdges: Array<{ targetPath: string; kind: TemporalEdgeKind; weight?: number }> = [];
				if (parseResult && parseResult.imports) {
					for (const imp of parseResult.imports) {
						if (imp.source && typeof imp.source === 'string') {
							const targetRel = this._resolveImportPath(relPath, imp.source);
							outgoingEdges.push({
								targetPath: targetRel,
								kind: 'imports',
								weight: 1,
							});
						}
					}
				}

				record = {
					blobOid: blobOid || `hash_${relPath}`,
					analyzerVersion: this._analyzerVersion,
					profileVersion: this._profileVersion,
					language,
					nodeData,
					outgoingEdges,
					analyzedAt: Date.now(),
				};

				if (blobOid) {
					this._blobCache.set(record);
				}
			}

			// Add to resolution inputs
			filesToResolve.push({
				path: relPath,
				blobOid: file.blobOid,
				contentHash: record.blobOid,
				nodeData: record.nodeData,
			});

			for (const edge of record.outgoingEdges) {
				allRawEdges.push({
					sourcePath: relPath,
					targetPath: edge.targetPath,
					kind: edge.kind,
					weight: edge.weight,
				});
			}
		}

		// 3. Resolve Entity Lineage
		const parentEntityMap = parentSnapshot?.entityMap ?? new Map();
		const parentPathToEntityId = parentSnapshot?.pathToEntityId ?? new Map();

		const lineageResult = this._lineageResolver.resolveLineage({
			commitSha,
			parentCommitSha: parentSnapshot?.commitSha,
			parentEntityMap,
			parentPathToEntityId,
			currentFiles: filesToResolve,
			diffChanges,
		});

		// 4. Resolve Edge Lineage
		const edgeMap = this._edgeLineageResolver.resolveEdges({
			commitSha,
			entitySnapshots: lineageResult.entitySnapshots,
			pathToEntityId: lineageResult.pathToEntityId,
			rawEdges: allRawEdges,
		});

		// 5. Construct Graph Data
		const nodes = Array.from(lineageResult.entitySnapshots.values()).map(e => e.nodeData);
		const edges = Array.from(edgeMap.values()).map(e => e.edgeData);
		const graphData: ArchitectureGraphData = {
			nodes,
			edges,
			timestamp: Date.now(),
		};

		const currentSnapshot: TemporalGraphSnapshot = {
			schemaVersion: this._schemaVersion,
			analyzerVersion: this._analyzerVersion,
			profileVersion: this._profileVersion,
			commitSha,
			timestamp: Date.now(),
			isCheckpoint,
			graphData,
			entityMap: lineageResult.entitySnapshots,
			edgeMap,
			pathToEntityId: lineageResult.pathToEntityId,
		};

		// 6. Compute structural delta if parent exists
		let delta: TemporalStructuralDelta | undefined;
		if (parentSnapshot) {
			delta = this._deltaEngine.computeDelta(currentSnapshot, parentSnapshot);
		}

		return {
			snapshot: currentSnapshot,
			delta,
			lineageEvents: lineageResult.lineageEvents,
		};
	}

	private _resolveImportPath(sourceFilePath: string, importSpecifier: string): string {
		if (!importSpecifier.startsWith('.')) {
			// External package
			return importSpecifier;
		}

		const sourceDir = sourceFilePath.includes('/')
			? sourceFilePath.slice(0, sourceFilePath.lastIndexOf('/'))
			: '';

		const combined = sourceDir ? `${sourceDir}/${importSpecifier}` : importSpecifier;
		return normalizePath(combined);
	}
}
