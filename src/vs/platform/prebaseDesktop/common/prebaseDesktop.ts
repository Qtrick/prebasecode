/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import type { DesktopLaunchRequest, ExternalLaunchRequest, IPreBaseDesktopSpawnResult, ManagedWindowState } from './prebaseDesktopTypes.js';
import type { ProcessOutputEntry } from './processOutputBuffer.js';

export const PREBASE_DESKTOP_CHANNEL_NAME = 'prebaseDesktop';

export type { DesktopLaunchRequest, ExternalLaunchRequest, IPreBaseDesktopSpawnResult, ManagedWindowState };

export interface IPreBaseDesktopMainService {
	readonly _serviceBrand: undefined;

	readonly onDidCloseManagedWindow: Event<{ sessionId: string }>;
	readonly onDidStripAction: Event<{ sessionId: string; action: 'reload' | 'restart' | 'inspect' | 'kill' }>;

	openManagedWindow(request: DesktopLaunchRequest): Promise<ManagedWindowState>;
	closeManagedWindow(sessionId: string): Promise<void>;
	reloadManagedWindow(sessionId: string): Promise<void>;
	restartManagedWindow(sessionId: string, request: DesktopLaunchRequest): Promise<ManagedWindowState>;
	inspectManagedWindow(sessionId: string): Promise<void>;
	evaluateInManagedWindow(sessionId: string, expression: string): Promise<unknown>;
	/** PNG screenshot of app content only, base64-encoded. */
	captureManagedScreenshot(sessionId: string): Promise<string>;

	spawnExternal(request: ExternalLaunchRequest, cwd: string, debugPort: number, env?: Record<string, string>): Promise<IPreBaseDesktopSpawnResult>;
	getOwnedProcessOutput(pid: number, maximumEntries?: number): Promise<{ entries: ProcessOutputEntry[]; droppedCount: number; truncated: boolean }>;
	evaluateViaCdp(debugPort: number, expression: string): Promise<unknown>;
	killOwnedProcess(pid: number): Promise<void>;
	killAllOwned(): Promise<void>;
}

export const IPreBaseDesktopMainService = createDecorator<IPreBaseDesktopMainService>('prebaseDesktopMainService');
