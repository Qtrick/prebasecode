/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename, dirname, join } from 'node:path';
import type { GuidanceFileReader } from './projectGuidanceService';

/** Declarative skill roots — discovery + watcher patterns derive from this. */
export const SKILL_DIRS = [
	{ dir: '.agents/skills', ecosystem: 'agents' },
	{ dir: '.cursor/skills', ecosystem: 'cursor' },
	{ dir: '.claude/skills', ecosystem: 'claude' },
	{ dir: '.codex/skills', ecosystem: 'codex' },
	{ dir: '.github/skills', ecosystem: 'github' },
	{ dir: '.cline/skills', ecosystem: 'cline' },
	{ dir: '.clinerules/skills', ecosystem: 'cline' },
	{ dir: '.windsurf/skills', ecosystem: 'windsurf' },
	{ dir: '.opencode/skills', ecosystem: 'opencode' },
	{ dir: '.gemini/skills', ecosystem: 'gemini' },
	{ dir: '.kiro/skills', ecosystem: 'kiro' },
	{ dir: '.devin/skills', ecosystem: 'devin' },
	{ dir: '.cognition/skills', ecosystem: 'cognition' },
	{ dir: '.codeium/skills', ecosystem: 'codeium' },
] as const;

/** Non-skill watcher patterns (ecosystem semantics stay explicit). */
const GUIDANCE_WATCH_BASE = [
	'**/AGENTS.md',
	'**/AGENTS.override.md',
	'**/CLAUDE.md',
	'**/CLAUDE.local.md',
	'**/.claude/CLAUDE.md',
	'**/.claude/rules/**',
	'**/.claude/settings.json',
	'**/.claude/settings.local.json',
	'**/.claude/commands/**',
	'**/.claude/agents/**',
	'**/.cursor/rules/**',
	'**/.cursor/commands/**',
	'**/.cursor/agents/**',
	'**/.cursorrules',
	'**/.codex/agents/**',
	'**/.github/copilot-instructions.md',
	'**/.github/instructions/**',
	'**/.github/prompts/**',
	'**/GEMINI.md',
	'**/.gemini/settings.json',
	'**/.cline/rules/**',
	'**/.clinerules/**',
	'**/.cline/workflows/**',
	'**/.windsurfrules',
	'**/.windsurf/rules/**',
	'**/.windsurf/workflows/**',
	'**/.devin/rules/**',
	'**/.kiro/steering/**',
	'**/opencode.json',
	'**/.opencode/opencode.json',
	'**/TEAM.md',
] as const;

/** Shared discovery + watcher patterns (skill globs derived from SKILL_DIRS). */
export const GUIDANCE_WATCH_PATTERNS: readonly string[] = [
	...GUIDANCE_WATCH_BASE,
	...SKILL_DIRS.map(({ dir }) => `**/${dir}/**/SKILL.md`),
];

const SKIP_DIR_NAMES = new Set(['.git', 'node_modules', '.build', 'out', 'dist', 'coverage']);
const MAX_WALK_DIRS = 400;
const MAX_WALK_DEPTH = 8;
const MAX_IMPORT_DEPTH = 4;
const MAX_IMPORT_BYTES = 48_000;
const MAX_FRONTMATTER_CHARS = 8_000;
const MAX_FRONTMATTER_MAP_DEPTH = 2;
const FRONTMATTER_KEY = /^[A-Za-z0-9_-]+$/;

export type FrontmatterValue = string | boolean | string[] | { [key: string]: FrontmatterValue };

export function normalizeRel(path: string): string {
	return path.replace(/\\/g, '/');
}

