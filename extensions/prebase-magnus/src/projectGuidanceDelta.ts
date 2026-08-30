/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { boundedJoin } from './projectGuidanceDiscovery';
import {
	DEFAULT_GUIDANCE_BUDGET,
	formatProjectGuidanceForPrompt,
	MAX_PROMPT_GUIDANCE_CHARS,
	type ProjectGuidanceSnapshot,
	scrubSecretsFromGuidance,
} from './projectGuidanceService';
import type { GuidanceTextBlock } from './projectGuidanceService';
import type { ProjectGuidanceSession } from './projectGuidanceSession';

export interface GuidanceDelta {
	readonly newlyApplied: readonly { sourceId: string; path: string; root: string; ecosystem: string; text: string }[];
	readonly newlyAvailableRules: readonly { path: string; description: string; activationMode: string }[];
	readonly newlyAvailableSkills: readonly { id: string; name: string; description: string; path: string }[];
	readonly diagnostics: readonly string[];
}

function sourceId(root: string, path: string): string {
	return `${root}::${path}`;
}

function blockRoot(snapshotRoot: string, item: GuidanceTextBlock): string {
	return item.workspaceRoot || snapshotRoot;
}

export function computeGuidanceDelta(
	previous: ProjectGuidanceSnapshot,
	current: ProjectGuidanceSnapshot,
	session: ProjectGuidanceSession,
): GuidanceDelta {
	const newlyApplied: GuidanceDelta['newlyApplied'][number][] = [];
	for (const item of [...current.alwaysApplicable, ...current.pathApplicable, ...current.activatedRules]) {
		const root = blockRoot(current.workspaceRoot, item);
		const id = sourceId(root, item.source.path);
		if (session.hasSeenSource(id, item.source.contentHash)) {
			continue;
		}
		session.markSeenSource(id, item.source.contentHash);
		newlyApplied.push({
			sourceId: id,
			path: item.source.path,
			root,
			ecosystem: item.source.ecosystem,
			text: item.text,
		});
	}

	const prevOnDemand = new Set(previous.onDemandRules.map(r => r.source.path));
	const prevSkills = new Set(previous.skillCatalog.map(s => s.id ?? s.path));

	const newlyAvailableRules = current.onDemandRules
		.filter(r => !prevOnDemand.has(r.source.path))
		.map(r => ({
			path: r.source.path,
			description: r.description,
			activationMode: r.source.activationMode,
		}));

	const newlyAvailableSkills = current.skillCatalog
		.filter(s => !prevSkills.has(s.id ?? s.path))
		.map(s => ({
			id: s.id ?? s.path,
			name: s.name,
			description: s.description,
			path: s.path,
		}));

	return {
		newlyApplied,
		newlyAvailableRules,
		newlyAvailableSkills,
		diagnostics: current.diagnostics.filter(d => !previous.diagnostics.includes(d)),
	};
}

export function formatGuidanceDeltaForPrompt(delta: GuidanceDelta, maxChars = DEFAULT_GUIDANCE_BUDGET.maxPathChars): string {
	if (!delta.newlyApplied.length && !delta.newlyAvailableRules.length && !delta.newlyAvailableSkills.length) {
		return '';
	}
	const parts: string[] = ['PROJECT GUIDANCE UPDATE (newly applicable for files touched this request)'];
	if (delta.newlyApplied.length) {
		const blocks = delta.newlyApplied.map(item =>
			`Source: ${item.path} (${item.ecosystem}, root: ${item.root})\n${scrubSecretsFromGuidance(item.text)}`);
		const joined = boundedJoin(blocks, maxChars);
		if (joined) {
			parts.push(joined);
		}
	}
	if (delta.newlyAvailableRules.length) {
		const lines = ['NEW ON-DEMAND RULES (activate with prebase_project_guidance when relevant)'];
		for (const rule of delta.newlyAvailableRules.slice(0, 16)) {
			lines.push(`- ${rule.path}: ${scrubSecretsFromGuidance(rule.description)} [${rule.activationMode}]`);
		}
		parts.push(lines.join('\n'));
	}
	if (delta.newlyAvailableSkills.length) {
		const lines = ['NEW PROJECT SKILLS (metadata only until activated)'];
		for (const skill of delta.newlyAvailableSkills.slice(0, 16)) {
			lines.push(`- ${skill.name} (${skill.id}): ${scrubSecretsFromGuidance(skill.description)}`);
		}
		parts.push(lines.join('\n'));
	}
	let result = parts.join('\n\n').trim();
	if (result.length > MAX_PROMPT_GUIDANCE_CHARS) {
		result = `${result.slice(0, MAX_PROMPT_GUIDANCE_CHARS)}\n\n[project guidance update truncated]`;
	}
	return result;
}

export function seedSessionFromSnapshot(snapshot: ProjectGuidanceSnapshot, session: ProjectGuidanceSession): void {
	for (const item of [...snapshot.alwaysApplicable, ...snapshot.pathApplicable, ...snapshot.activatedRules]) {
		const root = blockRoot(snapshot.workspaceRoot, item);
		session.markSeenSource(sourceId(root, item.source.path), item.source.contentHash);
	}
}

export function formatInitialGuidanceBlock(snapshot: ProjectGuidanceSnapshot): string {
	return formatProjectGuidanceForPrompt(snapshot);
}

export function formatGetForPathsResult(
	snapshot: ProjectGuidanceSnapshot,
	delta: GuidanceDelta,
): Record<string, unknown> {
	const hasDelta = delta.newlyApplied.length > 0;
	return {
		ok: true,
		root: snapshot.workspaceRoot,
		paths: snapshot.pathApplicable.map(item => item.source.path),
		newlyApplied: delta.newlyApplied.map(item => ({
			path: item.path,
			root: item.root,
			ecosystem: item.ecosystem,
			body: scrubSecretsFromGuidance(item.text),
		})),
		newlyAvailableRules: delta.newlyAvailableRules,
		newlyAvailableSkills: delta.newlyAvailableSkills,
		always: hasDelta
			? snapshot.alwaysApplicable.map(item => item.source.path)
			: snapshot.alwaysApplicable.map(item => ({ path: item.source.path, body: scrubSecretsFromGuidance(item.text) })),
		pathScoped: hasDelta
			? snapshot.pathApplicable.map(item => item.source.path)
			: snapshot.pathApplicable.map(item => ({ path: item.source.path, body: scrubSecretsFromGuidance(item.text) })),
		onDemand: snapshot.onDemandRules.map(item => ({ path: item.source.path, description: scrubSecretsFromGuidance(item.description) })),
		skills: snapshot.skillCatalog.map(item => ({ id: item.id, name: item.name, description: scrubSecretsFromGuidance(item.description), path: item.path })),
		playbooks: snapshot.playbookCatalog?.map(item => ({ id: item.id, name: item.name, description: scrubSecretsFromGuidance(item.description), path: item.path })) ?? [],
		agentProfiles: snapshot.agentProfileCatalog?.map(item => ({ id: item.id, name: item.name, description: scrubSecretsFromGuidance(item.description), path: item.path })) ?? [],
		diagnostics: [...snapshot.diagnostics, ...delta.diagnostics],
	};
}
