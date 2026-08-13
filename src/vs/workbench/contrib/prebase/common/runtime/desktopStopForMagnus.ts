/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Narrow boundary for model-triggered desktop termination. */
export interface DesktopSessionTerminator {
	kill(): Promise<void>;
}

/**
 * Stop an owned desktop session via its confirmation-aware operation.
 * Extra legacy command arguments are intentionally ignored by JavaScript.
 */
export function stopDesktopSessionForMagnus(desktop: DesktopSessionTerminator): Promise<void> {
	return desktop.kill();
}
