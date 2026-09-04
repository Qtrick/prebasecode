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

/**
 * Merge process env with a caller overlay, then strip keys that must not leak into
 * PreBase-owned Electron/Tauri children. Overlay cannot re-inject stripped keys.
 * spawnExternal may set TAURI_WEBDRIVER_PORT afterward for an owned WebDriver session.
 *
 * Linux WebKitGTK otherwise inherits broken desktop proxy lookups ("Unspecified proxy
 * lookup failure") and refuses local asset/dev URLs; pin an in-memory GSettings backend
 * and clear proxy vars for owned children only.
 */
export function sanitizeOwnedDesktopChildEnv(
	processEnv: NodeJS.Dict<string>,
	overlay: Record<string, string> = {},
): Record<string, string> {
	const childEnv: Record<string, string> = { ...processEnv as Record<string, string>, ...overlay };
	delete childEnv.ELECTRON_RUN_AS_NODE;
	delete childEnv.TAURI_WEBDRIVER_PORT;
	delete childEnv.CARGO_TARGET_DIR;
	delete childEnv.CARGO_BUILD_TARGET_DIR;
	if (process.platform === 'linux') {
		childEnv.GSETTINGS_BACKEND = 'memory';
		for (const key of [
			'http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY',
			'all_proxy', 'ALL_PROXY', 'no_proxy', 'NO_PROXY',
		]) {
			delete childEnv[key];
		}
	}
	return childEnv;
}

/** POSIX SIGTERM then SIGKILL budget used by terminateOwnedProcess defaults. */
export const POSIX_OWNED_PROCESS_TERMINATION_BUDGET_MS = 6_000;

/**
 * Requests a graceful process-tree shutdown, then escalates only if it remains alive.
 * Default budget is 3s SIGTERM + 3s SIGKILL ~ 6s, not 4s.
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
