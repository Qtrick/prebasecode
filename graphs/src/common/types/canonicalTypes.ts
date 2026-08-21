/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { GraphEdge, GraphNode } from './graphTypes.js';

export interface GraphVersionMetadata {
	readonly graphSchemaVersion: number;
	readonly analyzerVersion: number;
	readonly identityVersion: number;
	readonly layoutVersion: number;
	readonly analysisProfileVersion?: number;
}

export type CanonicalExclusionCode =
	| 'oversized-file'
	| 'binary-file'
	| 'unsupported-language'
	| 'parse-error'
	| 'permission-denied'
	| 'ignored-pattern'
	| 'policy-excluded'
	| 'other';

export interface CanonicalExclusionRecord {
	readonly path: string;
	readonly reason: CanonicalExclusionCode;
	readonly message?: string;
}

export interface CanonicalCoverage {
	readonly completeWithinProfile: boolean;
	readonly isComplete: boolean; // Alias for backward compatibility
	readonly discoveredCount: number;
	readonly analyzedCount: number;
	readonly analyzedFileCount: number; // Alias for backward compatibility
	readonly excludedCount: number;
	readonly excludedFileCount: number; // Alias for backward compatibility
	readonly failedCount: number;
	readonly truncated: boolean;
	readonly truncationReason?: string;
	readonly exclusionBreakdown: Record<CanonicalExclusionCode, number>;
	readonly exclusionReasons: Record<string, number>; // Alias for backward compatibility
	readonly skippedFiles?: readonly string[];
}

export type CanonicalCompleteness = CanonicalCoverage;

export interface AnalysisManifestEntry {
	readonly path: string;
	readonly contentIdentity?: string;
	readonly size?: number;
	readonly isComponent: boolean;
	readonly architectureLayer?: string;
	readonly language?: string;
	readonly analyzedAt?: number;
}

export interface AnalysisManifest {
	readonly entries: readonly AnalysisManifestEntry[];
	readonly runMetadata?: {
		readonly analyzedAt: number;
		readonly durationMs?: number;
	};
}

export interface CanonicalGraphSnapshot {
	readonly nodes: readonly GraphNode[];
	readonly edges: readonly GraphEdge[];
	readonly projectPath: string;
	readonly projectName: string;
	readonly entryNodeId: string | null;
	readonly analyzedAt: number;
	readonly sourceIdentity: string;
	readonly digest: string;
	readonly versions: GraphVersionMetadata;
	readonly coverage: CanonicalCoverage;
	readonly completeness: CanonicalCoverage;
	readonly manifest?: AnalysisManifest;
}

export interface CanonicalAnalysisOptions {
	readonly maxCanonicalFiles?: number;
	readonly maxFileSizeBytes?: number;
	readonly includeFolders?: boolean;
	readonly includeFunctions?: boolean;
	readonly respectGitIgnore?: boolean;
	readonly parseArtifactCache?: import('../../core/canonical/parseArtifactCache.js').ICanonicalParseArtifactCache;
	readonly parseService?: import('../../core/canonical/canonicalParseService.js').ICanonicalParseService;
}
