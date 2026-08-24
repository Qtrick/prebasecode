/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ITemporalViewState } from './temporalViewTypes.js';

export type TemporalStatusKind =
	| 'idle'
	| 'loading-history'
	| 'indexing'
	| 'reconstructing'
	| 'ready'
	| 'partial'
	| 'stale'
	| 'error';

export interface TemporalUnifiedStatus {
	readonly kind: TemporalStatusKind;
	readonly label: string;
	readonly title: string;
	readonly isJobActive: boolean;
	readonly isError: boolean;
	readonly error?: string;
	readonly staleRenderedSha?: string;
	readonly staleRenderedShortSha?: string;
	readonly targetCommitSha?: string;
	readonly targetCommitShortSha?: string;
	readonly canRetry: boolean;
	readonly colorVar: string;
	readonly bgVar: string;
}

/**
 * Authoritative selection & render status computation.
 *
 * Guaranteed Invariants:
 * 1. If no indexing or reconstruction job is currently active, the UI NEVER displays "Indexing…".
 * 2. If a reconstruction or history operation completes unsuccessfully, error state is surfaced with high precedence.
 * 3. If commit A was rendered and selection of commit B failed, the state is explicitly marked as error / stale-render
 *    (e.g., "Could not load 5fa08d3 · Showing 185f87c") rather than pretending commit B is actively loading forever.
 * 4. All UI surfaces (sidebar, graph canvas, tests) share this exact computation.
 */
export function computeTemporalUnifiedStatus(state: Partial<ITemporalViewState>): TemporalUnifiedStatus {
	const selectedSha = state.selectedCommitSha || '';
	const selectedShort = selectedSha ? (state.selectedCommitSummary?.shortSha || selectedSha.slice(0, 7)) : '';
	const renderedSha = state.renderedCommitSha || '';
	const renderedShort = renderedSha ? (state.renderedCommitSummary?.shortSha || renderedSha.slice(0, 7)) : '';

	// 1. Active background jobs have highest execution precedence
	if (state.isLoadingHistory) {
		return {
			kind: 'loading-history',
			label: 'Loading History…',
			title: 'Reading commit timeline from Git repository',
			isJobActive: true,
			isError: false,
			targetCommitSha: selectedSha,
			targetCommitShortSha: selectedShort,
			canRetry: false,
			colorVar: 'var(--vscode-editorWarning-foreground, #d29922)',
			bgVar: 'rgba(210, 153, 34, 0.15)',
		};
	}

	if (state.isLoadingSelection) {
		return {
			kind: 'reconstructing',
			label: 'Indexing…',
			title: selectedShort ? `Reconstructing graph for ${selectedShort}…` : 'Reconstructing graph for target commit…',
			isJobActive: true,
			isError: false,
			targetCommitSha: selectedSha,
			targetCommitShortSha: selectedShort,
			canRetry: false,
			colorVar: 'var(--vscode-editorWarning-foreground, #d29922)',
			bgVar: 'rgba(210, 153, 34, 0.15)',
		};
	}

	// 2. Failure precedence: errors surfaced truthfully when job has completed unsuccessfully
	if (state.selectionError) {
		const isStaleRender = Boolean(renderedSha && renderedSha !== selectedSha);
		const errorMsg = state.selectionError;
		const label = 'Error';
		const title = isStaleRender
			? `Could not load ${selectedShort || selectedSha}. Showing previous graph ${renderedShort || renderedSha}. ${errorMsg}`
			: `Failed to load graph for ${selectedShort || selectedSha || 'target commit'}: ${errorMsg}`;

		return {
			kind: 'error',
			label,
			title,
			isJobActive: false,
			isError: true,
			error: errorMsg,
			staleRenderedSha: isStaleRender ? renderedSha : undefined,
			staleRenderedShortSha: isStaleRender ? renderedShort : undefined,
			targetCommitSha: selectedSha,
			targetCommitShortSha: selectedShort,
			canRetry: true,
			colorVar: 'var(--vscode-errorForeground, #f85149)',
			bgVar: 'rgba(248, 81, 73, 0.15)',
		};
	}

	if (state.historyError) {
		return {
			kind: 'error',
			label: 'Error',
			title: `History error: ${state.historyError}`,
			isJobActive: false,
			isError: true,
			error: state.historyError,
			canRetry: true,
			colorVar: 'var(--vscode-errorForeground, #f85149)',
			bgVar: 'rgba(248, 81, 73, 0.15)',
		};
	}

	// 3. Stale selection (selected commit differs from rendered commit, but no active job and no explicit error)
	if (selectedSha && renderedSha && selectedSha !== renderedSha) {
		return {
			kind: 'stale',
			label: 'Stale View',
			title: `Showing graph for ${renderedShort || renderedSha} (selected: ${selectedShort || selectedSha}). Click to reconcile.`,
			isJobActive: false,
			isError: false,
			staleRenderedSha: renderedSha,
			staleRenderedShortSha: renderedShort,
			targetCommitSha: selectedSha,
			targetCommitShortSha: selectedShort,
			canRetry: true,
			colorVar: 'var(--vscode-descriptionForeground, #a1a1aa)',
			bgVar: 'rgba(161, 161, 170, 0.15)',
		};
	}

	// 4. Partial lineage state
	if (state.isPartialLineage) {
		return {
			kind: 'partial',
			label: 'Partial History',
			title: 'Lineage coverage is partial; structural comparison is truthful.',
			isJobActive: false,
			isError: false,
			targetCommitSha: selectedSha,
			targetCommitShortSha: selectedShort,
			canRetry: false,
			colorVar: 'var(--vscode-descriptionForeground, #a1a1aa)',
			bgVar: 'rgba(161, 161, 170, 0.15)',
		};
	}

	// 5. Empty timeline / idle state
	if (!state.pagedTimeline || state.pagedTimeline.length === 0) {
		return {
			kind: 'idle',
			label: 'No History',
			title: 'No commit history available for active ref',
			isJobActive: false,
			isError: false,
			canRetry: false,
			colorVar: 'var(--vscode-descriptionForeground, #a1a1aa)',
			bgVar: 'rgba(161, 161, 170, 0.12)',
		};
	}

	// 6. Ready state
	return {
		kind: 'ready',
		label: 'Ready',
		title: 'Graph fully indexed and reconciled',
		isJobActive: false,
		isError: false,
		targetCommitSha: selectedSha,
		targetCommitShortSha: selectedShort,
		canRetry: false,
		colorVar: 'var(--vscode-gitDecoration-addedResourceForeground, #3fb950)',
		bgVar: 'rgba(63, 185, 80, 0.15)',
	};
}
