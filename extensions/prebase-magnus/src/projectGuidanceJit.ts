/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { normalizeRel } from './projectGuidanceDiscovery';
import { resolveWorkspaceRootForPath } from './projectGuidanceService';
import { getProjectGuidanceSession, type GuidanceTarget } from './projectGuidanceSession';
import type { ToolCallItem } from './toolExecutor';

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
	const session = getProjectGuidanceSession();
	if (!session) {
		return [];
	}
	const added: GuidanceTarget[] = [];
	for (const call of calls) {
		if (!JIT_WORKSPACE_TOOLS.has(call.name)) {
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
