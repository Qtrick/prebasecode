/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { isSensitiveFile } from './requestAssembler';
import {
	agentsAncestorDirs,
	boundedJoin,
	cursorRuleMode,
	discoverNestedDirectories,
	discoverSkillFiles,
	expandKiroFileRefs,
	firstNonHeadingLine,
	globsFromMeta,
	GUIDANCE_WATCH_PATTERNS,
	kiroSteeringMode,
	listSkillResourceManifest,
	matchesAnyGlob,
	metaBoolean,
	metaMap,
	metaString,
	metaStringList,
	normalizeRel,
	parseFrontmatter,
	resolveMarkdownImports,
	SKILL_DIRS,
	walkBoundedFiles,
	windsurfRuleMode,
	type FrontmatterValue,
} from './projectGuidanceDiscovery';
import type { GuidanceTarget } from './projectGuidanceSession';

export { GUIDANCE_WATCH_PATTERNS };

export type GuidanceActivationMode = 'always' | 'path' | 'intelligent' | 'manual';

export interface GuidanceSource {
	readonly path: string;
	readonly ecosystem: string;
	readonly scope: string;
	readonly alwaysApply: boolean;
	readonly activationMode: GuidanceActivationMode;
	readonly description?: string;
	readonly globs: readonly string[];
	readonly contentHash: string;
}

export interface SkillMetadata {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly path: string;
	readonly ecosystem: string;
	readonly scopePrefix: string;
	readonly argumentHint?: string;
	readonly userInvocable?: boolean;
	readonly modelInvocable?: boolean;
	readonly contextMode?: string;
	readonly allowedToolsHint?: string;
	readonly triggers?: readonly string[];
	readonly license?: string;
	readonly compatibility?: string;
}

export interface PlaybookMetadata {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly path: string;
	readonly ecosystem: string;
}

export interface AgentProfileMetadata {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly path: string;
	readonly ecosystem: string;
}

export interface GuidanceConflict {
	readonly message: string;
	readonly sources: readonly string[];
}

export interface GuidanceTextBlock {
	readonly source: GuidanceSource;
	readonly text: string;
	readonly workspaceRoot: string;
}

export interface ProjectGuidanceSnapshot {
	readonly enabled: boolean;
	readonly workspaceRoot: string;
	readonly alwaysApplicable: readonly GuidanceTextBlock[];
	readonly pathApplicable: readonly GuidanceTextBlock[];
	readonly activatedRules: readonly GuidanceTextBlock[];
	readonly onDemandRules: readonly { source: GuidanceSource; description: string }[];
	readonly skillCatalog: readonly SkillMetadata[];
	readonly playbookCatalog: readonly PlaybookMetadata[];
	readonly agentProfileCatalog: readonly AgentProfileMetadata[];
	readonly activatedSkills: readonly { metadata: SkillMetadata; body: string; root: string; files: readonly string[] }[];
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
	maxSkillCatalogEntries: 48,
	maxActivatedSkillChars: 8_000,
};

/** Hard ceiling for injected project-guidance system prompt text. */
export const MAX_PROMPT_GUIDANCE_CHARS = 16_000;

const SECRET_INLINE_PATTERN = /(?:api[_-]?key|secret(?:[_-]?key)?|access[_-]?token|auth(?:[_-]?token)?|\btoken\b|password|passwd|private[_-]?key)\s*[:=]\s*\S+/gi;
const PEM_BLOCK_PATTERN = /-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi;
const AWS_KEY_PATTERN = /\b(AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16})\b/g;

const ROOT_ALWAYS_FILES = [
	{ file: '.github/copilot-instructions.md', ecosystem: 'github' },
	{ file: '.cursorrules', ecosystem: 'cursor' },
	{ file: '.windsurfrules', ecosystem: 'windsurf' },
];
const CLAUDE_ROOT_FILES = ['CLAUDE.md', 'CLAUDE.local.md', '.claude/CLAUDE.md'];
const GEMINI_ROOT_FILES = ['GEMINI.md'];
const RULE_DIRS = [
	{ dir: '.cursor/rules', ext: '.mdc', ecosystem: 'cursor', nested: true },
	{ dir: '.claude/rules', ext: '.md', ecosystem: 'claude', nested: true },
	{ dir: '.github/instructions', ext: '.instructions.md', ecosystem: 'github', nested: true },
	{ dir: '.cline/rules', ext: '.md', ecosystem: 'cline', nested: true },
	{ dir: '.clinerules', ext: '.md', ecosystem: 'cline', nested: false },
	{ dir: '.clinerules', ext: '.txt', ecosystem: 'cline', nested: false },
	{ dir: '.windsurf/rules', ext: '.md', ecosystem: 'windsurf', nested: true },
	{ dir: '.devin/rules', ext: '.md', ecosystem: 'devin', nested: true },
];
const PLAYBOOK_DIRS = [
	{ dir: '.github/prompts', ext: '.prompt.md', ecosystem: 'github' },
	{ dir: '.windsurf/workflows', ext: '.md', ecosystem: 'windsurf' },
	{ dir: '.cline/workflows', ext: '.md', ecosystem: 'cline' },
	{ dir: '.cursor/commands', ext: '.md', ecosystem: 'cursor' },
	{ dir: '.claude/commands', ext: '.md', ecosystem: 'claude' },
];
const AGENT_PROFILE_DIRS = [
	{ dir: '.cursor/agents', ext: '.md', ecosystem: 'cursor' },
	{ dir: '.claude/agents', ext: '.md', ecosystem: 'claude' },
	{ dir: '.codex/agents', ext: '.md', ecosystem: 'codex' },
];
const OPENCODE_CONFIG_FILES = ['opencode.json', '.opencode/opencode.json'];
const CLAUDE_SETTINGS_FILES = ['.claude/settings.json', '.claude/settings.local.json'];
const GEMINI_SETTINGS_FILE = '.gemini/settings.json';
const KIRO_STEERING_DIR = '.kiro/steering';

