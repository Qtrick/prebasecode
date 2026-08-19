/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { GraphEdge, GraphNode } from './graphTypes.js';

export interface GraphVersionMetadata {
	readonly graphSchemaVersion: number;
	readonly analyzerVersion: number;
	readonly identityVersion: number;
	readonly layoutVersion: number;
}

export interface CanonicalExclusionRecord {
	readonly path: string;
	readonly reason: 'unsupported-language' | 'oversized-file' | 'binary' | 'parse-error' | 'permission-denied' | 'ignored-pattern' | 'other';
	readonly message?: string;
}

export interface CanonicalCompleteness {
	readonly isComplete: boolean;
	readonly analyzedFileCount: number;
	readonly excludedFileCount: number;
	readonly exclusionReasons: Record<string, number>;
	readonly skippedFiles?: readonly string[];
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
	readonly completeness: CanonicalCompleteness;
}

export interface CanonicalAnalysisOptions {
	readonly maxCanonicalFiles?: number;
	readonly maxFileSizeBytes?: number;
	readonly includeFolders?: boolean;
	readonly includeFunctions?: boolean;
	readonly respectGitIgnore?: boolean;
}
