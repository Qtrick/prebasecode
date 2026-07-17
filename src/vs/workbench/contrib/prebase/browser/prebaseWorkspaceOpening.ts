/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { disposableTimeout } from '../../../../base/common/async.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { PreBaseWorkspaceOpeningEditorInput } from './prebaseWorkspaceOpeningEditorInput.js';
import { PreBaseHomeEditorInput } from './prebaseHomeEditorInput.js';

export const PREBASE_PENDING_WORKSPACE_KEY = 'prebase.workspace.pendingOpen';

export interface PreBasePendingWorkspaceOpen {
	label: string;
	uri?: string;
	requestedAt: number;
	action: 'openFolder' | 'openWorkspace' | 'openRecent' | 'unknown';
}

export type PreBaseWorkspaceOpenPhase =
	| 'idle'
	| 'requestingWorkspace'
	| 'openingWindow'
	| 'restoringWorkbench'
	| 'workspaceReady'
	| 'activatingPreBase'
	| 'ready'
	| 'error';

const STALE_MS = 2 * 60 * 1000;

export function readPendingWorkspaceOpen(storageService: IStorageService): PreBasePendingWorkspaceOpen | undefined {
	const raw = storageService.get(PREBASE_PENDING_WORKSPACE_KEY, StorageScope.APPLICATION);
	if (!raw) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(raw) as PreBasePendingWorkspaceOpen;
		if (!parsed?.label || typeof parsed.requestedAt !== 'number') {
			storageService.remove(PREBASE_PENDING_WORKSPACE_KEY, StorageScope.APPLICATION);
			return undefined;
		}
		if (Date.now() - parsed.requestedAt > STALE_MS) {
			storageService.remove(PREBASE_PENDING_WORKSPACE_KEY, StorageScope.APPLICATION);
			return undefined;
		}
		return parsed;
	} catch {
		storageService.remove(PREBASE_PENDING_WORKSPACE_KEY, StorageScope.APPLICATION);
		return undefined;
	}
}

/**
 * Persists a minimal pending-workspace handoff and shows a non-blank loading
 * surface in the editor area as soon as the workbench restores.
 */
export class PreBaseWorkspaceOpeningContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.prebase.workspaceOpening';

	private _phase: PreBaseWorkspaceOpenPhase = 'idle';
	private readonly _finishSettle = this._register(new DisposableStore());
	private _finishGeneration = 0;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
		@IEditorService private readonly editorService: IEditorService,
		@IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService,
	) {
		super();
		void this._bootstrap();
		this._register(this.workspaceService.onDidChangeWorkbenchState(() => void this._onWorkspaceChanged()));
		this._register(this.workspaceService.onDidChangeWorkspaceFolders(() => void this._onWorkspaceChanged()));
	}

	private async _closeLoadingEditors(): Promise<void> {
		for (const group of this.editorGroupsService.groups) {
			for (const editor of [...group.editors]) {
				if (editor instanceof PreBaseWorkspaceOpeningEditorInput) {
					await group.closeEditor(editor, { preserveFocus: true });
				}
			}
		}
	}

	private async _bootstrap(): Promise<void> {
		const pending = readPendingWorkspaceOpen(this.storageService);
		if (!pending) {
			this._phase = this.workspaceService.getWorkbenchState() === WorkbenchState.EMPTY ? 'idle' : 'ready';
			return;
		}
		this._phase = 'restoringWorkbench';
		await this._showLoadingSurface(pending);
		this._scheduleFinish(pending, 400);
	}

	private async _onWorkspaceChanged(): Promise<void> {
		const pending = readPendingWorkspaceOpen(this.storageService);
		if (!pending) {
			if (this.workspaceService.getWorkbenchState() !== WorkbenchState.EMPTY) {
				this._phase = 'ready';
			}
			return;
		}
		this._phase = 'workspaceReady';
		await this._showLoadingSurface(pending);
		this._scheduleFinish(pending, 300);
	}

	private _scheduleFinish(pending: PreBasePendingWorkspaceOpen, delayMs: number): void {
		this._finishSettle.clear();
		const generation = ++this._finishGeneration;
		this._finishSettle.add(disposableTimeout(() => {
			if (generation !== this._finishGeneration) {
				return;
			}
			void this._finishOpening(pending, generation);
		}, delayMs));
	}

	private async _finishOpening(pending: PreBasePendingWorkspaceOpen, generation: number): Promise<void> {
		if (generation !== this._finishGeneration) {
			return;
		}
		this._phase = 'activatingPreBase';
		const hasFolder = this.workspaceService.getWorkbenchState() !== WorkbenchState.EMPTY;
		const nonLoading = this.editorService.visibleEditors.filter(e => !(e instanceof PreBaseWorkspaceOpeningEditorInput));

		// Open Home before closing the loading tab so the center never goes blank.
		if (nonLoading.length === 0) {
			await this.editorService.openEditor(new PreBaseHomeEditorInput(), {
				pinned: true,
				revealIfOpened: true,
				revealIfVisible: true,
			});
		}

		if (generation !== this._finishGeneration) {
			return;
		}

		await this._closeLoadingEditors();

		this._clearPending();
		this._phase = hasFolder ? 'ready' : 'error';
		void pending;
	}

	private async _showLoadingSurface(pending: PreBasePendingWorkspaceOpen): Promise<void> {
		const resource = pending.uri ? URI.parse(pending.uri) : undefined;
		const existing = this.editorService.editors.find(e => e instanceof PreBaseWorkspaceOpeningEditorInput);
		if (existing) {
			if (existing.projectLabel === pending.label && existing.phase === this._phase) {
				await this.editorService.openEditor(existing, {
					pinned: true,
					revealIfOpened: true,
					revealIfVisible: true,
				});
				return;
			}
			await this._closeLoadingEditors();
		}
		await this.editorService.openEditor(
			new PreBaseWorkspaceOpeningEditorInput(pending.label, resource, this._phase),
			{ pinned: true, revealIfOpened: true, preserveFocus: false },
		);
	}

	private _clearPending(): void {
		this.storageService.remove(PREBASE_PENDING_WORKSPACE_KEY, StorageScope.APPLICATION);
	}
}

/** Call before hostService.openWindow / openFolder so reload shows a loading surface. */
export function storePendingWorkspaceOpen(
	storageService: IStorageService,
	pending: Omit<PreBasePendingWorkspaceOpen, 'requestedAt'> & { requestedAt?: number },
): void {
	const payload: PreBasePendingWorkspaceOpen = {
		...pending,
		requestedAt: pending.requestedAt ?? Date.now(),
	};
	storageService.store(
		PREBASE_PENDING_WORKSPACE_KEY,
		JSON.stringify(payload),
		StorageScope.APPLICATION,
		StorageTarget.MACHINE,
	);
}

export function workspaceOpeningStageLabel(phase: PreBaseWorkspaceOpenPhase): string {
	switch (phase) {
		case 'requestingWorkspace':
			return localize('prebase.workspace.stage.requesting', "Opening workspace");
		case 'openingWindow':
			return localize('prebase.workspace.stage.window', "Opening window");
		case 'restoringWorkbench':
			return localize('prebase.workspace.stage.restoring', "Restoring files");
		case 'workspaceReady':
			return localize('prebase.workspace.stage.ready', "Workspace ready");
		case 'activatingPreBase':
			return localize('prebase.workspace.stage.prebase', "Preparing PreBase");
		case 'error':
			return localize('prebase.workspace.stage.error', "Opening failed");
		case 'ready':
			return localize('prebase.workspace.stage.done', "Ready");
		default:
			return localize('prebase.workspace.stage.opening', "Opening workspace");
	}
}

registerWorkbenchContribution2(
	PreBaseWorkspaceOpeningContribution.ID,
	PreBaseWorkspaceOpeningContribution,
	WorkbenchPhase.AfterRestored,
);