export interface GuidanceFileReader {
	exists(path: string): boolean | Promise<boolean>;
	readFile(path: string): string | Promise<string>;
	readDirectory(path: string): string[] | Promise<string[]>;
	isTrusted?(): boolean;
}

function isBlockedGuidancePath(relPath: string): boolean {
	return isSensitiveFile(normalizeRel(relPath));
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

function tagGuidanceBlocks(workspaceRoot: string, items: readonly { source: GuidanceSource; text: string }[]): GuidanceTextBlock[] {
	return items.map(item => ({ ...item, workspaceRoot: resolve(workspaceRoot) }));
}

function skillId(ecosystem: string, workspaceRoot: string, relPath: string): string {
	return `${ecosystem}:${hashContent(`${workspaceRoot}:${relPath}`).slice(0, 12)}:${basename(dirname(relPath))}`;
}

function parseSkillMetadata(skillPath: string, text: string, ecosystem: string, workspaceRoot: string, scopePrefix: string): SkillMetadata | undefined {
	const { meta, body } = parseFrontmatter(text);
	const name = metaString(meta, 'name') ?? basename(dirname(skillPath));
	const description = metaString(meta, 'description') ?? firstNonHeadingLine(body);
	if (!description) {
		return undefined;
	}
	const metadataMap = metaMap(meta, 'metadata') ?? {};
	const merged: Record<string, FrontmatterValue> = { ...metadataMap, ...meta };
	const triggers = metaStringList(merged, 'triggers');
	const disableModel = metaBoolean(merged, 'disable-model-invocation') === true
		|| (triggers.length > 0 && triggers.every(item => item.toLowerCase() === 'user'));
	const userInvocable = metaBoolean(merged, 'user-invocable');
	const argumentHint = metaString(merged, 'argument-hint') ?? metaString(merged, 'argumentHint');
	const contextMode = metaString(merged, 'context') ?? metaString(merged, 'contextMode');
	const allowedToolsHint = metaString(merged, 'allowed-tools') ?? metaString(merged, 'allowedTools');
	const license = metaString(merged, 'license');
	const compatibility = metaString(merged, 'compatibility');
	return {
		id: skillId(ecosystem, workspaceRoot, skillPath),
		name,
		description,
		path: skillPath,
		ecosystem,
		scopePrefix,
		...(argumentHint ? { argumentHint } : {}),
		...(userInvocable === false ? { userInvocable: false } : userInvocable === true ? { userInvocable: true } : {}),
		...(disableModel ? { modelInvocable: false } : {}),
		...(contextMode ? { contextMode } : {}),
		...(allowedToolsHint ? { allowedToolsHint } : {}),
		...(triggers.length ? { triggers } : {}),
		...(license ? { license } : {}),
		...(compatibility ? { compatibility } : {}),
	};
}

async function readJsonObject(reader: GuidanceFileReader, absPath: string): Promise<Record<string, unknown> | undefined> {
	try {
		const raw = await reader.readFile(absPath);
		const parsed = JSON.parse(raw) as unknown;
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
	} catch {
		return undefined;
	}
}

async function loadClaudeMdExcludes(reader: GuidanceFileReader, workspaceRoot: string): Promise<string[]> {
	const excludes: string[] = [];
	for (const rel of CLAUDE_SETTINGS_FILES) {
		const full = resolveGuidancePath(workspaceRoot, rel);
		if (!full || !(await reader.exists(full))) {
			continue;
		}
		const json = await readJsonObject(reader, full);
		const value = json?.claudeMdExcludes;
		if (Array.isArray(value)) {
			for (const item of value) {
				if (typeof item === 'string' && item.trim()) {
					excludes.push(item.trim());
				}
			}
		}
	}
	return excludes;
}

function isExcludedByClaudeSettings(relPath: string, excludes: readonly string[]): boolean {
	if (!excludes.length) {
		return false;
	}
	return excludes.some(pattern => matchesAnyGlob([pattern], relPath));
}

async function loadGeminiContextFileNames(reader: GuidanceFileReader, workspaceRoot: string): Promise<string[]> {
	const full = resolveGuidancePath(workspaceRoot, GEMINI_SETTINGS_FILE);
	if (!full || !(await reader.exists(full))) {
		return [];
	}
	const json = await readJsonObject(reader, full);
	const context = json?.context;
	if (!context || typeof context !== 'object' || Array.isArray(context)) {
		return [];
	}
	const fileName = (context as Record<string, unknown>).fileName;
	if (typeof fileName === 'string' && fileName.trim()) {
		return [fileName.trim()];
	}
	if (Array.isArray(fileName)) {
		return fileName.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map(item => item.trim());
	}
	return [];
}

async function loadOpenCodeInstructions(
	reader: GuidanceFileReader,
	workspaceRoot: string,
): Promise<{ localPaths: string[]; diagnostics: string[] }> {
	const localPaths: string[] = [];
	const diagnostics: string[] = [];
	const seenConfigs = new Set<string>();
	for (const rel of OPENCODE_CONFIG_FILES) {
		const full = resolveGuidancePath(workspaceRoot, rel);
		if (!full || seenConfigs.has(full) || !(await reader.exists(full))) {
			continue;
		}
		seenConfigs.add(full);
		const json = await readJsonObject(reader, full);
		const instructions = json?.instructions;
		if (!Array.isArray(instructions)) {
			continue;
		}
		for (const item of instructions) {
			if (typeof item !== 'string' || !item.trim()) {
				continue;
			}
			const entry = item.trim();
			if (/^https?:\/\//i.test(entry)) {
				diagnostics.push('Remote OpenCode instruction URL not auto-loaded by PreBase.');
				continue;
			}
			if (entry.startsWith('~/') || entry.startsWith('~\\')) {
				diagnostics.push(`Skipped user-global OpenCode path: ${entry}`);
				continue;
			}
			localPaths.push(entry);
		}
	}
	return { localPaths, diagnostics };
}

async function loadAgentsHierarchy(
	reader: GuidanceFileReader,
	workspaceRoot: string,
	targetPaths: readonly string[],
): Promise<{ source: GuidanceSource; text: string }[]> {
	const dirs = new Set<string>(['']);
	for (const target of targetPaths) {
		for (const dir of agentsAncestorDirs(target)) {
			dirs.add(dir);
		}
	}
	const loaded: { source: GuidanceSource; text: string }[] = [];
	for (const dir of [...dirs].sort((a, b) => a.localeCompare(b))) {
		if (dir && !targetPaths.some(target => target === dir || target.startsWith(`${dir}/`))) {
			continue;
		}
		const overrideRel = dir ? normalizeRel(join(dir, 'AGENTS.override.md')) : 'AGENTS.override.md';
		const agentsRel = dir ? normalizeRel(join(dir, 'AGENTS.md')) : 'AGENTS.md';
		let chosenRel: string | undefined;
		if (!isBlockedGuidancePath(overrideRel) && await reader.exists(join(workspaceRoot, overrideRel))) {
			chosenRel = overrideRel;
		} else if (!isBlockedGuidancePath(agentsRel) && await reader.exists(join(workspaceRoot, agentsRel))) {
			chosenRel = agentsRel;
		}
		if (!chosenRel) {
			continue;
		}
		const raw = scrubSecretsFromGuidance(await reader.readFile(join(workspaceRoot, chosenRel)));
		loaded.push({
			source: {
				path: chosenRel,
				ecosystem: 'agents',
				scope: dir || 'repository',
				alwaysApply: !dir,
				activationMode: 'always',
				globs: dir ? [`${dir}/**`] : [],
				contentHash: hashContent(raw),
			},
			text: raw.trim(),
		});
	}
	return loaded;
}

async function loadClaudeGeminiRoots(
	reader: GuidanceFileReader,
	workspaceRoot: string,
	targetPaths: readonly string[],
	kind: 'claude' | 'gemini',
	files: readonly string[],
	excludes: readonly string[] = [],
): Promise<{ source: GuidanceSource; text: string; diagnostics: string[] }[]> {
	const results: { source: GuidanceSource; text: string; diagnostics: string[] }[] = [];
	const dirs = new Set<string>(['']);
	for (const target of targetPaths) {
		for (const dir of agentsAncestorDirs(target)) {
			dirs.add(dir);
		}
	}
	for (const dir of [...dirs].sort((a, b) => a.localeCompare(b))) {
		if (dir && !targetPaths.some(target => target === dir || target.startsWith(`${dir}/`))) {
			continue;
		}
		for (const fileName of files) {
			const normalizedName = normalizeRel(fileName);
			// Allow fixed nested roots such as `.claude/CLAUDE.md`; reject traversal / absolute names.
			if (
				!normalizedName
				|| normalizedName.startsWith('/')
				|| /^[a-zA-Z]:/.test(normalizedName)
				|| normalizedName.split('/').some(part => part === '..' || part === '')
			) {
				continue;
			}
			const rel = dir ? normalizeRel(join(dir, normalizedName)) : normalizedName;
			if (isBlockedGuidancePath(rel) || (kind === 'claude' && isExcludedByClaudeSettings(rel, excludes))) {
				continue;
			}
			const full = resolveGuidancePath(workspaceRoot, rel);
			if (!full || !(await reader.exists(full))) {
				continue;
			}
			const raw = scrubSecretsFromGuidance(await reader.readFile(full));
			const { body } = parseFrontmatter(raw);
			const expanded = await resolveMarkdownImports(
				reader,
				workspaceRoot,
				rel,
				body,
				isBlockedGuidancePath,
				relPath => resolveGuidancePath(workspaceRoot, relPath),
			);
			results.push({
				source: {
					path: rel,
					ecosystem: kind,
					scope: dir || 'repository',
					alwaysApply: !dir,
					activationMode: 'always',
					globs: dir ? [`${dir}/**`] : [],
					contentHash: hashContent(expanded.text),
				},
				text: expanded.text.trim(),
				diagnostics: expanded.diagnostics,
			});
		}
	}
	return results;
}

function ruleActivationMode(ecosystem: string, meta: Record<string, FrontmatterValue>, globs: string[]): GuidanceActivationMode {
	if (ecosystem === 'cursor') {
		return cursorRuleMode(meta, globs);
	}
	if (ecosystem === 'windsurf' || ecosystem === 'devin') {
		return windsurfRuleMode(meta, globs);
	}
	if (ecosystem === 'kiro') {
		return kiroSteeringMode(meta, globs);
	}
	if (ecosystem === 'github') {
		return globs.length ? 'path' : 'manual';
	}
	return globs.length ? 'path' : 'always';
}

function skillMatchesTarget(metadata: SkillMetadata, targetPaths: readonly string[]): boolean {
	if (!metadata.scopePrefix) {
		return true;
	}
	const prefix = metadata.scopePrefix.endsWith('/') ? metadata.scopePrefix : `${metadata.scopePrefix}/`;
	return targetPaths.some(path => path === metadata.scopePrefix || path.startsWith(prefix));
}

function resolveSkillByIdOrName(
	catalog: readonly SkillMetadata[],
	idOrName: string,
	targetPaths: readonly string[],
): { skill?: SkillMetadata; ambiguous?: SkillMetadata[] } {
	const trimmed = idOrName.trim();
	const byId = catalog.filter(item => item.id === trimmed);
	if (byId.length === 1) {
		return { skill: byId[0] };
	}
	const byName = catalog.filter(item => item.name === trimmed && skillMatchesTarget(item, targetPaths));
	if (byName.length === 1) {
		return { skill: byName[0] };
	}
	if (byName.length > 1) {
		return { ambiguous: byName };
	}
	return {};
}

function detectNarrowConflicts(sources: readonly { source: GuidanceSource; text: string }[]): GuidanceConflict[] {
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

async function loadNamedMarkdownCatalog(
	reader: GuidanceFileReader,
	workspaceRoot: string,
	roots: readonly { dir: string; ext: string; ecosystem: string }[],
): Promise<Array<{ id: string; name: string; description: string; path: string; ecosystem: string }>> {
	const catalog: Array<{ id: string; name: string; description: string; path: string; ecosystem: string }> = [];
	for (const root of roots) {
		const dirs = await discoverNestedDirectories(reader, workspaceRoot, root.dir);
		for (const dir of dirs) {
			const fullDir = join(workspaceRoot, dir);
			if (!(await reader.exists(fullDir))) {
				continue;
			}
			const files = await walkBoundedFiles(reader, fullDir, rel => rel.endsWith(root.ext), { maxDepth: 4 });
			for (const relUnder of files) {
				const rel = normalizeRel(join(dir, relUnder));
				if (isBlockedGuidancePath(rel)) {
					continue;
				}
				const text = scrubSecretsFromGuidance(await reader.readFile(join(workspaceRoot, rel)));
				const { meta, body } = parseFrontmatter(text);
				const name = metaString(meta, 'name') ?? basename(rel, root.ext);
				const description = scrubSecretsFromGuidance(metaString(meta, 'description') ?? (firstNonHeadingLine(body) || name));
				catalog.push({
					id: `${root.ecosystem}:${hashContent(rel).slice(0, 12)}`,
					name,
					description,
					path: rel,
					ecosystem: root.ecosystem,
				});
			}
		}
	}
	return catalog;
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
			const prefix = `${resolve(workspaceRoot)}:`;
			for (const key of this.cache.keys()) {
				if (key.startsWith(prefix)) {
					this.cache.delete(key);
				}
			}
			return;
		}
		this.cache.clear();
	}

	async getSnapshot(
		workspaceRoot: string,
		targetPaths: readonly string[] = [],
		activatedSkillNames: readonly string[] = [],
		enabled = true,
		activatedRulePaths: readonly string[] = [],
	): Promise<ProjectGuidanceSnapshot> {
		const normalizedTargets = [...new Set(targetPaths.map(normalizeRel))].sort();
		const normalizedSkills = [...new Set(activatedSkillNames.map(name => name.trim()).filter(Boolean))].sort();
		const normalizedActivatedRules = [...new Set(activatedRulePaths.map(normalizeRel))].sort();
		const cacheKey = `${resolve(workspaceRoot)}:${normalizedTargets.join('|')}:${normalizedSkills.join('|')}:${normalizedActivatedRules.join('|')}:${enabled}`;
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
				activatedRules: [],
				onDemandRules: [],
				skillCatalog: [],
				playbookCatalog: [],
				agentProfileCatalog: [],
				activatedSkills: [],
				conflicts: [],
				diagnostics: this.reader.isTrusted?.() === false ? ['Workspace is not trusted; project guidance is disabled.'] : [],
				totalChars: 0,
			};
			this.cache.set(cacheKey, empty);
			return empty;
		}

		const sources: { source: GuidanceSource; text: string }[] = [];
		const onDemandRules: { source: GuidanceSource; description: string }[] = [];
		const diagnostics: string[] = [];

		sources.push(...await loadAgentsHierarchy(this.reader, workspaceRoot, normalizedTargets));

		for (const item of ROOT_ALWAYS_FILES) {
			if (isBlockedGuidancePath(item.file)) {
				continue;
			}
			const full = join(workspaceRoot, item.file);
			if (!(await this.reader.exists(full))) {
				continue;
			}
			const text = scrubSecretsFromGuidance(await this.reader.readFile(full));
			sources.push({
				source: {
					path: item.file,
					ecosystem: item.ecosystem,
					scope: 'repository',
					alwaysApply: true,
					activationMode: 'always',
					globs: [],
					contentHash: hashContent(text),
				},
				text: text.trim(),
			});
		}

		const claudeExcludes = await loadClaudeMdExcludes(this.reader, workspaceRoot);
		for (const loaded of await loadClaudeGeminiRoots(this.reader, workspaceRoot, normalizedTargets, 'claude', CLAUDE_ROOT_FILES, claudeExcludes)) {
			diagnostics.push(...loaded.diagnostics);
			sources.push({ source: loaded.source, text: loaded.text });
		}
		const geminiExtraNames = await loadGeminiContextFileNames(this.reader, workspaceRoot);
		const geminiFiles = [...GEMINI_ROOT_FILES, ...geminiExtraNames.filter(name => !GEMINI_ROOT_FILES.includes(name) && !name.includes('/') && !name.includes('..'))];
		for (const loaded of await loadClaudeGeminiRoots(this.reader, workspaceRoot, normalizedTargets, 'gemini', geminiFiles)) {
			diagnostics.push(...loaded.diagnostics);
			sources.push({ source: loaded.source, text: loaded.text });
		}

		const openCode = await loadOpenCodeInstructions(this.reader, workspaceRoot);
		diagnostics.push(...openCode.diagnostics);
		for (const instruction of openCode.localPaths) {
			if (instruction.includes('*') || instruction.includes('?') || instruction.includes('{')) {
				const matches = await walkBoundedFiles(
					this.reader,
					workspaceRoot,
					rel => matchesAnyGlob([instruction], rel) && (rel.endsWith('.md') || rel.endsWith('.txt')),
					{ maxDepth: 6 },
				);
				for (const rel of matches.slice(0, 24)) {
					if (isBlockedGuidancePath(rel)) {
						continue;
					}
					const text = scrubSecretsFromGuidance(await this.reader.readFile(join(workspaceRoot, rel)));
					sources.push({
						source: {
							path: rel,
							ecosystem: 'opencode',
							scope: 'repository',
							alwaysApply: true,
							activationMode: 'always',
							globs: [],
							contentHash: hashContent(text),
						},
						text: text.trim(),
					});
				}
				continue;
			}
			const resolved = resolveGuidancePath(workspaceRoot, instruction);
			if (!resolved) {
				diagnostics.push(`Skipped outside-workspace OpenCode instruction: ${instruction}`);
				continue;
			}
			const rel = normalizeRel(instruction);
			if (isBlockedGuidancePath(rel) || !(await this.reader.exists(resolved))) {
				continue;
			}
			const text = scrubSecretsFromGuidance(await this.reader.readFile(resolved));
			sources.push({
				source: {
					path: rel,
					ecosystem: 'opencode',
					scope: 'repository',
					alwaysApply: true,
					activationMode: 'always',
					globs: [],
					contentHash: hashContent(text),
				},
				text: text.trim(),
			});
		}

		for (const ruleDir of RULE_DIRS) {
			const ruleDirs = ruleDir.nested
				? await discoverNestedDirectories(this.reader, workspaceRoot, ruleDir.dir)
				: [ruleDir.dir];
			for (const dir of ruleDirs) {
				const fullDir = join(workspaceRoot, dir);
				if (!(await this.reader.exists(fullDir))) {
					continue;
				}
				const ruleFiles = await walkBoundedFiles(
					this.reader,
					fullDir,
					rel => rel.endsWith(ruleDir.ext),
					{ maxDepth: 6 },
				);
				for (const relUnder of ruleFiles) {
					const rel = normalizeRel(join(dir, relUnder));
					if (isBlockedGuidancePath(rel) || (ruleDir.ecosystem === 'claude' && isExcludedByClaudeSettings(rel, claudeExcludes))) {
						continue;
					}
					const text = scrubSecretsFromGuidance(await this.reader.readFile(join(workspaceRoot, rel)));
					const { meta, body } = parseFrontmatter(text);
					const globs = globsFromMeta(meta, text);
					const mode = ruleActivationMode(ruleDir.ecosystem, meta, globs);
					const alwaysApply = mode === 'always';
					const description = metaString(meta, 'description');
					const source: GuidanceSource = {
						path: rel,
						ecosystem: ruleDir.ecosystem,
						scope: globs.length ? globs.join(', ') : (alwaysApply ? 'repository' : mode),
						alwaysApply,
						activationMode: mode,
						description,
						globs,
						contentHash: hashContent(body),
					};
					if (mode === 'intelligent' || mode === 'manual') {
						onDemandRules.push({ source, description: description ?? basename(rel) });
						if (!normalizedActivatedRules.includes(rel)) {
							continue;
						}
					}
					if (mode === 'path' && !normalizedTargets.some(path => matchesAnyGlob(globs, path))) {
						continue;
					}
					sources.push({ source, text: body.trim() });
				}
			}
		}

		const kiroDirs = await discoverNestedDirectories(this.reader, workspaceRoot, KIRO_STEERING_DIR);
		for (const dir of kiroDirs) {
			const fullDir = join(workspaceRoot, dir);
			if (!(await this.reader.exists(fullDir))) {
				continue;
			}
			const files = await walkBoundedFiles(this.reader, fullDir, rel => rel.endsWith('.md'), { maxDepth: 6 });
			for (const relUnder of files) {
				const rel = normalizeRel(join(dir, relUnder));
				if (isBlockedGuidancePath(rel)) {
					continue;
				}
				const text = scrubSecretsFromGuidance(await this.reader.readFile(join(workspaceRoot, rel)));
				const { meta, body } = parseFrontmatter(text);
				const globs = globsFromMeta(meta, text, ['fileMatchPattern', 'globs']);
				const mode = kiroSteeringMode(meta, globs);
				const expanded = await expandKiroFileRefs(
					this.reader,
					workspaceRoot,
					rel,
					body,
					isBlockedGuidancePath,
					relPath => resolveGuidancePath(workspaceRoot, relPath),
				);
				diagnostics.push(...expanded.diagnostics);
				const description = metaString(meta, 'description');
				const source: GuidanceSource = {
					path: rel,
					ecosystem: 'kiro',
					scope: globs.length ? globs.join(', ') : (mode === 'always' ? 'repository' : mode),
					alwaysApply: mode === 'always',
					activationMode: mode,
					description,
					globs,
					contentHash: hashContent(expanded.text),
				};
				if (mode === 'intelligent' || mode === 'manual') {
					onDemandRules.push({ source, description: description ?? basename(rel) });
					if (!normalizedActivatedRules.includes(rel)) {
						continue;
					}
				}
				if (mode === 'path' && !normalizedTargets.some(path => matchesAnyGlob(globs, path))) {
					continue;
				}
				sources.push({ source, text: expanded.text.trim() });
			}
		}

		const playbookCatalog = await loadNamedMarkdownCatalog(this.reader, workspaceRoot, PLAYBOOK_DIRS);
		const agentProfileCatalog = await loadNamedMarkdownCatalog(this.reader, workspaceRoot, AGENT_PROFILE_DIRS);

		const activatedPlaybookBlocks: { source: GuidanceSource; text: string }[] = [];
		for (const activatedPath of normalizedActivatedRules) {
			const playbook = playbookCatalog.find(item => item.path === activatedPath);
			if (!playbook) {
				continue;
			}
			const full = join(workspaceRoot, playbook.path);
			if (!(await this.reader.exists(full))) {
				continue;
			}
			const text = scrubSecretsFromGuidance(await this.reader.readFile(full));
			const { body } = parseFrontmatter(text);
			activatedPlaybookBlocks.push({
				source: {
					path: playbook.path,
					ecosystem: playbook.ecosystem,
					scope: 'playbook',
					alwaysApply: false,
					activationMode: 'manual',
					description: playbook.description,
					globs: [],
					contentHash: hashContent(body),
				},
				text: body.trim(),
			});
		}

		const deduped = dedupeByHash([...sources, ...activatedPlaybookBlocks]);
		diagnostics.push(...deduped.diagnostics);

		const alwaysApplicable = deduped.items.filter(item =>
			item.source.activationMode === 'always'
			|| item.source.alwaysApply
			|| (!item.source.globs.length && item.source.scope === 'repository' && item.source.activationMode !== 'manual'));
		const pathApplicable = deduped.items.filter(item =>
			item.source.activationMode === 'path'
			&& item.source.globs.length
			&& normalizedTargets.some(path => matchesAnyGlob(item.source.globs, path)));
		const activatedRules = deduped.items.filter(item =>
			(item.source.activationMode === 'intelligent' || item.source.activationMode === 'manual')
			&& normalizedActivatedRules.includes(item.source.path));

		const skillFiles = await discoverSkillFiles(this.reader, workspaceRoot, SKILL_DIRS, isBlockedGuidancePath);
		const skillCatalog: SkillMetadata[] = [];
		const skillIdsSeen = new Set<string>();
		const skillContentSeen = new Set<string>();
		for (const skill of skillFiles) {
			const text = scrubSecretsFromGuidance(await this.reader.readFile(join(workspaceRoot, skill.relPath)));
			const contentKey = hashContent(text);
			if (skillContentSeen.has(contentKey)) {
				continue;
			}
			const metadata = parseSkillMetadata(skill.relPath, text, skill.ecosystem, workspaceRoot, skill.scopePrefix);
			if (metadata && !skillIdsSeen.has(metadata.id)) {
				skillIdsSeen.add(metadata.id);
				skillContentSeen.add(contentKey);
				skillCatalog.push(metadata);
			}
		}

		const activatedSkills: { metadata: SkillMetadata; body: string; root: string; files: string[] }[] = [];
		for (const idOrName of normalizedSkills) {
			const resolved = resolveSkillByIdOrName(skillCatalog, idOrName, normalizedTargets);
			if (resolved.ambiguous?.length) {
				diagnostics.push(`Ambiguous skill "${idOrName}": ${resolved.ambiguous.map(item => `${item.name}@${item.path}`).join(', ')}`);
				continue;
			}
			const metadata = resolved.skill;
			if (!metadata) {
				continue;
			}
			const text = scrubSecretsFromGuidance(await this.reader.readFile(join(workspaceRoot, metadata.path)));
			const { body } = parseFrontmatter(text);
			const skillRoot = normalizeRel(dirname(metadata.path));
			activatedSkills.push({
				metadata,
				body: body.trim().slice(0, this.budget.maxActivatedSkillChars),
				root: skillRoot,
				files: await listSkillResourceManifest(this.reader, workspaceRoot, skillRoot),
			});
		}

		const conflicts = detectNarrowConflicts([...alwaysApplicable, ...pathApplicable, ...activatedRules]);
		const totalChars =
			boundedJoin(alwaysApplicable.map(item => item.text), this.budget.maxAlwaysChars).length +
			boundedJoin(pathApplicable.map(item => item.text), this.budget.maxPathChars).length +
			boundedJoin(activatedRules.map(item => item.text), this.budget.maxPathChars).length +
			skillCatalog.reduce((sum, item) => sum + item.description.length, 0);
		const snapshot: ProjectGuidanceSnapshot = {
			enabled: true,
			workspaceRoot: resolve(workspaceRoot),
			alwaysApplicable: tagGuidanceBlocks(workspaceRoot, alwaysApplicable).slice(0, 32),
			pathApplicable: tagGuidanceBlocks(workspaceRoot, pathApplicable),
			activatedRules: tagGuidanceBlocks(workspaceRoot, activatedRules),
			onDemandRules: onDemandRules.slice(0, 48),
			skillCatalog: skillCatalog.slice(0, this.budget.maxSkillCatalogEntries),
			playbookCatalog: playbookCatalog.slice(0, 32),
			agentProfileCatalog: agentProfileCatalog.slice(0, 32),
			activatedSkills,
			conflicts,
			diagnostics,
			totalChars,
		};
		this.cache.set(cacheKey, snapshot);
		return snapshot;
	}

	async getCombinedSnapshot(
		targets: readonly GuidanceTarget[],
		activatedSkillIds: readonly string[] = [],
		enabled = true,
		activatedRulePaths: readonly string[] = [],
	): Promise<ProjectGuidanceSnapshot> {
		const byRoot = new Map<string, string[]>();
		for (const target of targets) {
			const list = byRoot.get(target.workspaceRoot) ?? [];
			list.push(target.relativePath);
			byRoot.set(target.workspaceRoot, list);
		}
		if (!byRoot.size && targets.length === 0) {
			return this.getSnapshot('', [], activatedSkillIds, enabled, activatedRulePaths);
		}
		const snapshots: ProjectGuidanceSnapshot[] = [];
		for (const [root, paths] of byRoot) {
			snapshots.push(await this.getSnapshot(root, [...new Set(paths)], activatedSkillIds, enabled, activatedRulePaths));
		}
		if (snapshots.length === 1) {
			return snapshots[0];
		}
		const primary = snapshots[0];
		return {
			enabled: snapshots.every(item => item.enabled),
			workspaceRoot: primary.workspaceRoot,
			alwaysApplicable: snapshots.flatMap(item => item.alwaysApplicable),
			pathApplicable: snapshots.flatMap(item => item.pathApplicable),
			activatedRules: snapshots.flatMap(item => item.activatedRules),
			onDemandRules: snapshots.flatMap(item => item.onDemandRules),
			skillCatalog: dedupeSkillCatalog(snapshots.flatMap(item => item.skillCatalog)),
			playbookCatalog: dedupePlaybooks(snapshots.flatMap(item => item.playbookCatalog)),
			agentProfileCatalog: dedupeAgentProfiles(snapshots.flatMap(item => item.agentProfileCatalog ?? [])),
			activatedSkills: snapshots.flatMap(item => item.activatedSkills),
			conflicts: snapshots.flatMap(item => item.conflicts),
			diagnostics: snapshots.flatMap(item => item.diagnostics),
			totalChars: snapshots.reduce((sum, item) => sum + item.totalChars, 0),
		};
	}
}

