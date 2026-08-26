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

export interface DesktopShutdownPolicy {
	readonly closeManagedWindows: boolean;
	readonly terminateOwnedChildren: boolean;
}

/**
 * Production shutdown policy for PreBase desktop sessions.
 * Managed windows are PreBase-owned BrowserWindow sessions.
 * Owned children are externally spawned Electron processes PreBase still tracks.
 * Intentionally detached preview apps survive when stopExternalAppsOnExit is false.
 * Test-owned children are terminated by the caller, not by flipping this preview policy.
 */
export function resolveDesktopShutdownPolicy(stopManagedAppsOnExit = true, stopExternalAppsOnExit = false): DesktopShutdownPolicy {
	return {
		closeManagedWindows: stopManagedAppsOnExit,
		terminateOwnedChildren: stopExternalAppsOnExit,
	};
}

/** POSIX SIGTERM then SIGKILL budget used by terminateOwnedProcess defaults. */
export const POSIX_OWNED_PROCESS_TERMINATION_BUDGET_MS = 6_000;

/**
 * Requests a graceful process-tree shutdown, then escalates only if it remains alive.
 * Default budget is 3s SIGTERM + 3s SIGKILL ≈ 6s, not 4s.
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
