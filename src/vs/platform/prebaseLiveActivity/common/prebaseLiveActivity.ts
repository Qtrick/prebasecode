/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { MAGNUS_LIVE_ACTIVITY_CHANNEL, type LiveActivityCommand, type MagnusLiveActivityDisplay, type MagnusLiveActivitySnapshot } from './magnusLiveActivity.js';

export { MAGNUS_LIVE_ACTIVITY_CHANNEL };

export interface IMagnusLiveActivityMainService {
	readonly _serviceBrand: undefined;

	readonly onDidCommand: Event<LiveActivityCommand>;

	setSnapshot(snapshot: MagnusLiveActivitySnapshot): Promise<void>;
	setPresentation(state: { visible: boolean; pinned: boolean; reducedMotion: boolean; display: MagnusLiveActivityDisplay }): Promise<void>;
	disposeNative(): Promise<void>;
	getNativeBackend(): Promise<'native-appkit' | 'unavailable'>;
	getNativeDiagnostics(): Promise<Record<string, unknown> | undefined>;
	simulateAction(action: string, extras?: unknown): Promise<boolean>;
}

export const IMagnusLiveActivityMainService = createDecorator<IMagnusLiveActivityMainService>('magnusLiveActivityMainService');