function parseScalarFrontmatter(raw: string): FrontmatterValue {
	if (raw === 'true') {
		return true;
	}
	if (raw === 'false') {
		return false;
	}
	if (raw.startsWith('[') && raw.endsWith(']')) {
		return raw.slice(1, -1).split(',').map(item => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
	}
	return raw.replace(/^['"]|['"]$/g, '');
}

function isUnsafeYamlToken(line: string): boolean {
	return /(?:^|\s)[!&*]/.test(line) || line.includes('!!') || /:\s*[!&*]/.test(line);
}

export function parseFrontmatter(text: string): { meta: Record<string, FrontmatterValue>; body: string } {
	if (!text.startsWith('---')) {
		return { meta: {}, body: text };
	}
	const end = text.indexOf('\n---', 3);
	if (end < 0) {
		return { meta: {}, body: text };
	}
	const header = text.slice(3, end).replace(/^\n/, '');
	if (header.length > MAX_FRONTMATTER_CHARS) {
		return { meta: {}, body: text.slice(end + 4).replace(/^\n/, '') };
	}
	const body = text.slice(end + 4).replace(/^\n/, '');
	const meta: Record<string, FrontmatterValue> = {};
	const stack: Array<{ indent: number; map: Record<string, FrontmatterValue> }> = [{ indent: -1, map: meta }];
	let pendingMapKey: { owner: Record<string, FrontmatterValue>; key: string; indent: number } | undefined;
	let currentListKey: string | undefined;
	let currentListOwner: Record<string, FrontmatterValue> | undefined;

	for (const rawLine of header.split('\n')) {
		if (!rawLine.trim() || rawLine.trimStart().startsWith('#')) {
			continue;
		}
		if (isUnsafeYamlToken(rawLine)) {
			return { meta: {}, body };
		}
		const indent = rawLine.match(/^ */)?.[0].length ?? 0;
		const line = rawLine.trim();
		while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
			stack.pop();
			currentListKey = undefined;
			currentListOwner = undefined;
			pendingMapKey = undefined;
		}
		const owner = stack[stack.length - 1].map;

		if (pendingMapKey && indent > pendingMapKey.indent) {
			const listItem = /^-\s+(.+)$/.exec(line);
			if (listItem) {
				pendingMapKey.owner[pendingMapKey.key] = [listItem[1].replace(/^['"]|['"]$/g, '')];
				currentListKey = pendingMapKey.key;
				currentListOwner = pendingMapKey.owner;
				pendingMapKey = undefined;
				continue;
			}
			const childMatch = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
			if (childMatch && FRONTMATTER_KEY.test(childMatch[1]) && stack.length - 1 < MAX_FRONTMATTER_MAP_DEPTH) {
				const child: Record<string, FrontmatterValue> = {};
				pendingMapKey.owner[pendingMapKey.key] = child;
				stack.push({ indent: pendingMapKey.indent, map: child });
				pendingMapKey = undefined;
				const [, childKey, childRaw] = childMatch;
				if (childRaw === '' || childRaw === '[]') {
					if (childRaw === '[]') {
						child[childKey] = [];
						currentListKey = childKey;
						currentListOwner = child;
					} else {
						pendingMapKey = { owner: child, key: childKey, indent };
					}
				} else {
					child[childKey] = parseScalarFrontmatter(childRaw);
				}
				continue;
			}
			pendingMapKey = undefined;
		} else if (pendingMapKey) {
			pendingMapKey.owner[pendingMapKey.key] = [];
			pendingMapKey = undefined;
		}

		const listItem = /^-\s+(.+)$/.exec(line);
		if (listItem && currentListKey && currentListOwner) {
			const existing = currentListOwner[currentListKey];
			const value = listItem[1].replace(/^['"]|['"]$/g, '');
			currentListOwner[currentListKey] = Array.isArray(existing) ? [...existing, value] : [value];
			continue;
		}
		currentListKey = undefined;
		currentListOwner = undefined;
		const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
		if (!match || !FRONTMATTER_KEY.test(match[1])) {
			continue;
		}
		const [, key, raw] = match;
		if (raw === '[]') {
			owner[key] = [];
			currentListKey = key;
			currentListOwner = owner;
			continue;
		}
		if (raw === '') {
			pendingMapKey = { owner, key, indent };
			continue;
		}
		owner[key] = parseScalarFrontmatter(raw);
	}
	if (pendingMapKey) {
		pendingMapKey.owner[pendingMapKey.key] = [];
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

export function metaString(meta: Record<string, FrontmatterValue>, key: string): string | undefined {
	const value = meta[key];
	if (typeof value === 'string' && value.trim()) {
		return value.trim();
	}
	if (Array.isArray(value)) {
		const joined = value.map(item => String(item).trim()).filter(Boolean).join(', ');
		return joined || undefined;
	}
	return undefined;
}

export function metaBoolean(meta: Record<string, FrontmatterValue>, key: string): boolean | undefined {
	const value = meta[key];
	return typeof value === 'boolean' ? value : undefined;
}

export function metaMap(meta: Record<string, FrontmatterValue>, key: string): Record<string, FrontmatterValue> | undefined {
	const value = meta[key];
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		return value;
	}
	return undefined;
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

/** Prefer explicit frontmatter keys, then fall back to parseApplyTo. */
export function globsFromMeta(
	meta: Record<string, FrontmatterValue>,
	text: string,
	preferredKeys: readonly string[] = ['globs'],
): string[] {
	for (const key of preferredKeys) {
		const list = metaStringList(meta, key);
		if (list.length) {
			return list;
		}
	}
	return parseApplyTo(text);
}

export function firstNonHeadingLine(body: string): string {
	return body.split('\n').find(line => line.trim() && !line.startsWith('#'))?.trim() ?? '';
}

/** Package/subdir scope for a nested skill root (e.g. packages/web/.agents/skills → packages/web). */
export function skillScopePrefix(discoveredDir: string, skillRootDir: string): string {
	if (discoveredDir === skillRootDir) {
		return '';
	}
	const suffix = `/${skillRootDir}`;
	if (discoveredDir.endsWith(suffix)) {
		return discoveredDir.slice(0, -suffix.length);
	}
	return discoveredDir.replace(/\/skills$/, '');
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

/** Strip fenced/inline code so @ imports inside examples are not parsed. Preserves string length for index alignment. */
export function stripCodeRegionsForImports(text: string): string {
	const chars = [...text];
	let i = 0;
	while (i < chars.length) {
		if (text.startsWith('```', i)) {
			const fenceEnd = text.indexOf('```', i + 3);
			if (fenceEnd < 0) {
				break;
			}
			for (let j = i; j < fenceEnd + 3; j++) {
				chars[j] = ' ';
			}
			i = fenceEnd + 3;
			continue;
		}
		if (chars[i] === '`') {
			const end = text.indexOf('`', i + 1);
			if (end < 0) {
				break;
			}
			for (let j = i; j <= end; j++) {
				chars[j] = ' ';
			}
			i = end + 1;
			continue;
		}
		i++;
	}
	return chars.join('');
}

export async function resolveMarkdownImports(
	reader: GuidanceFileReader,
	_workspaceRoot: string,
	sourceFileRelPath: string,
	body: string,
	isBlocked: (rel: string) => boolean,
	resolveGuidancePath: (rel: string) => string | undefined,
): Promise<{ text: string; diagnostics: string[] }> {
	const diagnostics: string[] = [];
	const seen = new Set<string>();
	const sourceDir = dirname(normalizeRel(sourceFileRelPath));

	async function expand(text: string, depth: number, stack: string[], originDir: string): Promise<string> {
		if (depth > MAX_IMPORT_DEPTH) {
			diagnostics.push('Import depth limit reached.');
			return text;
		}
		const searchable = stripCodeRegionsForImports(text);
		const importPattern = /@\.?\/?([^\s`]+)/g;
		let result = '';
		let lastIndex = 0;
		for (const match of searchable.matchAll(importPattern)) {
			const index = match.index ?? 0;
			result += text.slice(lastIndex, index);
			lastIndex = index + match[0].length;
			const atImport = match[0];
			const rawRef = normalizeRel(match[1]);
			const looksAbsoluteAt = /^@\/(?!\.)/.test(atImport) || /^@[a-zA-Z]:/.test(atImport) || rawRef.startsWith('/') || /^[a-zA-Z]:/.test(rawRef);
			const rel = !looksAbsoluteAt && (atImport.startsWith('@./') || atImport.startsWith('@../') || rawRef.startsWith('./') || rawRef.startsWith('../'))
				? normalizeRel(join(originDir, rawRef.replace(/^\.\//, '')))
				: rawRef;
			if (looksAbsoluteAt) {
				diagnostics.push(`Blocked outside-workspace or absolute @ import: ${atImport} (workspace-bound paths only)`);
				continue;
			}
			if (isBlocked(rel) || stack.includes(rel)) {
				diagnostics.push(`Skipped import ${rel}`);
				continue;
			}
			const full = resolveGuidancePath(rel);
			if (!full) {
				const escape = rel.split('/').includes('..') || rawRef.split('/').includes('..');
				diagnostics.push(escape
					? `Blocked outside-workspace or absolute @ import: ${atImport} (workspace-bound paths only)`
					: `Missing or cyclic import: ${rel}`);
				continue;
			}
			if (seen.has(full)) {
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
			const importedDir = dirname(rel);
			result += await expand(importedBody, depth + 1, [...stack, rel], importedDir);
		}
		result += text.slice(lastIndex);
		return result;
	}

	return { text: await expand(body, 0, [], sourceDir || '.'), diagnostics };
}

/** Deterministic glob matcher for documented ecosystem patterns. */
export function globMatches(pattern: string, targetPath: string): boolean {
	const normalized = normalizeRel(targetPath);
	const glob = normalizeRel(pattern);
	if (glob === '**' || glob === '**/*') {
		return true;
	}
	if (glob.endsWith('/**')) {
		const prefix = glob.slice(0, -3);
		return normalized === prefix || normalized.startsWith(`${prefix}/`);
	}
	const alternatives = /^\{([^}]+)\}$/.exec(glob);
	if (alternatives) {
		return alternatives[1].split(',').some(alt => globMatches(alt.trim(), normalized));
	}
	try {
		return globToRegExp(glob).test(normalized);
	} catch {
		return false;
	}
}

function globToRegExp(glob: string): RegExp {
	return new RegExp(`^${globPatternToRegexSource(glob)}$`);
}

function globPatternToRegexSource(glob: string): string {
	let i = 0;
	let re = '';
	while (i < glob.length) {
		const ch = glob[i];
		if (ch === '*') {
			if (glob[i + 1] === '*') {
				re += glob[i + 2] === '/' ? '(?:.*/)?' : '.*';
				i += glob[i + 2] === '/' ? 3 : 2;
			} else {
				re += '[^/]*';
				i++;
			}
			continue;
		}
		if (ch === '?') {
			re += '[^/]';
			i++;
			continue;
		}
		if (ch === '[') {
			const end = glob.indexOf(']', i);
			if (end > i) {
				re += glob.slice(i, end + 1);
				i = end + 1;
				continue;
			}
		}
		if (ch === '{') {
			const end = glob.indexOf('}', i);
			if (end > i) {
				const inner = glob.slice(i + 1, end).split(',').map(alt => globPatternToRegexSource(alt.trim()));
				re += `(?:${inner.join('|')})`;
				i = end + 1;
				continue;
			}
		}
		re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
		i++;
	}
	return re;
}

export function matchesAnyGlob(globs: readonly string[], targetPath: string | undefined): boolean {
	if (!globs.length) {
		return true;
	}
	if (!targetPath) {
		return false;
	}
	return globs.some(glob => globMatches(glob, targetPath));
}

export function windsurfRuleMode(meta: Record<string, FrontmatterValue>, globs: string[]): 'always' | 'path' | 'intelligent' | 'manual' {
	const trigger = typeof meta.trigger === 'string' ? meta.trigger.trim() : '';
	switch (trigger) {
		case 'always_on':
			return 'always';
		case 'model_decision':
			return 'intelligent';
		case 'glob':
			return 'path';
		case 'manual':
			return 'manual';
		default:
			return globs.length ? 'path' : 'always';
	}
}

/** Kiro steering inclusion → PreBase activation modes. */
export function kiroSteeringMode(meta: Record<string, FrontmatterValue>, globs: string[]): 'always' | 'path' | 'intelligent' | 'manual' {
	const inclusion = typeof meta.inclusion === 'string' ? meta.inclusion.trim() : '';
	switch (inclusion) {
		case 'always':
			return 'always';
		case 'fileMatch':
			return 'path';
		case 'manual':
			return 'manual';
		case 'auto':
			return 'intelligent';
		default:
			return globs.length ? 'path' : 'always';
	}
}

/** Expand Kiro `#[[file:rel]]` references (workspace-bound only). */
export async function expandKiroFileRefs(
	reader: GuidanceFileReader,
	_workspaceRoot: string,
	sourceRel: string,
	body: string,
	isBlocked: (rel: string) => boolean,
	resolveGuidancePath: (rel: string) => string | undefined,
): Promise<{ text: string; diagnostics: string[] }> {
	const diagnostics: string[] = [];
	const sourceDir = dirname(normalizeRel(sourceRel));
	const pattern = /#\[\[file:([^\]]+)\]\]/g;
	let result = '';
	let lastIndex = 0;
	for (const match of body.matchAll(pattern)) {
		const index = match.index ?? 0;
		result += body.slice(lastIndex, index);
		lastIndex = index + match[0].length;
		const rawRef = normalizeRel(match[1].trim());
		const rel = rawRef.startsWith('./') || rawRef.startsWith('../')
			? normalizeRel(join(sourceDir, rawRef.replace(/^\.\//, '')))
			: rawRef;
		if (isBlocked(rel)) {
			diagnostics.push(`Skipped blocked Kiro file ref: ${rel}`);
			continue;
		}
		const full = resolveGuidancePath(rel);
		if (!full) {
			diagnostics.push(`Blocked outside-workspace Kiro file ref: ${match[0]}`);
			continue;
		}
		try {
			const imported = await reader.readFile(full);
			result += imported.length > MAX_IMPORT_BYTES
				? `${imported.slice(0, MAX_IMPORT_BYTES)}\n[import truncated]`
				: imported;
		} catch {
			diagnostics.push(`Unreadable Kiro file ref: ${rel}`);
		}
	}
	result += body.slice(lastIndex);
	return { text: result, diagnostics };
}

export async function discoverNestedDirectories(
	reader: GuidanceFileReader,
	workspaceRoot: string,
	dirSuffix: string,
): Promise<string[]> {
	const found = new Set<string>();
	if (await reader.exists(join(workspaceRoot, dirSuffix))) {
		found.add(dirSuffix);
	}
	const marker = `/${dirSuffix}`;
	const allFiles = await walkBoundedFiles(reader, workspaceRoot, () => true, { maxDepth: MAX_WALK_DEPTH });
	for (const rel of allFiles) {
		const idx = rel.indexOf(marker);
		if (idx >= 0) {
			found.add(normalizeRel(rel.slice(0, idx + marker.length)));
		}
	}
	return [...found].sort();
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
): Promise<Array<{ relPath: string; ecosystem: string; scopePrefix: string }>> {
	const found: Array<{ relPath: string; ecosystem: string; scopePrefix: string }> = [];
	const seen = new Set<string>();
	for (const root of skillRoots) {
		const nestedDirs = await discoverNestedDirectories(reader, workspaceRoot, root.dir);
		for (const dir of nestedDirs) {
			const absRoot = join(workspaceRoot, dir);
			if (!(await reader.exists(absRoot))) {
				continue;
			}
			const skillFiles = await walkBoundedFiles(reader, absRoot, rel => rel.endsWith('/SKILL.md') || rel === 'SKILL.md', { maxDepth: 6 });
			for (const relUnderRoot of skillFiles) {
				const relPath = normalizeRel(join(dir, relUnderRoot.replace(/^\/?/, '')));
				if (isBlocked(relPath) || seen.has(relPath)) {
					continue;
				}
				seen.add(relPath);
				found.push({ relPath, ecosystem: root.ecosystem, scopePrefix: skillScopePrefix(dir, root.dir) });
			}
		}
	}
	return found;
}

export async function listSkillResourceManifest(
	reader: GuidanceFileReader,
	workspaceRoot: string,
	skillRootRel: string,
	maxEntries = 48,
): Promise<string[]> {
	const abs = join(workspaceRoot, skillRootRel);
	const results: string[] = [];
	async function walk(relDir: string, depth: number): Promise<void> {
		if (depth > 4 || results.length >= maxEntries) {
			return;
		}
		let entries: string[];
		try {
			entries = await reader.readDirectory(join(abs, relDir));
		} catch {
			return;
		}
		for (const entry of entries) {
			if (entry === 'SKILL.md') {
				continue;
			}
			const rel = relDir ? normalizeRel(join(relDir, entry)) : entry;
			results.push(normalizeRel(join(skillRootRel, rel)));
			if (results.length >= maxEntries) {
				return;
			}
			try {
				await reader.readDirectory(join(abs, rel));
				await walk(rel, depth + 1);
			} catch {
				// file leaf
			}
		}
	}
	await walk('', 0);
	return results.sort();
}
