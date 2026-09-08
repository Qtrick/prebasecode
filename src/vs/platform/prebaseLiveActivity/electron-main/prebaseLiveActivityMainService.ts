/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { app } from 'electron';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { Emitter } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../base/common/platform.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { ILifecycleMainService } from '../../lifecycle/electron-main/lifecycleMainService.js';
import { ILogService } from '../../log/common/log.js';
import type { LiveActivityCommand, MagnusLiveActivityDisplay, MagnusLiveActivitySnapshot } from '../common/magnusLiveActivity.js';
import { IMagnusLiveActivityMainService } from '../common/prebaseLiveActivity.js';

interface NativeAddon {
	setSnapshot(snapshot: MagnusLiveActivitySnapshot): void;
	setPresentation(state: { visible: boolean; pinned: boolean; reducedMotion: boolean; display: MagnusLiveActivityDisplay }): void;
	setCommandHandler(handler: (command: LiveActivityCommand) => void): void;
	getDiagnostics?(): Record<string, unknown>;
	simulateAction?(action: string, extras?: unknown): boolean;
	dispose(): void;
}

interface LoadedAddonResult {
	addon: NativeAddon;
	path: string;
}

function loadNativeAddon(): LoadedAddonResult | undefined {
	if (!isMacintosh) {
		return undefined;
	}
	const candidate = join(app.getAppPath(), 'native/prebase-live-activity/build/Release/prebase_live_activity.node');
	if (!existsSync(candidate)) {
		return undefined;
	}
	const nodeRequire = createRequire(join(app.getAppPath(), 'package.json'));
	return {
		addon: nodeRequire(candidate) as NativeAddon,
		path: candidate,
	};
}

export class MagnusLiveActivityMainService extends Disposable implements IMagnusLiveActivityMainService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidCommand = this._register(new Emitter<LiveActivityCommand>());
	readonly onDidCommand = this._onDidCommand.event;

	private _native: NativeAddon | undefined;
	private _addonPath: string | undefined;
	private _addonLoadedAt: string | undefined;
	private _backend: 'native-appkit' | 'unavailable' = 'unavailable';

	constructor(
		@ILogService private readonly logService: ILogService,
		@IEnvironmentMainService private readonly environmentMainService: IEnvironmentMainService,
		@ILifecycleMainService lifecycleMainService?: ILifecycleMainService,
	) {
		super();
		this._loadNative();
		lifecycleMainService?.onWillShutdown(e => {
			e.join('MagnusLiveActivityMainService', this.disposeNative());
		});
	}

	private _loadNative(): void {
		if (!isMacintosh) {
			return;
		}
		try {
			const loaded = loadNativeAddon();
			if (!loaded) {
				this.logService.info('[MagnusLiveActivity] native AppKit module not built; Live Activity UI unavailable until compile:live-activity');
				return;
			}
			loaded.addon.setCommandHandler((command) => this._onDidCommand.fire(command));
			this._native = loaded.addon;
			this._addonPath = loaded.path;
			this._addonLoadedAt = new Date().toISOString();
			this._backend = 'native-appkit';
			this._register({ dispose: () => this._teardown() });
			this.logService.info('[MagnusLiveActivity] native AppKit panel loaded');
		} catch (err) {
			this.logService.warn('[MagnusLiveActivity] failed to load native module', err);
		}
	}

	async setSnapshot(snapshot: MagnusLiveActivitySnapshot): Promise<void> {
		this._native?.setSnapshot(snapshot);
	}

	async setPresentation(state: { visible: boolean; pinned: boolean; reducedMotion: boolean; display: MagnusLiveActivityDisplay }): Promise<void> {
		this._native?.setPresentation(state);
	}

	async getNativeBackend(): Promise<'native-appkit' | 'unavailable'> {
		return this._backend;
	}

	async getNativeDiagnostics(): Promise<Record<string, unknown> | undefined> {
		if (!this._native?.getDiagnostics) {
			return undefined;
		}
		try {
			const diag = this._native.getDiagnostics();
			if (diag && typeof diag === 'object') {
				return {
					...diag,
					loadedAddonPath: this._addonPath,
					loadedAddonTimestamp: this._addonLoadedAt,
				};
			}
			return diag;
		} catch (err) {
			this.logService.warn('[MagnusLiveActivity] getNativeDiagnostics error', err);
			return undefined;
		}
	}

	async simulateAction(action: string, extras?: unknown): Promise<boolean> {
		if (!this.environmentMainService.args['enable-smoke-test-driver']) {
			return false;
		}
		if (!this._native?.simulateAction) {
			return false;
		}
		try {
			return this._native.simulateAction(action, extras);
		} catch (err) {
			this.logService.warn('[MagnusLiveActivity] simulateAction error', err);
			return false;
		}
	}

	async disposeNative(): Promise<void> {
		this._teardown();
	}

	private _teardown(): void {
		try {
			this._native?.dispose();
		} catch (err) {
			this.logService.warn('[MagnusLiveActivity] native dispose failed', err);
		}
		this._native = undefined;
		this._backend = 'unavailable';
	}
}

