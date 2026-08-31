/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IWorkbenchEnvironmentService } from '../../../services/environment/common/environmentService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IPreBaseAccountService } from './prebaseAccountService.js';
import { PreBaseOnboardingEditorInput } from './prebaseOnboardingEditorInput.js';

/**
 * Opens PreBase onboarding once per app session when versioned storage says incomplete.
 * Does not reopen if the user closes the tab mid-flow (no infinite loop).
 * Explicit reopen: command `prebase.onboarding.open`.
 *
 * Loop-safety: mark/reset use `prebase.onboarding.completedVersion`; this contribution
 * only auto-opens in the constructor (AfterRestored), never on storage change.
 */
export class PreBaseOnboardingContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.prebase.onboarding';

	/** Session latch — constructor may only attempt auto-open once. */
	private static _autoOpenAttempted = false;

	constructor(
		@IPreBaseAccountService private readonly accountService: IPreBaseAccountService,
		@IEditorService private readonly editorService: IEditorService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
	) {
		super();
		// Match the workbench startup runner: --skip-welcome must suppress all first-run welcome UI.
		if (PreBaseOnboardingContribution._autoOpenAttempted || this.environmentService.skipWelcome) {
			return;
		}
		PreBaseOnboardingContribution._autoOpenAttempted = true;
		if (!this.accountService.isOnboardingComplete()) {
			const alreadyOpen = this.editorService.editors.some(e => e instanceof PreBaseOnboardingEditorInput)
				|| this.editorService.visibleEditors.some(e => e instanceof PreBaseOnboardingEditorInput);
			if (!alreadyOpen) {
				void this.editorService.openEditor(new PreBaseOnboardingEditorInput(), {
					pinned: true,
					revealIfOpened: true,
					revealIfVisible: true,
				});
			}
		}
	}
}

registerWorkbenchContribution2(
	PreBaseOnboardingContribution.ID,
	PreBaseOnboardingContribution,
	WorkbenchPhase.AfterRestored
);
