/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { disposableTimeout } from '../../../../base/common/async.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { PreBaseConfigKeys } from '../common/prebaseConfiguration.js';
import { PreBaseHomeEditorInput } from './prebaseHomeEditorInput.js';

/**
 * Opens PreBase Home when all normal editor tabs are closed.
 * Tracks explicit dismissal for the current empty-editor transition so closing
 * Home does not immediately reopen in a loop.
 */
export class PreBaseHomeEmptyEditorsContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.prebase.homeEmptyEditors';

	private _dismissedForCurrentEmpty = false;
	private _homeWasOpen = false;
	private _opening = false;
	private readonly _openSettle = this._register(new DisposableStore());

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();
		this._homeWasOpen = this._hasHomeOpen();
		this._register(this.editorService.onDidVisibleEditorsChange(() => this._onEditorsChanged()));
		this._onEditorsChanged();
	}

	private _nonHomeEditors(): readonly EditorInput[] {
		return this.editorService.visibleEditors.filter(e => !(e instanceof PreBaseHomeEditorInput));
	}

	private _hasHomeOpen(): boolean {
		return this.editorService.editors.some(e => e instanceof PreBaseHomeEditorInput)
			|| this.editorService.visibleEditors.some(e => e instanceof PreBaseHomeEditorInput);
	}

	private _onEditorsChanged(): void {
		const nonHome = this._nonHomeEditors();
		const homeOpen = this._hasHomeOpen();

		if (nonHome.length > 0) {
			// Any normal editor clears the empty-transition dismiss latch.
			this._dismissedForCurrentEmpty = false;
			this._homeWasOpen = homeOpen;
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

	private _scheduleOpenHome(): void {
		this._opening = true;
		this._openSettle.clear();
		void this.editorService.openEditor(new PreBaseHomeEditorInput(), {
			pinned: true,
			revealIfOpened: true,
			revealIfVisible: true,
		}).finally(() => {
			this._opening = false;
			if (this._openSettle.isDisposed) {
				return;
			}
			this._homeWasOpen = this._hasHomeOpen();
			// If open failed / was immediately closed, latch dismiss for this empty spell.
			this._openSettle.add(disposableTimeout(() => {
				if (this._nonHomeEditors().length > 0) {
					this._dismissedForCurrentEmpty = false;
					return;
				}
				if (!this._hasHomeOpen()) {
					this._dismissedForCurrentEmpty = true;
					this._homeWasOpen = false;
				}
			}, 0));
		});
	}
}

registerWorkbenchContribution2(
	PreBaseHomeEmptyEditorsContribution.ID,
	PreBaseHomeEmptyEditorsContribution,
	WorkbenchPhase.AfterRestored
);
