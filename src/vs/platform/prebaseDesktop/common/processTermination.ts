/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type ProcessTerminationSignal = 'SIGTERM' | 'SIGKILL';

/** Process-tree operations needed to stop a PreBase-owned external application. */
export interface IProcessTerminationTarget {
	isExited(): boolean;
	sendSignal(signal: ProcessTerminationSignal): boolean;
	waitForExit(timeoutMs: number): Promise<boolean>;
}

/**
 * Requests a graceful process-tree shutdown, then escalates only if it remains alive.
 * The caller owns the platform-specific process-group signaling implementation.
 */
export async function terminateOwnedProcess(target: IProcessTerminationTarget, gracefulTimeoutMs = 3_000, forceTimeoutMs = 3_000): Promise<boolean> {
	if (target.isExited()) {
		return true;
	}
	if (!target.sendSignal('SIGTERM')) {
		return target.isExited();
	}
	if (await target.waitForExit(gracefulTimeoutMs)) {
		return true;
	}
	if (!target.sendSignal('SIGKILL')) {
		return target.isExited();
	}
	return target.waitForExit(forceTimeoutMs);
}
