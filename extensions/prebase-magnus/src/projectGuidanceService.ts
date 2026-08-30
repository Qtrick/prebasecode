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
	discoverSkillFiles,
	metaStringList,
	normalizeRel as normalizeRelPath,
	parseApplyTo,
	parseFrontmatter,
	resolveMarkdownImports,
	walkBoundedFiles,
} from './projectGuidanceDiscovery';

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
	readonly activatedRules: readonly { source: GuidanceSource; text: string }[];
	readonly onDemandRules: readonly { source: GuidanceSource; description: string }[];
	readonly skillCatalog: readonly SkillMetadata[];
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

const SECRET_INLINE_PATTERN = /(?:api[_-]?key|secret(?:[_-]?key)?|access[_-]?token|auth(?:[_-]?token)?|password|passwd|private[_-]?key)\s*[:=]\s*\S+/gi;
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
	{ dir: '.cursor/rules', ext: '.mdc', ecosystem: 'cursor' },
	{ dir: '.claude/rules', ext: '.md', ecosystem: 'claude' },
	{ dir: '.github/instructions', ext: '.instructions.md', ecosystem: 'github' },
	{ dir: '.clinerules', ext: '.md', ecosystem: 'cline' },
	{ dir: '.clinerules', ext: '.txt', ecosystem: 'cline' },
	{ dir: '.windsurf/rules', ext: '.md', ecosystem: 'windsurf' },
];
const SKILL_DIRS = [
	{ dir: '.agents/skills', ecosystem: 'agents' },
	{ dir: '.cursor/skills', ecosystem: 'cursor' },
	{ dir: '.claude/skills', ecosystem: 'claude' },
	{ dir: '.codex/skills', ecosystem: 'codex' },
	{ dir: '.github/skills', ecosystem: 'github' },
	{ dir: '.cline/skills', ecosystem: 'cline' },
	{ dir: '.clinerules/skills', ecosystem: 'cline' },
	{ dir: '.windsurf/skills', ecosystem: 'windsurf' },
	{ dir: '.opencode/skills', ecosystem: 'opencode' },
];

export interface GuidanceFileReader {
	exists(path: string): boolean | Promise<boolean>;
	readFile(path: string): string | Promise<string>;
	readDirectory(path: string): string[] | Promise<string[]>;
	isTrusted?(): boolean;
}

