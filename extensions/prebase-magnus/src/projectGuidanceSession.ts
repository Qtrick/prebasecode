/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { normalizeRel } from './projectGuidanceDiscovery';

/** Per chat-request guidance activation state (skills, intelligent/manual rules). */
export class ProjectGuidanceSession {
	private readonly activatedSkillNames = new Set<string>();
	private readonly activatedRulePaths = new Set<string>();
	private targetPaths = new Set<string>();

	addTargets(paths: readonly string[]): void {
		for (const path of paths) {
			const normalized = normalizeRel(path);
			if (normalized && !normalized.split('/').includes('..') && !normalized.startsWith('/') && !/^[a-zA-Z]:/.test(normalized)) {
				this.targetPaths.add(normalized);
			}
		}
	}

	getTargetPaths(): readonly string[] {
		return [...this.targetPaths];
	}

	activateSkill(name: string): void {
		if (name.trim()) {
			this.activatedSkillNames.add(name.trim());
		}
	}

	activateRule(path: string): void {
		const normalized = normalizeRel(path.trim());
		if (normalized) {
			this.activatedRulePaths.add(normalized);
		}
	}

	getActivatedSkillNames(): readonly string[] {
		return [...this.activatedSkillNames];
	}

	getActivatedRulePaths(): readonly string[] {
		return [...this.activatedRulePaths];
	}
}

let activeSession: ProjectGuidanceSession | undefined;

export function beginProjectGuidanceSession(targetPaths: readonly string[] = []): ProjectGuidanceSession {
	activeSession = new ProjectGuidanceSession();
	activeSession.addTargets(targetPaths);
	return activeSession;
}

export function getProjectGuidanceSession(): ProjectGuidanceSession | undefined {
	return activeSession;
}

export function endProjectGuidanceSession(): void {
	activeSession = undefined;
}
