/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';

/** Log line consumed by `scripts/startup/verify-workbench-startup.mjs` launch checks. */
export const PREBASE_WORKBENCH_RESTORED_MARKER = '[PreBase] workbench restored';

/**
 * Proves the workbench reached AfterRestored (stronger than extension-host-only startup).
 */
export class PreBaseWorkbenchReadyContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.prebase.workbenchReady';

	constructor(@ILogService logService: ILogService) {
		super();
		logService.info(PREBASE_WORKBENCH_RESTORED_MARKER);
	}
}

registerWorkbenchContribution2(
	PreBaseWorkbenchReadyContribution.ID,
	PreBaseWorkbenchReadyContribution,
	WorkbenchPhase.AfterRestored
);
