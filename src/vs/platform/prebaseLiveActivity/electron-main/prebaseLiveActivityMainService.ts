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

function loadNativeAddon(): NativeAddon | undefined {
	if (!isMacintosh) {
		return undefined;
	}
	const candidate = join(app.getAppPath(), 'native/prebase-live-activity/build/Release/prebase_live_activity.node');
	if (!existsSync(candidate)) {
		return undefined;
	}
	const nodeRequire = createRequire(join(app.getAppPath(), 'package.json'));
	return nodeRequire(candidate) as NativeAddon;
}

export class MagnusLiveActivityMainService extends Disposable implements IMagnusLiveActivityMainService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidCommand = this._register(new Emitter<LiveActivityCommand>());
	readonly onDidCommand = this._onDidCommand.event;

	private _native: NativeAddon | undefined;
	private _backend: 'native-appkit' | 'unavailable' = 'unavailable';

	constructor(
		@ILogService private readonly logService: ILogService,
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
			const addon = loadNativeAddon();
			if (!addon) {
				this.logService.info('[MagnusLiveActivity] native AppKit module not built; Live Activity UI unavailable until compile:live-activity');
				return;
			}
			addon.setCommandHandler((command) => this._onDidCommand.fire(command));
			this._native = addon;
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
			return this._native.getDiagnostics();
		} catch (err) {
			this.logService.warn('[MagnusLiveActivity] getNativeDiagnostics error', err);
			return undefined;
		}
	}

	async simulateAction(action: string, extras?: unknown): Promise<boolean> {
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

