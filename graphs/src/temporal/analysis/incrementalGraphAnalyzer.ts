/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationTokenLike, IRepositoryContentSource } from '../../core/canonical/contentSource.js';
import type { GitExactDiffChange } from '../../history/git/gitTypes.js';
import { CanonicalGraphAnalyzer } from '../../core/canonical/canonicalGraphAnalyzer.js';
import type { ICanonicalParseService } from '../../core/canonical/canonicalParseService.js';
import { type ICanonicalParseArtifactCache } from '../../core/canonical/parseArtifactCache.js';
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
import { TemporalError } from '../common/temporalErrors.js';
import type {
	ArchitectureGraphData,
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
	readonly parseArtifactCache?: ICanonicalParseArtifactCache;
	/** Runtime-owned parser adapter. Browser callers must use the utility-process service. */
	readonly parseService?: ICanonicalParseService;
}

export interface IncrementalAnalysisInput {
	readonly commitSha: string;
	readonly contentSource: IRepositoryContentSource;
	readonly diffChanges?: readonly GitExactDiffChange[];
	readonly parentSnapshot?: TemporalGraphSnapshot;
	readonly isCheckpoint?: boolean;
	readonly token?: CancellationTokenLike;
	readonly deletedPathsInHistory?: ReadonlyMap<string, string>;
}

export interface IncrementalAnalysisOutput {
	readonly snapshot: TemporalGraphSnapshot;
	readonly delta?: TemporalStructuralDelta;
	readonly lineageEvents: readonly TemporalEntityLineageEvent[];
	readonly isIdenticalToParent?: boolean;
}

export class IncrementalGraphAnalyzer {
	private readonly _maxCanonicalFiles: number;
	private readonly _maxFileSizeBytes: number;
	private readonly _schemaVersion: number;
	private readonly _analyzerVersion: number;
	private readonly _profileVersion: number;
	private readonly _parseCache?: ICanonicalParseArtifactCache;
	private readonly _parseService?: ICanonicalParseService;
	private readonly _lineageResolver: TemporalLineageResolver;
	private readonly _edgeLineageResolver: TemporalEdgeLineageResolver;
	private readonly _deltaEngine: TemporalDeltaEngine;

	constructor(
		options: IncrementalAnalysisOptions = {},
		parseCache?: ICanonicalParseArtifactCache,
		lineageResolver: TemporalLineageResolver = new TemporalLineageResolver(),
		edgeLineageResolver: TemporalEdgeLineageResolver = new TemporalEdgeLineageResolver(),
		deltaEngine: TemporalDeltaEngine = new TemporalDeltaEngine()
	) {
		this._maxCanonicalFiles = options.maxCanonicalFiles ?? 10_000;
		this._maxFileSizeBytes = options.maxFileSizeBytes ?? 1_000_000;
		this._schemaVersion = options.schemaVersion ?? CURRENT_SCHEMA_VERSION;
		this._analyzerVersion = options.analyzerVersion ?? CURRENT_ANALYZER_VERSION;
		this._profileVersion = options.profileVersion ?? CURRENT_PROFILE_VERSION;

		this._parseCache = parseCache ?? options.parseArtifactCache ?? new BlobAnalysisCache(10_000, this._analyzerVersion, this._profileVersion);
		this._parseService = options.parseService;
		this._lineageResolver = lineageResolver;
		this._edgeLineageResolver = edgeLineageResolver;
		this._deltaEngine = deltaEngine;
	}

	async analyzeCommit(input: IncrementalAnalysisInput): Promise<IncrementalAnalysisOutput> {
		const {
			commitSha,
			contentSource,
			diffChanges = [],
			parentSnapshot,
			isCheckpoint = false,
			token,
			deletedPathsInHistory,
		} = input;

		if (token?.isCancellationRequested) {
			throw new TemporalError('Cancelled', `Analysis cancelled for commit ${commitSha}`);
		}

		// 1. Run Canonical Analysis with shared path-independent parse cache
		const canonicalAnalyzer = new CanonicalGraphAnalyzer({
			maxCanonicalFiles: this._maxCanonicalFiles,
			maxFileSizeBytes: this._maxFileSizeBytes,
			parseArtifactCache: this._parseCache,
			parseService: this._parseService,
		});

		const canonicalSnapshot = await canonicalAnalyzer.analyze(contentSource, token);
		if (!canonicalSnapshot) {
			if (token?.isCancellationRequested) {
				throw new TemporalError('Cancelled', `Analysis cancelled for commit ${commitSha}`);
			}
			throw new TemporalError('BlobAnalysisFailed', `Failed to produce canonical graph snapshot for commit ${commitSha}`);
		}

		// Check if structurally identical to parent snapshot
		const isIdenticalToParent = Boolean(
			parentSnapshot &&
			parentSnapshot.digest &&
			canonicalSnapshot.digest &&
			parentSnapshot.digest === canonicalSnapshot.digest
		);

		// 2. Prepare files and edges for lineage resolution
		const filesToResolve: FileToResolve[] = [];
		const manifestMap = new Map<string, string>();
		if (canonicalSnapshot.manifest?.entries) {
			for (const entry of canonicalSnapshot.manifest.entries) {
				if (entry.contentIdentity) {
					manifestMap.set(normalizePath(entry.path), entry.contentIdentity);
				}
			}
		}

		const cleanPath = (p: string) => normalizePath(p).replace(/^file:/, '').replace(/^\/+/, '');

		for (const node of canonicalSnapshot.nodes) {
			const relPath = cleanPath(node.path || node.id);
			const blobOid = manifestMap.get(relPath);
			filesToResolve.push({
				path: relPath,
				blobOid,
				contentHash: blobOid,
				nodeData: node,
			});
		}

		const allRawEdges: RawEdgeInfo[] = [];
		for (const edge of canonicalSnapshot.edges) {
			allRawEdges.push({
				sourcePath: cleanPath(edge.source),
				targetPath: cleanPath(edge.target),
				kind: 'imports',
				weight: (edge as { readonly weight?: number }).weight ?? 1,
				edgeData: edge,
			});
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
			deletedPathsInHistory,
		});

		// 4. Resolve Edge Lineage
		const edgeMap = this._edgeLineageResolver.resolveEdges({
			commitSha,
			entitySnapshots: lineageResult.entitySnapshots,
			pathToEntityId: lineageResult.pathToEntityId,
			rawEdges: allRawEdges,
		});

		// 5. Construct TemporalGraphSnapshot
		const graphData: ArchitectureGraphData = {
			nodes: canonicalSnapshot.nodes,
			edges: canonicalSnapshot.edges,
			timestamp: canonicalSnapshot.analyzedAt,
		};

		const currentSnapshot: TemporalGraphSnapshot = {
			schemaVersion: this._schemaVersion,
			analyzerVersion: this._analyzerVersion,
			profileVersion: this._profileVersion,
			commitSha,
			timestamp: canonicalSnapshot.analyzedAt,
			isCheckpoint,
			canonicalSnapshot,
			graphData,
			entityMap: lineageResult.entitySnapshots,
			edgeMap,
			pathToEntityId: lineageResult.pathToEntityId,
			digest: canonicalSnapshot.digest,
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
			isIdenticalToParent,
		};
	}
}
