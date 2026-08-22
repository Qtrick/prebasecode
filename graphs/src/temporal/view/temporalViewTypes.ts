/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import type { Event } from '../../../../../../base/common/event.js';
import type { TemporalRepositoryRef } from '../common/temporalTypes.js';

export type TemporalNodeChangeKind = 'unchanged' | 'modified' | 'added' | 'removed' | 'renamed';
export type TemporalEdgeChangeKind = 'unchanged' | 'modified' | 'added' | 'removed';
export type TemporalDisplayMode = 'changes' | 'state';

export interface TemporalRenderNode {
	readonly entityId: string;
	readonly canonicalNodeId: string;
	readonly path: string;
	readonly label: string;
	readonly kind: 'file' | 'folder';
	readonly x: number;
	readonly y: number;
	readonly z?: number;
	readonly changeKind: TemporalNodeChangeKind;
	readonly oldPath?: string;
	readonly isModified?: boolean;
	readonly meta?: {
		readonly architectureLayer?: string;
		readonly fileType?: string;
		readonly linesOfCode?: number;
		readonly language?: string;
		readonly isRenamedAndModified?: boolean;
		readonly [key: string]: unknown;
	};
}

export interface TemporalRenderEdge {
	readonly edgeId: string;
	readonly sourceEntityId: string;
	readonly targetEntityId: string;
	readonly sourcePath: string;
	readonly targetPath: string;
	readonly kind: string;
	readonly changeKind: TemporalEdgeChangeKind;
	readonly edgeData?: {
		readonly importType?: string;
		readonly weight?: number;
		readonly [key: string]: unknown;
	};
}

export interface TemporalStructuralDiffSummary {
	readonly addedCount: number;
	readonly removedCount: number;
	readonly modifiedCount: number;
	readonly renamedCount: number;
	readonly unchangedCount: number;
	readonly edgeAddedCount: number;
	readonly edgeRemovedCount: number;
	readonly edgeModifiedCount: number;
}

export interface TemporalStructuralDiff {
	readonly targetCommitSha: string;
	readonly baseCommitSha?: string;
	readonly nodes: readonly TemporalRenderNode[];
	readonly edges: readonly TemporalRenderEdge[];
	readonly summary: TemporalStructuralDiffSummary;
	readonly isPartialLineage: boolean;
	readonly partialLineageReason?: string;
}

export interface TemporalCommitSummary {
	readonly sha: string;
	readonly shortSha: string;
	readonly message: string;
	readonly author: string;
	readonly timestamp: number;
	readonly parents: readonly string[];
	readonly isMerge: boolean;
	readonly isCheckpoint: boolean;
	readonly isSettled: boolean;
}

export interface ITemporalViewState {
	readonly activeRepositoryId?: string;
	readonly activeRepositoryRoot?: string;
	readonly repositoryRefs: readonly TemporalRepositoryRef[];
	readonly selectedRef: string;
	readonly selectedCommitSha: string;
	readonly compareBaseSha?: string;
	readonly comparisonMode: 'first-parent' | 'explicit-parent' | 'arbitrary';
	readonly followHead: boolean;
	readonly displayMode: TemporalDisplayMode;
	readonly pagedTimeline: readonly TemporalCommitSummary[];
	readonly loadedCommitCount: number;
	readonly totalAvailableCommits?: number;
	readonly historyHasMore: boolean;
	readonly historyNextCursor?: string;
	readonly isSettled: boolean;
	readonly isPartialLineage: boolean;
	readonly diff?: TemporalStructuralDiff;
	readonly selectedEntityId?: string;
	readonly filterQuery?: string;
}

export interface TemporalLayoutResult {
	readonly nodes: readonly TemporalRenderNode[];
	readonly positions: Map<string, { x: number; y: number }>;
}

export const IPreBaseTemporalViewService = createDecorator<IPreBaseTemporalViewService>('prebaseTemporalViewService');

export interface IPreBaseTemporalViewService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeState: Event<ITemporalViewState>;
	readonly onDidChangeTimeline: Event<readonly TemporalCommitSummary[]>;
	readonly onDidChangeDiff: Event<TemporalStructuralDiff>;

	getState(): ITemporalViewState;
	initialize(): Promise<void>;
	selectRef(refName: string): Promise<void>;
	selectCommit(commitSha: string, options?: { compareBaseSha?: string; immediate?: boolean }): Promise<void>;
	setCompareBase(compareBaseSha: string | undefined): Promise<void>;
	setDisplayMode(mode: TemporalDisplayMode): void;
	setFollowHead(follow: boolean): void;
	setFilterQuery(query: string): void;
	selectEntity(entityId: string | undefined): void;
	loadMoreHistory(): Promise<void>;
	openSourceDiff(entityId: string): Promise<void>;
	openHistoricalFile(entityId: string): Promise<void>;
	refresh(): Promise<void>;
}
