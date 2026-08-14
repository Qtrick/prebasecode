/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type PreBaseStartupAccountState = 'initializing' | 'signedOut' | 'signingIn' | 'signedIn' | 'error' | 'unconfigured';

export type PreBaseStartupDecision = 'wait' | 'show-auth' | 'open-onboarding' | 'continue';

/**
 * Keeps startup presentation separate from persistence and network restoration.
 * `offlineDismissed` is deliberately process-local: it must not become a remembered sign-out.
 */
export function decidePreBaseStartup(
	state: PreBaseStartupAccountState,
	onboardingComplete: boolean,
	offlineDismissed: boolean,
): PreBaseStartupDecision {
	if (state === 'initializing' || state === 'signingIn') {
		return 'wait';
	}
	if (state === 'signedIn' || offlineDismissed) {
		return onboardingComplete ? 'continue' : 'open-onboarding';
	}
	return 'show-auth';
}
