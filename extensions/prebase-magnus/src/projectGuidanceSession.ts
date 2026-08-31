/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AsyncLocalStorage } from 'node:async_hooks';
import { normalizeRel } from './projectGuidanceDiscovery';

/** Stable per-workspace-root target identity for multi-root workspaces. */
export interface GuidanceTarget {
	readonly workspaceRoot: string;
	readonly relativePath: string;
}

export function guidanceTargetKey(target: GuidanceTarget): string {
	return `${target.workspaceRoot}::${target.relativePath}`;
}

/** Per chat-request guidance activation state (skills, intelligent/manual rules, seen sources). */
export class ProjectGuidanceSession {
	private readonly targets = new Map<string, GuidanceTarget>();
	private readonly activatedSkillIds = new Set<string>();
	private readonly activatedRulePaths = new Set<string>();
	private readonly seenSources = new Map<string, string | undefined>();

	addTarget(workspaceRoot: string, relativePath: string): void {
		const normalized = normalizeRel(relativePath);
		if (!normalized || normalized.split('/').includes('..') || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
			return;
		}
		const target: GuidanceTarget = { workspaceRoot, relativePath: normalized };
		this.targets.set(guidanceTargetKey(target), target);
	}

	addTargets(targets: readonly GuidanceTarget[]): void {
		for (const target of targets) {
			this.addTarget(target.workspaceRoot, target.relativePath);
		}
	}

	getTargets(): readonly GuidanceTarget[] {
		return [...this.targets.values()];
	}

	getTargetPathsForRoot(workspaceRoot: string): readonly string[] {
		return this.getTargets()
			.filter(item => item.workspaceRoot === workspaceRoot)
			.map(item => item.relativePath);
	}

	activateSkillId(skillId: string): void {
		const trimmed = skillId.trim();
		if (trimmed) {
			this.activatedSkillIds.add(trimmed);
		}
	}

	/** @deprecated Prefer activateSkillId; bare names resolved at service layer. */
	activateSkill(name: string): void {
		this.activateSkillId(name.trim());
	}

	activateRule(path: string): void {
		const normalized = normalizeRel(path.trim());
		if (!normalized || normalized.split('/').includes('..') || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
			return;
		}
		this.activatedRulePaths.add(normalized);
	}

	activatePlaybook(path: string): void {
		this.activateRule(path);
	}

	activateAgentProfile(pathOrId: string): void {
		this.activateRule(pathOrId);
	}

	getActivatedSkillIds(): readonly string[] {
		return [...this.activatedSkillIds];
	}

	getActivatedSkillNames(): readonly string[] {
		return this.getActivatedSkillIds();
	}

	getActivatedRulePaths(): readonly string[] {
		return [...this.activatedRulePaths];
	}

	markSeenSource(sourceId: string, contentHash?: string): void {
		this.seenSources.set(sourceId, contentHash);
	}

	hasSeenSource(sourceId: string, contentHash?: string): boolean {
		if (!this.seenSources.has(sourceId)) {
			return false;
		}
		if (!contentHash) {
			return true;
		}
		return this.seenSources.get(sourceId) === contentHash;
	}
}

const sessionStore = new AsyncLocalStorage<ProjectGuidanceSession>();

export function runWithProjectGuidanceSession<T>(session: ProjectGuidanceSession, fn: () => T): T;
export function runWithProjectGuidanceSession<T>(session: ProjectGuidanceSession, fn: () => Promise<T>): Promise<T>;
export function runWithProjectGuidanceSession<T>(session: ProjectGuidanceSession, fn: () => T | Promise<T>): T | Promise<T> {
	return sessionStore.run(session, fn);
}

export function getProjectGuidanceSession(): ProjectGuidanceSession | undefined {
	return sessionStore.getStore();
}

export function createProjectGuidanceSession(initialTargets: readonly GuidanceTarget[] = []): ProjectGuidanceSession {
	const session = new ProjectGuidanceSession();
	session.addTargets(initialTargets);
	return session;
}

/** @deprecated Use createProjectGuidanceSession + runWithProjectGuidanceSession. */
export function beginProjectGuidanceSession(targetPaths: readonly string[] = [], workspaceRoot?: string): ProjectGuidanceSession {
	const session = createProjectGuidanceSession();
	if (workspaceRoot) {
		for (const path of targetPaths) {
			session.addTarget(workspaceRoot, path);
		}
	}
	return session;
}

/** @deprecated ALS clears automatically when runWithProjectGuidanceSession scope ends. */
export function endProjectGuidanceSession(): void {
	// Intentionally no-op: AsyncLocalStorage scope ends with the chat handler.
}
