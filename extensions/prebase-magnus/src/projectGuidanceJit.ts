/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { normalizeRel } from './projectGuidanceDiscovery';
import { computeGuidanceDelta, formatGuidanceDeltaForPrompt } from './projectGuidanceDelta';
import type { ProjectGuidanceService, ProjectGuidanceSnapshot } from './projectGuidanceService';
import { resolveWorkspaceRootForPath } from './projectGuidanceService';
import { getProjectGuidanceSession, type GuidanceTarget, type ProjectGuidanceSession } from './projectGuidanceSession';
import type { ToolCallItem } from './toolExecutor';

const MUTATION_WORKSPACE_TOOLS = new Set<string>([
	'prebase_edit_apply_file',
	'prebase_edit_apply',
	'prebase_edit_create_file',
	'prebase_edit_rename_file',
	'prebase_edit_delete_file',
]);

const JIT_WORKSPACE_TOOLS = new Set<string>([
	'prebase_workspace_read_file',
	'prebase_workspace_read_file_range',
	'prebase_workspace_search_text',
	'prebase_workspace_search_text_rich',
	'prebase_workspace_list_files',
	'prebase_workspace_search_symbols',
	'prebase_workspace_get_definition',
	'prebase_workspace_get_references',
	'prebase_workspace_get_diagnostics',
]);

function extractPathArg(args: Record<string, unknown>): string | undefined {
	for (const key of ['path', 'file', 'filePath', 'relativePath']) {
		const value = args[key];
		if (typeof value === 'string' && value.trim()) {
			return value.trim();
		}
	}
	return undefined;
}

export function resolveGuidanceTarget(
	relativeOrAbsolute: string,
	folders: readonly { uri: { fsPath: string } }[] | undefined,
	preferredRoot?: string,
): GuidanceTarget | undefined {
	if (!folders?.length) {
		return undefined;
	}
	const cleaned = normalizeRel(relativeOrAbsolute.trim());
	if (!cleaned || cleaned.split('/').includes('..')) {
		return undefined;
	}
	if (cleaned.startsWith('/') || /^[a-zA-Z]:/.test(cleaned)) {
		const absolute = resolve(cleaned);
		const root = resolveWorkspaceRootForPath(absolute, folders);
		if (!root) {
			return undefined;
		}
		const rel = normalizeRel(absolute.slice(resolve(root).length).replace(/^[/\\]/, ''));
		return { workspaceRoot: resolve(root), relativePath: rel || cleaned };
	}
	const matches: GuidanceTarget[] = [];
	for (const folder of folders) {
		const root = resolve(folder.uri.fsPath);
		const full = join(root, cleaned);
		if (existsSync(full)) {
			matches.push({ workspaceRoot: root, relativePath: cleaned });
		}
	}
	if (matches.length === 1) {
		return matches[0];
	}
	if (matches.length > 1 && preferredRoot) {
		const preferred = resolve(preferredRoot);
		const match = matches.find(item => item.workspaceRoot === preferred);
		if (match) {
			return match;
		}
	}
	if (matches.length > 1) {
		return matches[0];
	}
	for (const folder of folders) {
		const root = resolve(folder.uri.fsPath);
		const relFromRoot = normalizeRel(cleaned);
		const full = join(root, relFromRoot);
		if (full.startsWith(`${root}${sep}`) || full === root) {
			return { workspaceRoot: root, relativePath: relFromRoot };
		}
	}
	return undefined;
}

export function registerGuidanceTargetsFromToolCalls(
	calls: readonly ToolCallItem[],
	folders: readonly { uri: { fsPath: string } }[] | undefined,
	preferredRoot?: string,
): readonly GuidanceTarget[] {
	return registerReadTargetsBeforeExecution(calls, folders, preferredRoot);
}

export function isMutationTool(toolName: string): boolean {
	return MUTATION_WORKSPACE_TOOLS.has(toolName);
}