function dedupeSkillCatalog(items: readonly SkillMetadata[]): SkillMetadata[] {
	const seen = new Set<string>();
	const out: SkillMetadata[] = [];
	for (const item of items) {
		if (seen.has(item.id)) {
			continue;
		}
		seen.add(item.id);
		out.push(item);
	}
	return out;
}

function dedupePlaybooks(items: readonly PlaybookMetadata[]): PlaybookMetadata[] {
	const seen = new Set<string>();
	const out: PlaybookMetadata[] = [];
	for (const item of items) {
		if (seen.has(item.id)) {
			continue;
		}
		seen.add(item.id);
		out.push(item);
	}
	return out;
}

function dedupeAgentProfiles(items: readonly AgentProfileMetadata[]): AgentProfileMetadata[] {
	const seen = new Set<string>();
	const out: AgentProfileMetadata[] = [];
	for (const item of items) {
		if (seen.has(item.id)) {
			continue;
		}
		seen.add(item.id);
		out.push(item);
	}
	return out;
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
	const activatedRuleBlocks = snapshot.activatedRules.map(item =>
		`Source: ${item.source.path}\nScope: ${item.source.scope}\n${scrubSecretsFromGuidance(item.text)}`);
	const activatedRuleJoined = boundedJoin(activatedRuleBlocks, budget.maxPathChars);
	if (activatedRuleJoined) {
		parts.push(activatedRuleJoined);
	}
	const modelSkills = snapshot.skillCatalog.filter(skill => skill.modelInvocable !== false);
	if (modelSkills.length) {
		const catalogLines = ['AVAILABLE PROJECT SKILLS (metadata only; activate with prebase_project_guidance before using body/resources)'];
		let catalogChars = catalogLines[0].length;
		for (const skill of modelSkills) {
			const hint = skill.allowedToolsHint ? ` [tools hint: ${skill.allowedToolsHint}]` : '';
			const line = `- ${skill.name} (${skill.id}): ${scrubSecretsFromGuidance(skill.description)} (${skill.path})${hint}`;
			if (catalogChars + line.length + 1 > budget.maxPathChars) {
				break;
			}
			catalogLines.push(line);
			catalogChars += line.length + 1;
		}
		parts.push(catalogLines.join('\n'));
	}
	if (snapshot.playbookCatalog?.length) {
		const lines = ['AVAILABLE PROJECT PLAYBOOKS (on demand; activate with prebase_project_guidance activate_rule + rulePath)'];
		for (const playbook of snapshot.playbookCatalog.slice(0, 16)) {
			lines.push(`- ${playbook.name}: ${scrubSecretsFromGuidance(playbook.description)} (${playbook.path})`);
		}
		parts.push(lines.join('\n'));
	}
	if (snapshot.agentProfileCatalog?.length) {
		const lines = ['AVAILABLE AGENT PROFILES (catalog only; not auto-injected)'];
		for (const profile of snapshot.agentProfileCatalog.slice(0, 12)) {
			lines.push(`- ${profile.name}: ${scrubSecretsFromGuidance(profile.description)} (${profile.path})`);
		}
		parts.push(lines.join('\n'));
	}
	if (snapshot.onDemandRules.length) {
		const lines = ['AVAILABLE ON-DEMAND RULES (intelligent/manual; activate when relevant)'];
		for (const rule of snapshot.onDemandRules.slice(0, 24)) {
			lines.push(`- ${rule.source.path}: ${scrubSecretsFromGuidance(rule.description)} [${rule.source.activationMode}]`);
		}
		parts.push(lines.join('\n'));
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

export function resolveWorkspaceRootForPath(fsPath: string, folders: readonly { uri: { fsPath: string } }[] | undefined): string | undefined {
	const normalized = resolve(fsPath);
	for (const folder of folders ?? []) {
		const root = resolve(folder.uri.fsPath);
		if (normalized === root || normalized.startsWith(`${root}${sep}`)) {
			return root;
		}
	}
	return folders?.[0]?.uri.fsPath;
}

export function guidanceTargetsFromReferences(
	references: readonly { value: unknown }[] | undefined,
	asRelativePath?: (value: unknown) => { relativePath: string; fsPath?: string } | string | undefined,
	folders?: readonly { uri: { fsPath: string } }[],
): GuidanceTarget[] {
	const targets: GuidanceTarget[] = [];
	for (const ref of references ?? []) {
		const value = ref.value;
		if (typeof value === 'string') {
			const normalized = normalizeRel(value);
			if (normalized.includes('/') && !normalized.startsWith('/') && !/^[a-zA-Z]:/.test(normalized)) {
				if (folders?.length === 1) {
					targets.push({ workspaceRoot: resolve(folders[0].uri.fsPath), relativePath: normalized });
				}
			}
		} else if (value && typeof value === 'object') {
			const resolved = asRelativePath?.(value);
			const relativePath = typeof resolved === 'string' ? resolved : resolved?.relativePath;
			const fsPath = typeof resolved === 'object' && resolved && 'fsPath' in resolved ? resolved.fsPath : undefined;
			if (relativePath) {
				const normalized = normalizeRel(relativePath);
				const root = fsPath ? resolveWorkspaceRootForPath(fsPath, folders) : folders?.[0]?.uri.fsPath;
				if (root && !normalized.startsWith('/') && !/^[a-zA-Z]:/.test(normalized)) {
					targets.push({ workspaceRoot: resolve(root), relativePath: normalized });
				}
			}
		}
	}
	return targets;
}

export function guidanceTargetPathsFromReferences(
	references: readonly { value: unknown }[] | undefined,
	asRelativePath?: (value: unknown) => string | undefined,
): string[] {
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
