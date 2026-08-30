/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { isSensitiveFile } from './requestAssembler';

export interface GuidanceSource {
	readonly path: string;
	readonly ecosystem: string;
	readonly scope: string;
	readonly alwaysApply: boolean;
	readonly globs: readonly string[];
	readonly contentHash: string;
}

export interface SkillMetadata {
	readonly name: string;
	readonly description: string;
	readonly path: string;
	readonly ecosystem: string;
}

export interface GuidanceConflict {
	readonly message: string;
	readonly sources: readonly string[];
}

export interface ProjectGuidanceSnapshot {
	readonly enabled: boolean;
	readonly workspaceRoot: string;
	readonly alwaysApplicable: readonly { source: GuidanceSource; text: string }[];
	readonly pathApplicable: readonly { source: GuidanceSource; text: string }[];
	readonly skillCatalog: readonly SkillMetadata[];
	readonly activatedSkills: readonly { metadata: SkillMetadata; body: string }[];
	readonly conflicts: readonly GuidanceConflict[];
	readonly diagnostics: readonly string[];
	readonly totalChars: number;
}

export interface ProjectGuidanceBudget {
	readonly maxAlwaysChars: number;
	readonly maxPathChars: number;
	readonly maxSkillCatalogEntries: number;
	readonly maxActivatedSkillChars: number;
}

export const DEFAULT_GUIDANCE_BUDGET: ProjectGuidanceBudget = {
	maxAlwaysChars: 6_000,
	maxPathChars: 4_000,
	maxSkillCatalogEntries: 24,
	maxActivatedSkillChars: 8_000,
};

/** Hard ceiling for injected project-guidance system prompt text. */
export const MAX_PROMPT_GUIDANCE_CHARS = 16_000;

const SECRET_INLINE_PATTERN = /(?:api[_-]?key|secret(?:[_-]?key)?|access[_-]?token|auth(?:[_-]?token)?|password|passwd|private[_-]?key)\s*[:=]\s*\S+/gi;
const PEM_BLOCK_PATTERN = /-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi;
const AWS_KEY_PATTERN = /\b(AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16})\b/g;

const KNOWN_ROOT_FILES = ['AGENTS.md', 'AGENTS.override.md', 'CLAUDE.md', 'GEMINI.md', '.cursorrules'];
const KNOWN_RULE_DIRS = [
	{ dir: '.cursor/rules', ext: '.mdc', ecosystem: 'cursor' },
	{ dir: '.claude/rules', ext: '.md', ecosystem: 'claude' },
	{ dir: '.github/instructions', ext: '.instructions.md', ecosystem: 'github' },
	{ dir: '.clinerules', ext: '.md', ecosystem: 'cline' },
	{ dir: '.windsurf/rules', ext: '.md', ecosystem: 'windsurf' },
];
const SKILL_DIRS = [
	{ dir: '.agents/skills', ecosystem: 'agents' },
	{ dir: '.cursor/skills', ecosystem: 'cursor' },
	{ dir: '.claude/skills', ecosystem: 'claude' },
	{ dir: '.github/skills', ecosystem: 'github' },
	{ dir: '.cline/skills', ecosystem: 'cline' },
	{ dir: '.windsurf/skills', ecosystem: 'windsurf' },
];

export interface GuidanceFileReader {
	exists(path: string): boolean | Promise<boolean>;
	readFile(path: string): string | Promise<string>;
	readDirectory(path: string): string[] | Promise<string[]>;
	isTrusted?(): boolean;
}

function normalizeRel(path: string): string {
	return path.replace(/\\/g, '/');
}

function isBlockedGuidancePath(relPath: string): boolean {
	const normalized = normalizeRel(relPath);
	return isSensitiveFile(normalized);
}

export function resolveGuidancePath(workspaceRoot: string, relPath: string): string | undefined {
	const normalized = normalizeRel(relPath);
	if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
		return undefined;
	}
	if (normalized.split('/').some(part => part === '..')) {
		return undefined;
	}
	const root = resolve(workspaceRoot);
	const full = resolve(root, normalized);
	if (full !== root && !full.startsWith(`${root}${sep}`)) {
		return undefined;
	}
	return full;
}

export function scrubSecretsFromGuidance(text: string): string {
	return text
		.replace(PEM_BLOCK_PATTERN, '[redacted private key material]')
		.replace(BEARER_TOKEN_PATTERN, 'Bearer [redacted]')
		.replace(AWS_KEY_PATTERN, '[redacted aws key]')
		.replace(SECRET_INLINE_PATTERN, match => `${match.split(/[:=]/)[0]}: [redacted]`);
}