function normalizeRel(path: string): string {
	return normalizeRelPath(path);
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

async function listSkillManifest(skillRootRel: string, reader: GuidanceFileReader, workspaceRoot: string): Promise<string[]> {
	const abs = join(workspaceRoot, skillRootRel);
	try {
		const entries = await reader.readDirectory(abs);
		return entries.filter(entry => entry !== 'SKILL.md').map(entry => normalizeRel(join(skillRootRel, entry))).slice(0, 32);
	} catch {
		return [];
	}
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
			const rel = dir ? normalizeRel(join(dir, fileName)) : fileName;
			if (isBlockedGuidancePath(rel)) {
				continue;
			}
			const full = join(workspaceRoot, rel);
			if (!(await reader.exists(full))) {
				continue;
			}
			const raw = scrubSecretsFromGuidance(await reader.readFile(full));
			const { body } = parseFrontmatter(raw);
			const expanded = await resolveMarkdownImports(
				reader,
				workspaceRoot,
				body,
				isBlockedGuidancePath,
				relPath => resolveGuidancePath(workspaceRoot, relPath.startsWith('./') ? relPath.slice(2) : relPath),
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

		for (const loaded of await loadClaudeGeminiRoots(this.reader, workspaceRoot, normalizedTargets, 'claude', CLAUDE_ROOT_FILES)) {
			diagnostics.push(...loaded.diagnostics);
			sources.push({ source: loaded.source, text: loaded.text });
		}
		for (const loaded of await loadClaudeGeminiRoots(this.reader, workspaceRoot, normalizedTargets, 'gemini', GEMINI_ROOT_FILES)) {
			diagnostics.push(...loaded.diagnostics);
			sources.push({ source: loaded.source, text: loaded.text });
		}

		for (const ruleDir of RULE_DIRS) {
			const fullDir = join(workspaceRoot, ruleDir.dir);
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
				const rel = normalizeRel(join(ruleDir.dir, relUnder));
				if (isBlockedGuidancePath(rel)) {
					continue;
				}
				const text = scrubSecretsFromGuidance(await this.reader.readFile(join(workspaceRoot, rel)));
				const { meta, body } = parseFrontmatter(text);
				const globs = metaStringList(meta, 'globs').length ? metaStringList(meta, 'globs') : parseApplyTo(text);
				const mode = ruleDir.ecosystem === 'cursor' ? cursorRuleMode(meta, globs) : (globs.length ? 'path' : 'always');
				const alwaysApply = mode === 'always';
				const description = typeof meta.description === 'string' ? meta.description : undefined;
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

		const deduped = dedupeByHash(sources);
		diagnostics.push(...deduped.diagnostics);

		const alwaysApplicable = deduped.items.filter(item =>
			item.source.activationMode === 'always'
			|| item.source.alwaysApply
			|| (!item.source.globs.length && item.source.scope === 'repository'));
		const pathApplicable = deduped.items.filter(item =>
			item.source.activationMode === 'path'
			&& item.source.globs.length
			&& normalizedTargets.some(path => matchesAnyGlob(item.source.globs, path)));
		const activatedRules = deduped.items.filter(item =>
			(item.source.activationMode === 'intelligent' || item.source.activationMode === 'manual')
			&& normalizedActivatedRules.includes(item.source.path));

		const skillFiles = await discoverSkillFiles(this.reader, workspaceRoot, SKILL_DIRS, isBlockedGuidancePath);
		const skillCatalog: SkillMetadata[] = [];
		for (const skill of skillFiles) {
			const text = scrubSecretsFromGuidance(await this.reader.readFile(join(workspaceRoot, skill.relPath)));
			const metadata = parseSkillMetadata(skill.relPath, text, skill.ecosystem);
			if (metadata) {
				skillCatalog.push(metadata);
			}
		}

		const activatedSkills: { metadata: SkillMetadata; body: string; root: string; files: string[] }[] = [];
		for (const name of normalizedSkills) {
			const metadata = skillCatalog.find(item => item.name === name);
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
				files: await listSkillManifest(skillRoot, this.reader, workspaceRoot),
			});
		}

		const conflicts = detectConflicts([...alwaysApplicable, ...pathApplicable, ...activatedRules]);
		const totalChars =
			boundedJoin(alwaysApplicable.map(item => item.text), this.budget.maxAlwaysChars).length +
			boundedJoin(pathApplicable.map(item => item.text), this.budget.maxPathChars).length +
			boundedJoin(activatedRules.map(item => item.text), this.budget.maxPathChars).length +
			skillCatalog.reduce((sum, item) => sum + item.description.length, 0);
		const snapshot: ProjectGuidanceSnapshot = {
			enabled: true,
			workspaceRoot,
			alwaysApplicable: alwaysApplicable.slice(0, 32),
			pathApplicable,
			activatedRules,
			onDemandRules: onDemandRules.slice(0, 48),
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
	const activatedRuleBlocks = snapshot.activatedRules.map(item =>
		`Source: ${item.source.path}\nScope: ${item.source.scope}\n${scrubSecretsFromGuidance(item.text)}`);
	const activatedRuleJoined = boundedJoin(activatedRuleBlocks, budget.maxPathChars);
	if (activatedRuleJoined) {
		parts.push(activatedRuleJoined);
	}
	if (snapshot.skillCatalog.length) {
		const catalogLines = ['AVAILABLE PROJECT SKILLS (metadata only; activate with prebase_project_guidance before using body/resources)'];
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
