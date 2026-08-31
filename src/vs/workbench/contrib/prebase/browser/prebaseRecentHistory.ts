/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchEnvironmentService } from '../../../services/environment/common/environmentService.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { IWorkspacesService } from '../../../../platform/workspaces/common/workspaces.js';

/**
 * Records the active folder/workspace into OS/app recent history.
 *
 * Needed because launches with `--extensionDevelopmentPath` skip recent entries
 * in the main process (`noRecentEntry` / extension-development host). Home then
 * showed an empty recent list even after opening real projects.
 */
export class PreBaseRecentHistoryContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.prebase.recentHistory';

	constructor(
		@IWorkspacesService private readonly workspacesService: IWorkspacesService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
	) {
		super();
		this._recordCurrent();
		this._register(this.contextService.onDidChangeWorkbenchState(() => this._recordCurrent()));
		this._register(this.contextService.onDidChangeWorkspaceFolders(() => this._recordCurrent()));
	}

	private _recordCurrent(): void {
		const workspace = this.contextService.getWorkspace();
		const remoteAuthority = this.environmentService.remoteAuthority;
		switch (this.contextService.getWorkbenchState()) {
			case WorkbenchState.FOLDER:
				void this.workspacesService.addRecentlyOpened([{
					folderUri: workspace.folders[0].uri,
					remoteAuthority,
				}]);
				break;
			case WorkbenchState.WORKSPACE:
				if (workspace.configuration) {
					void this.workspacesService.addRecentlyOpened([{
						workspace: { id: workspace.id, configPath: workspace.configuration },
						remoteAuthority,
					}]);
				}
				break;
		}
	}
}

registerWorkbenchContribution2(PreBaseRecentHistoryContribution.ID, PreBaseRecentHistoryContribution, WorkbenchPhase.AfterRestored);
