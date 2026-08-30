/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename, join } from 'node:path';
import type { GuidanceFileReader } from './projectGuidanceService';

const SKIP_DIR_NAMES = new Set(['.git', 'node_modules', '.build', 'out', 'dist', 'coverage']);
const MAX_WALK_DIRS = 400;
const MAX_WALK_DEPTH = 8;
const MAX_IMPORT_DEPTH = 4;
const MAX_IMPORT_BYTES = 48_000;

export type FrontmatterValue = string | boolean | string[];

export function normalizeRel(path: string): string {
	return path.replace(/\\/g, '/');
}

export function parseFrontmatter(text: string): { meta: Record<string, FrontmatterValue>; body: string } {
	if (!text.startsWith('---')) {
		return { meta: {}, body: text };
	}
	const end = text.indexOf('\n---', 3);
	if (end < 0) {
		return { meta: {}, body: text };
	}
	const header = text.slice(3, end).trim();
	const body = text.slice(end + 4).replace(/^\n/, '');
	const meta: Record<string, FrontmatterValue> = {};
	let currentListKey: string | undefined;
	for (const rawLine of header.split('\n')) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) {
			continue;
		}
		const listItem = /^-\s+(.+)$/.exec(line);
		if (listItem && currentListKey) {
			const existing = meta[currentListKey];
			const value = listItem[1].replace(/^['"]|['"]$/g, '');
			meta[currentListKey] = Array.isArray(existing) ? [...existing, value] : [value];
			continue;
		}
		currentListKey = undefined;
		const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
		if (!match) {
			continue;
		}
		const [, key, raw] = match;
		if (raw === 'true') {
			meta[key] = true;
		} else if (raw === 'false') {
			meta[key] = false;
		} else if (raw === '' || raw === '[]') {
			meta[key] = [];
			currentListKey = key;
		} else if (raw.startsWith('[') && raw.endsWith(']')) {
			meta[key] = raw.slice(1, -1).split(',').map(item => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
		} else {
			meta[key] = raw.replace(/^['"]|['"]$/g, '');
		}
	}
	return { meta, body };
}

export function metaStringList(meta: Record<string, FrontmatterValue>, key: string): string[] {
	const value = meta[key];
	if (Array.isArray(value)) {
		return value.map(item => String(item).trim()).filter(Boolean);
	}
	if (typeof value === 'string' && value.trim()) {
		return value.split(',').map(item => item.trim()).filter(Boolean);
	}
	return [];
}

export function parseApplyTo(text: string): string[] {
	const { meta, body } = parseFrontmatter(text);
	const applyTo = metaStringList(meta, 'applyTo');
	if (applyTo.length) {
		return applyTo;
	}
	const globs = metaStringList(meta, 'globs');
	if (globs.length) {
		return globs;
	}
	const paths = metaStringList(meta, 'paths');
	if (paths.length) {
		return paths;
	}
	const match = body.match(/applyTo:\s*([^\n]+)/);
	return match ? match[1].split(',').map(item => item.trim()).filter(Boolean) : [];
}

export function boundedJoin(blocks: readonly string[], maxChars: number): string {
	let total = 0;
	const kept: string[] = [];
	for (const block of blocks) {
		const remaining = maxChars - total;
		if (remaining <= 0) {
			break;
		}
		if (block.length <= remaining) {
			kept.push(block);
			total += block.length + (kept.length > 1 ? 2 : 0);
			continue;
		}
		if (remaining > 40) {
			kept.push(`${block.slice(0, remaining - 28)}\n\n[guidance truncated: ${basename(block.split('\n')[0] ?? 'source')}]`);
		}
		break;
	}
	return kept.join('\n\n');
}

export async function walkBoundedFiles(
	reader: GuidanceFileReader,
	rootDir: string,
	predicate: (relPath: string) => boolean,
	options: { maxDepth?: number; maxDirs?: number } = {},
): Promise<string[]> {
	const maxDepth = options.maxDepth ?? MAX_WALK_DEPTH;
	const maxDirs = options.maxDirs ?? MAX_WALK_DIRS;
	const results: string[] = [];
	let dirCount = 0;

	async function walk(absDir: string, relDir: string, depth: number): Promise<void> {
		if (depth > maxDepth || dirCount >= maxDirs) {
			return;
		}
		dirCount++;
		let entries: string[];
		try {
			entries = await reader.readDirectory(absDir);
		} catch {
			return;
		}
		for (const entry of entries) {
			const rel = relDir ? normalizeRel(join(relDir, entry)) : entry;
			const abs = join(absDir, entry);
			let subEntries: string[] | undefined;
			try {
				subEntries = await reader.readDirectory(abs);
			} catch {
				subEntries = undefined;
			}
			if (subEntries) {
				if (!SKIP_DIR_NAMES.has(entry)) {
					await walk(abs, rel, depth + 1);
				}
				continue;
			}
			if (predicate(rel)) {
				results.push(rel);
			}
		}
	}

	await walk(rootDir, '', 0);
	return results.sort();
}

export function agentsAncestorDirs(targetPath: string): string[] {
	const normalized = normalizeRel(targetPath);
	const parts = normalized.split('/').filter(Boolean);
	const dirs = [''];
	for (let i = 0; i < parts.length; i++) {
		dirs.push(parts.slice(0, i + 1).join('/'));
	}
	return dirs;
}

export async function resolveMarkdownImports(
	reader: GuidanceFileReader,
	_bodyWorkspaceRoot: string,
	body: string,
	isBlocked: (rel: string) => boolean,
	resolvePath: (rel: string) => string | undefined,
): Promise<{ text: string; diagnostics: string[] }> {
	const diagnostics: string[] = [];
	const seen = new Set<string>();

	async function expand(text: string, depth: number, stack: string[]): Promise<string> {
		if (depth > MAX_IMPORT_DEPTH) {
			diagnostics.push('Import depth limit reached.');
			return text;
		}
		const importPattern = /@\.?\/?([^\s`]+)/g;
		let result = '';
		let lastIndex = 0;
		for (const match of text.matchAll(importPattern)) {
			const index = match.index ?? 0;
			result += text.slice(lastIndex, index);
			lastIndex = index + match[0].length;
			const rel = normalizeRel(match[1]);
			if (isBlocked(rel) || stack.includes(rel)) {
				diagnostics.push(`Skipped import ${rel}`);
				continue;
			}
			const full = resolvePath(rel);
			if (!full || seen.has(full)) {
				diagnostics.push(`Missing or cyclic import: ${rel}`);
				continue;
			}
			seen.add(full);
			let imported = '';
			try {
				imported = await reader.readFile(full);
			} catch {
				diagnostics.push(`Unreadable import: ${rel}`);
				continue;
			}
			if (imported.length > MAX_IMPORT_BYTES) {
				imported = `${imported.slice(0, MAX_IMPORT_BYTES)}\n[import truncated]`;
			}
			const { body: importedBody } = parseFrontmatter(imported);
			result += await expand(importedBody, depth + 1, [...stack, rel]);
		}
		result += text.slice(lastIndex);
		return result;
	}

	return { text: await expand(body, 0, []), diagnostics };
}

export function cursorRuleMode(meta: Record<string, FrontmatterValue>, globs: string[]): 'always' | 'path' | 'intelligent' | 'manual' {
	if (meta.alwaysApply === true) {
		return 'always';
	}
	if (globs.length) {
		return 'path';
	}
	if (typeof meta.description === 'string' && meta.description.trim()) {
		return 'intelligent';
	}
	return 'manual';
}

export async function discoverSkillFiles(
	reader: GuidanceFileReader,
	workspaceRoot: string,
	skillRoots: readonly { dir: string; ecosystem: string }[],
	isBlocked: (rel: string) => boolean,
): Promise<Array<{ relPath: string; ecosystem: string }>> {
	const found: Array<{ relPath: string; ecosystem: string }> = [];
	for (const root of skillRoots) {
		const absRoot = join(workspaceRoot, root.dir);
		if (!(await reader.exists(absRoot))) {
			continue;
		}
		const skillFiles = await walkBoundedFiles(reader, absRoot, rel => rel.endsWith('/SKILL.md') || rel === 'SKILL.md', { maxDepth: 6 });
		for (const relUnderRoot of skillFiles) {
			const relPath = normalizeRel(join(root.dir, relUnderRoot.replace(/^\/?/, '')));
			if (!isBlocked(relPath)) {
				found.push({ relPath, ecosystem: root.ecosystem });
			}
		}
	}
	return found;
}
