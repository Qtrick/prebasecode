/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

export function requireSmokeTestDriver(enabled: boolean | undefined, commandId: string): void {
	if (!enabled) {
		throw new Error(`${commandId} requires --enable-smoke-test-driver`);
	}
}