/** Paths touched by a mutating workspace tool (relative or absolute strings). */
export function extractMutationPathStrings(call: ToolCallItem): string[] {
	const paths: string[] = [];
	const push = (value: unknown) => {
		if (typeof value === 'string' && value.trim()) {
			paths.push(value.trim());
		}
	};
	switch (call.name) {
		case 'prebase_edit_apply_file':
		case 'prebase_edit_create_file':
		case 'prebase_edit_delete_file': {
			const pathArg = extractPathArg(call.args);
			if (pathArg) {
				paths.push(pathArg);
			}
			break;
		}
		case 'prebase_edit_rename_file': {
			push(call.args.from);
			push(call.args.to);
			break;
		}
		case 'prebase_edit_apply': {
			const files = call.args.files;
			if (Array.isArray(files)) {
				for (const file of files) {
					if (file && typeof file === 'object' && 'path' in file) {
						push((file as { path?: unknown }).path);
					}
				}
			}
			break;
		}
		default:
			break;
	}
	return paths;
}

export function registerMutationTargetsFromToolCall(
	call: ToolCallItem,
	folders: readonly { uri: { fsPath: string } }[] | undefined,
	preferredRoot?: string,
	session = getProjectGuidanceSession(),
): readonly GuidanceTarget[] {
	if (!session || !isMutationTool(call.name)) {
		return [];
	}
	const added: GuidanceTarget[] = [];
	for (const pathArg of extractMutationPathStrings(call)) {
		const target = resolveGuidanceTarget(pathArg, folders, preferredRoot);
		if (!target) {
			continue;
		}
		const before = session.getTargets().length;
		session.addTarget(target.workspaceRoot, target.relativePath);
		if (session.getTargets().length > before) {
			added.push(target);
		}
	}
	return added;
}

export interface MutationPreflightOutcome {
	readonly defer: boolean;
	readonly paths: readonly string[];
	readonly deltaBlock?: string;
	readonly updatedSnapshot?: ProjectGuidanceSnapshot;
}

export interface MutationPreflightContext {
	readonly service: ProjectGuidanceService;
	readonly session: ProjectGuidanceSession;
	getPreviousSnapshot: () => ProjectGuidanceSnapshot | undefined;
	updateSnapshot: (snapshot: ProjectGuidanceSnapshot) => void;
	readonly enabled: boolean;
}

/** Register mutation targets and defer when unseen path-specific guidance would apply. */
export async function preflightMutationGuidance(
	call: ToolCallItem,
	folders: readonly { uri: { fsPath: string } }[] | undefined,
	preferredRoot: string | undefined,
	ctx: MutationPreflightContext,
): Promise<MutationPreflightOutcome> {
	if (!ctx.enabled || !isMutationTool(call.name)) {
		return { defer: false, paths: [] };
	}
	const pathStrings = extractMutationPathStrings(call);
	registerMutationTargetsFromToolCall(call, folders, preferredRoot, ctx.session);
	const previous = ctx.getPreviousSnapshot();
	if (!previous) {
		return { defer: false, paths: pathStrings };
	}
	const currentSnapshot = await ctx.service.getCombinedSnapshot(
		ctx.session.getTargets(),
		ctx.session.getActivatedSkillIds(),
		true,
		ctx.session.getActivatedRulePaths(),
	);
	const delta = computeGuidanceDelta(previous, currentSnapshot, ctx.session);
	if (!delta.newlyApplied.length) {
		ctx.updateSnapshot(currentSnapshot);
		return { defer: false, paths: pathStrings, updatedSnapshot: currentSnapshot };
	}
	const deltaBlock = formatGuidanceDeltaForPrompt(delta);
	ctx.updateSnapshot(currentSnapshot);
	return { defer: true, paths: pathStrings, deltaBlock, updatedSnapshot: currentSnapshot };
}

export function registerReadTargetsBeforeExecution(
	calls: readonly ToolCallItem[],
	folders: readonly { uri: { fsPath: string } }[] | undefined,
	preferredRoot?: string,
): readonly GuidanceTarget[] {
	const session = getProjectGuidanceSession();
	if (!session) {
		return [];
	}
	const added: GuidanceTarget[] = [];
	for (const call of calls) {
		if (isMutationTool(call.name) || !JIT_WORKSPACE_TOOLS.has(call.name)) {
			continue;
		}
		const pathArg = extractPathArg(call.args);
		if (!pathArg) {
			continue;
		}
		const target = resolveGuidanceTarget(pathArg, folders, preferredRoot);
		if (!target) {
			continue;
		}
		const before = session.getTargets().length;
		session.addTarget(target.workspaceRoot, target.relativePath);
		if (session.getTargets().length > before) {
			added.push(target);
		}
	}
	return added;
}
