/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { detectElectronProject } from './electronDetector.js';
import { detectTauriProject } from './tauriDetector.js';
import type { DesktopDetectionConfidence, DesktopFramework, DesktopProjectProfile } from './desktopTypes.js';
import { isRecognizedDesktopApp } from './desktopTypes.js';
import type { ProjectProbe } from './types.js';

const CONFIDENCE_RANK: Record<DesktopDetectionConfidence, number> = {
	none: 0,
	low: 1,
	medium: 2,
	high: 3,
};

/** Returns recognized Electron and/or Tauri profiles for the probed app root. */
export function detectDesktopProjects(probe: ProjectProbe): DesktopProjectProfile[] {
	const electron = detectElectronProject(probe);
	const tauri = detectTauriProject(probe);
	const recognized: DesktopProjectProfile[] = [];
	if (isRecognizedDesktopApp(electron)) {
		recognized.push(electron);
	}
	if (isRecognizedDesktopApp(tauri)) {
		recognized.push(tauri);
	}
	return recognized;
}

/**
 * Choose one desktop profile for the active app root.
 * Ambiguous Electron+Tauri workspaces keep both in `detectDesktopProjects`;
 * this picker prefers an explicit framework, then higher confidence.
 */
export function selectDesktopProfile(
	projects: readonly DesktopProjectProfile[],
	preferred?: DesktopFramework,
): DesktopProjectProfile | undefined {
	if (preferred) {
		const match = projects.find(project => project.framework === preferred);
		if (match) {
			return match;
		}
	}
	if (projects.length === 0) {
		return undefined;
	}
	return [...projects].sort((a, b) => CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence] || a.framework.localeCompare(b.framework))[0];
}

export function detectSelectedDesktopProject(probe: ProjectProbe, preferred?: DesktopFramework): DesktopProjectProfile | undefined {
	return selectDesktopProfile(detectDesktopProjects(probe), preferred);
}
