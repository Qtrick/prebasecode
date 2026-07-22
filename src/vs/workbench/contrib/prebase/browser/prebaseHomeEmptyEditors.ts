/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { disposableTimeout } from '../../../../base/common/async.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { PreBaseConfigKeys } from '../common/prebaseConfiguration.js';
import { IPreBaseAccountService } from './prebaseAccountService.js';
import { PreBaseHomeEditorInput } from './prebaseHomeEditorInput.js';
import { PreBaseOnboardingEditorInput } from './prebaseOnboardingEditorInput.js';
import { PreBaseWorkspaceOpeningEditorInput } from './prebaseWorkspaceOpeningEditorInput.js';
import { readPendingWorkspaceOpen } from './prebaseWorkspaceOpening.js';

/**
 * Opens PreBase Home when all normal editor tabs are closed.
 * Tracks explicit dismissal for the current empty-editor transition so closing
 * Home does not immediately reopen in a loop.
 *
 * Important: do NOT latch dismiss on a 0ms settle race during workspace open —
 * that produces a blank editor area (sidebar + empty center + Agents).
 *
 * First-run onboarding (incomplete versioned storage) owns the empty center;
 * this contribution yields until onboarding is visible or dismissed, then may open Home.
 */
export class PreBaseHomeEmptyEditorsContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.prebase.homeEmptyEditors';

	private static readonly MAX_HOME_OPEN_ATTEMPTS = 3;

	private _dismissedForCurrentEmpty = false;
	private _homeWasOpen = false;
	private _onboardingWasOpen = false;
	private _opening = false;
	private _yieldingToOnboarding = false;
	private _homeOpenAttempts = 0;
	private readonly _openSettle = this._register(new DisposableStore());

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
		@IStorageService private readonly storageService: IStorageService,
		@IPreBaseAccountService private readonly accountService: IPreBaseAccountService,
	) {
		super();
		this._homeWasOpen = this._hasHomeOpen();
		this._onboardingWasOpen = this._hasOnboardingOpen();
		this._register(this.editorService.onDidVisibleEditorsChange(() => this._onEditorsChanged()));
		// Workspace transitions clear dismiss so Home/loading can fill the center again.
		this._register(this.workspaceService.onDidChangeWorkbenchState(() => {
			this._dismissedForCurrentEmpty = false;
			this._homeOpenAttempts = 0;
			this._onEditorsChanged();
		}));
		this._register(this.workspaceService.onDidChangeWorkspaceFolders(() => {
			this._dismissedForCurrentEmpty = false;
			this._homeOpenAttempts = 0;
			this._onEditorsChanged();
		}));
		this._onEditorsChanged();
	}

	private _isLoadingSurface(input: EditorInput): boolean {
		return input instanceof PreBaseWorkspaceOpeningEditorInput;
	}

	private _workspaceOpenInProgress(): boolean {
		return this._hasLoadingSurface() || !!readPendingWorkspaceOpen(this.storageService);
	}

	private _hasLoadingSurface(): boolean {
		return this.editorService.editors.some(e => this._isLoadingSurface(e))
			|| this.editorService.visibleEditors.some(e => this._isLoadingSurface(e));
	}

	private _meaningfulEditors(): readonly EditorInput[] {
		return this.editorService.visibleEditors.filter(e =>
			!(e instanceof PreBaseHomeEditorInput)
			&& !(e instanceof PreBaseOnboardingEditorInput)
			&& !this._isLoadingSurface(e));
	}

	private _hasOnboardingOpen(): boolean {
		return this.editorService.editors.some(e => e instanceof PreBaseOnboardingEditorInput)
			|| this.editorService.visibleEditors.some(e => e instanceof PreBaseOnboardingEditorInput);
	}

	private _hasHomeOpen(): boolean {
		return this.editorService.editors.some(e => e instanceof PreBaseHomeEditorInput)
			|| this.editorService.visibleEditors.some(e => e instanceof PreBaseHomeEditorInput);
	}

	private _onEditorsChanged(): void {
		const openingInProgress = this._workspaceOpenInProgress();
		const meaningful = this._meaningfulEditors();
		const homeOpen = this._hasHomeOpen();
		const onboardingOpen = this._hasOnboardingOpen();

		if (onboardingOpen) {
			this._onboardingWasOpen = true;
			this._yieldingToOnboarding = false;
			this._dismissedForCurrentEmpty = false;
			this._homeWasOpen = homeOpen;
			this._homeOpenAttempts = 0;
			this._openSettle.clear();
			return;
		}

		if (meaningful.length > 0) {
			this._dismissedForCurrentEmpty = false;
			this._homeWasOpen = homeOpen;
			this._homeOpenAttempts = 0;
			return;
		}

		if (openingInProgress) {
			this._openSettle.clear();
			return;
		}

		// First-run: yield to PreBaseOnboardingContribution so Home does not steal the center.
		if (!this.accountService.isOnboardingComplete() && !this._onboardingWasOpen) {
			this._scheduleOnboardingYield();
			return;
		}

		// Closing Home while empty (and not mid-open) is an explicit dismiss.
		if (this._homeWasOpen && !homeOpen && !this._opening) {
			this._dismissedForCurrentEmpty = true;
		}
		this._homeWasOpen = homeOpen;

		if (homeOpen || this._dismissedForCurrentEmpty || this._opening) {
			return;
		}

		if (!this.configurationService.getValue<boolean>(PreBaseConfigKeys.HomeOpenWhenEditorsEmpty)) {
			return;
		}

		this._scheduleOpenHome();
	}

	/**
	 * Wait briefly for auto-opened onboarding. If it never appears (or user already
	 * closed it before visibility), treat as dismissed and allow Home to fill empty.
	 */
	private _scheduleOnboardingYield(): void {
		if (this._yieldingToOnboarding || this._workspaceOpenInProgress()) {
			return;
		}
		this._yieldingToOnboarding = true;
		this._openSettle.clear();
		this._openSettle.add(disposableTimeout(() => {
			this._yieldingToOnboarding = false;
			if (this._hasOnboardingOpen()) {
				this._onboardingWasOpen = true;
				return;
			}
			// Onboarding did not stick — allow Home path on next evaluation.
			this._onboardingWasOpen = true;
			this._onEditorsChanged();
		}, 250));
	}

	private _scheduleOpenHome(): void {
		if (this._workspaceOpenInProgress()) {
			return;
		}
		if (this._homeOpenAttempts >= PreBaseHomeEmptyEditorsContribution.MAX_HOME_OPEN_ATTEMPTS) {
			return;
		}
		this._homeOpenAttempts++;
		this._opening = true;
		this._openSettle.clear();
		void this.editorService.openEditor(new PreBaseHomeEditorInput(), {
			pinned: true,
			revealIfOpened: true,
			revealIfVisible: true,
		}).finally(() => {
			this._opening = false;
			if (this._openSettle.isDisposed || this._workspaceOpenInProgress()) {
				return;
			}
			this._homeWasOpen = this._hasHomeOpen();
			if (this._homeWasOpen) {
				this._homeOpenAttempts = 0;
				return;
			}
			// Longer settle: workspace reload / editor restore can lag a few frames.
			// Only latch dismiss if Home truly failed to appear after that window.
			this._openSettle.add(disposableTimeout(() => {
				if (this._workspaceOpenInProgress()) {
					return;
				}
				if (this._meaningfulEditors().length > 0) {
					this._dismissedForCurrentEmpty = false;
					this._homeOpenAttempts = 0;
					return;
				}
				if (this._hasHomeOpen()) {
					this._dismissedForCurrentEmpty = false;
					this._homeWasOpen = true;
					this._homeOpenAttempts = 0;
					return;
				}
				if (this._homeOpenAttempts < PreBaseHomeEmptyEditorsContribution.MAX_HOME_OPEN_ATTEMPTS) {
					this._scheduleOpenHome();
					return;
				}
				// Give up after bounded retries — workspace opening will fill the center.
			}, 250));
		});
	}
}

registerWorkbenchContribution2(
	PreBaseHomeEmptyEditorsContribution.ID,
	PreBaseHomeEmptyEditorsContribution,
	WorkbenchPhase.AfterRestored
);
