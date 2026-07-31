/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import type { DesktopLaunchMode, ElectronProjectProfile, PreBaseDesktopSession } from './desktopTypes.js';
import type { ProjectProbe } from './types.js';

export interface PreBaseDesktopLaunchOptions {
	launchMode?: DesktopLaunchMode;
	rendererUrl?: string;
	command?: string;
}

export interface IPreBaseRuntimeAdapter {
	readonly onDidChangeSession: Event<PreBaseDesktopSession | undefined>;

	detect(probe: ProjectProbe): ElectronProjectProfile;
	getProfile(): ElectronProjectProfile | undefined;
	getSession(): PreBaseDesktopSession | undefined;
	getLaunchMode(): DesktopLaunchMode;
	setLaunchMode(mode: DesktopLaunchMode, remember?: boolean): Promise<void>;

	start(options?: PreBaseDesktopLaunchOptions): Promise<PreBaseDesktopSession | undefined>;
	stop(): Promise<void>;
	restart(): Promise<void>;
	reload(): Promise<boolean>;
	inspect(): Promise<void>;
	kill(): Promise<void>;
}