function hashContent(text: string): string {
	return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function parseFrontmatter(text: string): { meta: Record<string, string | boolean>; body: string } {
	if (!text.startsWith('---')) {
		return { meta: {}, body: text };
	}
	const end = text.indexOf('\n---', 3);
	if (end < 0) {
		return { meta: {}, body: text };
	}
	const header = text.slice(3, end).trim();
	const body = text.slice(end + 4).replace(/^\n/, '');
	const meta: Record<string, string | boolean> = {};
	for (const line of header.split('\n')) {
		const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim());
		if (!match) {
			continue;
		}
		const [, key, raw] = match;
		if (raw === 'true') {
			meta[key] = true;
		} else if (raw === 'false') {
			meta[key] = false;
		} else {
			meta[key] = raw.replace(/^['"]|['"]$/g, '');
		}
	}
	return { meta, body };
}

function parseApplyTo(text: string): string[] {
	const { meta, body } = parseFrontmatter(text);
	if (typeof meta.applyTo === 'string' && meta.applyTo.trim()) {
		return meta.applyTo.split(',').map(item => item.trim()).filter(Boolean);
	}
	if (typeof meta.globs === 'string' && meta.globs.trim()) {
		return meta.globs.split(',').map(item => item.trim()).filter(Boolean);
	}
	const match = body.match(/applyTo:\s*([^\n]+)/);
	return match ? match[1].split(',').map(item => item.trim()).filter(Boolean) : [];
}

function globMatches(pattern: string, targetPath: string): boolean {
	const normalized = normalizeRel(targetPath);
	const glob = normalizeRel(pattern);
	if (glob === '**' || glob === '**/*') {
		return true;
	}
	if (glob.endsWith('/**')) {
		return normalized.startsWith(glob.slice(0, -3));
	}
	if (glob.includes('*')) {
		const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*');
		return new RegExp(`^${escaped}$`).test(normalized);
	}
	return normalized === glob || normalized.endsWith(`/${glob}`) || normalized.startsWith(`${glob}/`);
}

function matchesAnyGlob(globs: readonly string[], targetPath: string | undefined): boolean {
	if (!globs.length) {
		return true;
	}
	if (!targetPath) {
		return false;
	}
	return globs.some(glob => globMatches(glob, targetPath));
}

function boundedJoin(blocks: readonly string[], maxChars: number): string {
	let total = 0;
	const kept: string[] = [];
	for (const block of blocks) {
		if (total + block.length > maxChars) {
			break;
		}
		kept.push(block);
		total += block.length;
	}
	return kept.join('\n\n');
}

function parseSkillMetadata(skillPath: string, text: string, ecosystem: string): SkillMetadata | undefined {
	const { meta, body } = parseFrontmatter(text);
	const name = typeof meta.name === 'string' ? meta.name : basename(dirname(skillPath));
	const description = typeof meta.description === 'string'
		? meta.description
		: body.split('\n').find(line => line.trim() && !line.startsWith('#'))?.trim() ?? '';
	if (!description) {
		return undefined;
	}
	return { name, description, path: skillPath, ecosystem };
}

function detectConflicts(sources: readonly { source: GuidanceSource; text: string }[]): GuidanceConflict[] {
	const conflicts: GuidanceConflict[] = [];
	const tabs = sources.filter(item => /\buse tabs\b/i.test(item.text));
	const spaces = sources.filter(item => /\buse spaces\b/i.test(item.text));
	if (tabs.length && spaces.length) {
		const overlap = tabs.some(t => spaces.some(s => t.source.scope === s.source.scope));
		if (overlap) {
			conflicts.push({
				message: 'Conflicting indentation guidance detected for the same scope.',
				sources: [...tabs, ...spaces].map(item => item.source.path),
			});
		}
	}
	return conflicts;
}

function dedupeByHash(items: readonly { source: GuidanceSource; text: string }[]): { items: { source: GuidanceSource; text: string }[]; diagnostics: string[] } {
	const seen = new Map<string, { source: GuidanceSource; text: string }>();
	const diagnostics: string[] = [];
	for (const item of items) {
		const key = hashContent(item.text.trim());
		if (seen.has(key)) {
			diagnostics.push(`Equivalent guidance in ${item.source.path} also appears in ${seen.get(key)!.source.path}`);
			continue;
		}
		seen.set(key, item);
	}
	return { items: [...seen.values()], diagnostics };
}

export class ProjectGuidanceService {
	private cache = new Map<string, ProjectGuidanceSnapshot>();
	private readonly reader: GuidanceFileReader;
	private readonly budget: ProjectGuidanceBudget;

	constructor(reader: GuidanceFileReader, budget: ProjectGuidanceBudget = DEFAULT_GUIDANCE_BUDGET) {
		this.reader = reader;
		this.budget = budget;
	}

	invalidate(workspaceRoot?: string): void {
		if (workspaceRoot) {
			this.cache.delete(workspaceRoot);
			return;
		}
		this.cache.clear();
	}

	async getSnapshot(workspaceRoot: string, targetPaths: readonly string[] = [], activatedSkillNames: readonly string[] = [], enabled = true): Promise<ProjectGuidanceSnapshot> {
		const cacheKey = `${workspaceRoot}:${targetPaths.join('|')}:${activatedSkillNames.join('|')}:${enabled}`;
		const cached = this.cache.get(cacheKey);
		if (cached) {
			return cached;
		}
		if (!enabled || this.reader.isTrusted?.() === false) {
			const empty: ProjectGuidanceSnapshot = {
				enabled,
				workspaceRoot,
				alwaysApplicable: [],
				pathApplicable: [],
				skillCatalog: [],
				activatedSkills: [],
				conflicts: [],
				diagnostics: this.reader.isTrusted?.() === false ? ['Workspace is not trusted; project guidance is disabled.'] : [],
				totalChars: 0,
			};
			this.cache.set(cacheKey, empty);
			return empty;
		}

		const sources: { source: GuidanceSource; text: string }[] = [];
		const diagnostics: string[] = [];

		for (const file of KNOWN_ROOT_FILES) {
			if (isBlockedGuidancePath(file)) {
				continue;
			}
			const full = join(workspaceRoot, file);
			if (!(await this.reader.exists(full))) {
				continue;
			}
			const text = scrubSecretsFromGuidance(await this.reader.readFile(full));
			sources.push({
				source: {
					path: file,
					ecosystem: file.startsWith('CLAUDE') ? 'claude' : file.startsWith('GEMINI') ? 'gemini' : 'agents',
					scope: 'repository',
					alwaysApply: true,
					globs: [],
					contentHash: hashContent(text),
				},
				text: text.trim(),
			});
		}

		const copilotRel = '.github/copilot-instructions.md';
		const copilot = join(workspaceRoot, copilotRel);
		if (!isBlockedGuidancePath(copilotRel) && await this.reader.exists(copilot)) {
			const text = scrubSecretsFromGuidance(await this.reader.readFile(copilot));
			sources.push({
				source: { path: '.github/copilot-instructions.md', ecosystem: 'github', scope: 'repository', alwaysApply: true, globs: [], contentHash: hashContent(text) },
				text: text.trim(),
			});
		}

		for (const ruleDir of KNOWN_RULE_DIRS) {
			const fullDir = join(workspaceRoot, ruleDir.dir);
			if (!(await this.reader.exists(fullDir))) {
				continue;
			}
			const entries = await this.reader.readDirectory(fullDir);
			for (const entry of entries) {
				if (!entry.endsWith(ruleDir.ext)) {
					continue;
				}
				const rel = normalizeRel(join(ruleDir.dir, entry));
				if (isBlockedGuidancePath(rel)) {
					continue;
				}
				const text = scrubSecretsFromGuidance(await this.reader.readFile(join(workspaceRoot, rel)));
				const { meta, body } = parseFrontmatter(text);
				const alwaysApply = meta.alwaysApply === true;
				const globs = typeof meta.globs === 'string'
					? meta.globs.split(',').map(item => item.trim()).filter(Boolean)
					: parseApplyTo(text);
				sources.push({
					source: {
						path: rel,
						ecosystem: ruleDir.ecosystem,
						scope: globs.length ? globs.join(', ') : (alwaysApply ? 'repository' : 'manual'),
						alwaysApply,
						globs,
						contentHash: hashContent(body),
					},
					text: body.trim(),
				});
			}
		}

		const deduped = dedupeByHash(sources);
		diagnostics.push(...deduped.diagnostics);

		const alwaysApplicable = deduped.items.filter(item => item.source.alwaysApply || (!item.source.globs.length && item.source.scope === 'repository'));
		const pathApplicable = deduped.items.filter(item => !item.source.alwaysApply && item.source.globs.length && targetPaths.some(path => matchesAnyGlob(item.source.globs, path)));

		const skillCatalog: SkillMetadata[] = [];
		for (const skillDir of SKILL_DIRS) {
			const fullDir = join(workspaceRoot, skillDir.dir);
			if (!(await this.reader.exists(fullDir))) {
				continue;
			}
			const entries = await this.reader.readDirectory(fullDir);
			for (const entry of entries) {
				const skillPath = normalizeRel(join(skillDir.dir, entry, 'SKILL.md'));
				if (isBlockedGuidancePath(skillPath)) {
					continue;
				}
				const full = join(workspaceRoot, skillPath);
				if (!(await this.reader.exists(full))) {
					continue;
				}
				const text = scrubSecretsFromGuidance(await this.reader.readFile(full));
				const metadata = parseSkillMetadata(skillPath, text, skillDir.ecosystem);
				if (metadata) {
					skillCatalog.push(metadata);
				}
			}
		}

		const activatedSkills: { metadata: SkillMetadata; body: string }[] = [];
		for (const name of activatedSkillNames) {
			const metadata = skillCatalog.find(item => item.name === name);
			if (!metadata) {
				continue;
			}
			const text = scrubSecretsFromGuidance(await this.reader.readFile(join(workspaceRoot, metadata.path)));
			const { body } = parseFrontmatter(text);
			activatedSkills.push({ metadata, body: body.trim().slice(0, this.budget.maxActivatedSkillChars) });
		}

		const conflicts = detectConflicts([...alwaysApplicable, ...pathApplicable]);
		const totalChars =
			boundedJoin(alwaysApplicable.map(item => item.text), this.budget.maxAlwaysChars).length +
			boundedJoin(pathApplicable.map(item => item.text), this.budget.maxPathChars).length +
			skillCatalog.reduce((sum, item) => sum + item.description.length, 0);
		const snapshot: ProjectGuidanceSnapshot = {
			enabled: true,
			workspaceRoot,
			alwaysApplicable: alwaysApplicable.slice(0, 32),
			pathApplicable,
			skillCatalog: skillCatalog.slice(0, this.budget.maxSkillCatalogEntries),
			activatedSkills,
			conflicts,
			diagnostics,
			totalChars,
		};
		this.cache.set(cacheKey, snapshot);
		return snapshot;
	}
}

export function formatProjectGuidanceForPrompt(snapshot: ProjectGuidanceSnapshot, budget: ProjectGuidanceBudget = DEFAULT_GUIDANCE_BUDGET): string {
	if (!snapshot.enabled) {
		return '';
	}
	const parts: string[] = ['PROJECT GUIDANCE (trusted repository instructions; below PreBase system rules and the current user request)'];
	const alwaysBlocks = snapshot.alwaysApplicable.map(item =>
		`Source: ${item.source.path}\nScope: ${item.source.scope}\n${scrubSecretsFromGuidance(item.text)}`);
	const alwaysJoined = boundedJoin(alwaysBlocks, budget.maxAlwaysChars);
	if (alwaysJoined) {
		parts.push(alwaysJoined);
	}
	const pathBlocks = snapshot.pathApplicable.map(item =>
		`Source: ${item.source.path}\nScope: ${item.source.scope}\n${scrubSecretsFromGuidance(item.text)}`);
	const pathJoined = boundedJoin(pathBlocks, budget.maxPathChars);
	if (pathJoined) {
		parts.push(pathJoined);
	}
	if (snapshot.skillCatalog.length) {
		const catalogLines = ['AVAILABLE PROJECT SKILLS (metadata only; request activation before using body/resources)'];
		let catalogChars = catalogLines[0].length;
		for (const skill of snapshot.skillCatalog) {
			const line = `- ${skill.name}: ${scrubSecretsFromGuidance(skill.description)} (${skill.path})`;
			if (catalogChars + line.length + 1 > budget.maxPathChars) {
				break;
			}
			catalogLines.push(line);
			catalogChars += line.length + 1;
		}
		parts.push(catalogLines.join('\n'));
	}
	let activatedChars = 0;
	for (const skill of snapshot.activatedSkills) {
		const block = `ACTIVATED SKILL: ${skill.metadata.name}\n${scrubSecretsFromGuidance(skill.body)}`;
		if (activatedChars + block.length > budget.maxActivatedSkillChars) {
			break;
		}
		parts.push(block);
		activatedChars += block.length;
	}
	for (const conflict of snapshot.conflicts) {
		parts.push(`GUIDANCE CONFLICT: ${conflict.message} Sources: ${conflict.sources.join(', ')}`);
	}
	if (parts.length <= 1) {
		return '';
	}
	let result = parts.join('\n\n').trim();
	if (result.length > MAX_PROMPT_GUIDANCE_CHARS) {
		result = `${result.slice(0, MAX_PROMPT_GUIDANCE_CHARS)}\n\n[project guidance truncated]`;
	}
	return result;
}

export function guidanceTargetsFromReferences(references: readonly { value: unknown }[] | undefined, asRelativePath?: (value: unknown) => string | undefined): string[] {
	const paths = new Set<string>();
	for (const ref of references ?? []) {
		const value = ref.value;
		if (typeof value === 'string') {
			const normalized = normalizeRel(value);
			if (normalized.includes('/') && !normalized.startsWith('/') && !/^[a-zA-Z]:/.test(normalized)) {
				paths.add(normalized);
			}
		} else if (value && typeof value === 'object') {
			const rel = asRelativePath?.(value);
			if (rel) {
				const normalized = normalizeRel(rel);
				if (!normalized.startsWith('/') && !/^[a-zA-Z]:/.test(normalized)) {
					paths.add(normalized);
				}
			}
		}
	}
	return [...paths];
}
