import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import {
	cursorRuleMode,
	discoverHookDeclarations,
	expandKiroFileRefs,
	globMatches,
	GUIDANCE_WATCH_PATTERNS,
	kiroSteeringMode,
	matchesAnyGlob,
	parseFrontmatter,
	parseTomlCommand,
	resolveMarkdownImports,
	skillScopePrefix,
	SKILL_DIRS,
	stripCodeRegionsForImports,
	windsurfRuleMode,
	type FrontmatterValue,
} from './projectGuidanceDiscovery';
import { resolveGuidancePath } from './projectGuidanceService';

const magnusDir = dirname(fileURLToPath(import.meta.url));

function fixtureReader(root: string) {
	return {
		exists: (path: string) => existsSync(path),
		readFile: (path: string) => readFileSync(path, 'utf8'),
		readDirectory: (path: string) => readdirSync(path),
	};
}

describe('projectGuidanceDiscovery globs and imports', () => {
	test('globMatches supports brace expansion, question marks, and character classes', () => {
		assert.equal(globMatches('src/{a,b}.ts', 'src/a.ts'), true);
		assert.equal(globMatches('src/{a,b}.ts', 'src/c.ts'), false);
		assert.equal(globMatches('src/?.ts', 'src/a.ts'), true);
		assert.equal(globMatches('graphs/**', 'graphs/src/foo.ts'), true);
		assert.equal(globMatches('src/[ab].ts', 'src/a.ts'), true);
		assert.equal(globMatches('src/[ab].ts', 'src/c.ts'), false);
	});

	test('stripCodeRegionsForImports ignores fenced and inline code', () => {
		const body = 'See example:\n```ts\n@./secret.md\n```\nReal @./docs/guide.md and `@./inline.md` end';
		const stripped = stripCodeRegionsForImports(body);
		assert.doesNotMatch(stripped, /secret/);
		assert.doesNotMatch(stripped, /inline/);
		assert.ok(stripped.includes('@./docs/guide.md'));
	});

	test('windsurfRuleMode maps trigger frontmatter to activation modes', () => {
		assert.equal(windsurfRuleMode({ trigger: 'always_on' }, []), 'always');
		assert.equal(windsurfRuleMode({ trigger: 'model_decision' }, []), 'intelligent');
		assert.equal(windsurfRuleMode({ trigger: 'glob' }, ['graphs/**']), 'path');
		assert.equal(windsurfRuleMode({ trigger: 'manual' }, []), 'manual');
		assert.equal(windsurfRuleMode({}, ['graphs/**']), 'path');
		assert.equal(windsurfRuleMode({}, []), 'always');
	});

	test('kiroSteeringMode maps inclusion frontmatter to activation modes', () => {
		assert.equal(kiroSteeringMode({ inclusion: 'always' }, []), 'always');
		assert.equal(kiroSteeringMode({ inclusion: 'fileMatch' }, ['graphs/**']), 'path');
		assert.equal(kiroSteeringMode({ inclusion: 'manual' }, []), 'manual');
		assert.equal(kiroSteeringMode({ inclusion: 'auto' }, []), 'intelligent');
	});

	test('cursorRuleMode distinguishes always, path, intelligent, and manual rules', () => {
		assert.equal(cursorRuleMode({ alwaysApply: true }, []), 'always');
		assert.equal(cursorRuleMode({}, ['graphs/**']), 'path');
		assert.equal(cursorRuleMode({ description: 'Use when editing UI' }, []), 'intelligent');
		assert.equal(cursorRuleMode({}, []), 'manual');
	});

	test('parseFrontmatter supports nested maps, lists, and rejects YAML tags', () => {
		const nested = parseFrontmatter(`---
name: review
globs:
  - graphs/**
metadata:
  team: platform
  flags:
    beta: true
---
body
`);
		assert.equal(nested.meta.name, 'review');
		assert.deepEqual(nested.meta.globs, ['graphs/**']);
		assert.equal(typeof nested.meta.metadata, 'object');
		const metadata = nested.meta.metadata as Record<string, FrontmatterValue>;
		assert.equal(metadata.team, 'platform');
		assert.equal(typeof metadata.flags, 'object');
		assert.equal((metadata.flags as Record<string, unknown>).beta, true);

		const tagged = parseFrontmatter(`---
name: !!str bad
---
body
`);
		assert.deepEqual(tagged.meta, {});

		const anchored = parseFrontmatter(`---
name: &anchor value
ref: *anchor
---
body
`);
		assert.deepEqual(anchored.meta, {});
	});

	test('matchesAnyGlob refuses path activation without a target path', () => {
		assert.equal(matchesAnyGlob(['graphs/**'], undefined), false);
		assert.equal(matchesAnyGlob(['graphs/**'], ''), false);
		assert.equal(matchesAnyGlob([], undefined), true);
		assert.equal(matchesAnyGlob(['graphs/**'], 'graphs/src/foo.ts'), true);
	});

	test('globMatches tolerates malformed patterns without throwing', () => {
		assert.equal(globMatches('src/[unterminated', 'src/a.ts'), false);
		assert.equal(globMatches('src/{a,b', 'src/a.ts'), false);
	});

	test('resolveMarkdownImports expands claude source-relative imports and skips fenced imports', async () => {
		const root = join(magnusDir, '../../../test/prebase/fixtures/project-guidance-claude');
		const reader = fixtureReader(root);
		const claudeBody = readFileSync(join(root, 'CLAUDE.md'), 'utf8');
		const expanded = await resolveMarkdownImports(
			reader,
			root,
			'CLAUDE.md',
			claudeBody,
			() => false,
			rel => resolveGuidancePath(root, rel),
		);
		assert.match(expanded.text, /Shared Claude import body/);
		assert.doesNotMatch(expanded.text, /This import must not appear/);
	});

	test('resolveMarkdownImports reports clear diagnostics for absolute imports', async () => {
		const root = join(magnusDir, '../../../test/prebase/fixtures/project-guidance-claude');
		const reader = fixtureReader(root);
		const expanded = await resolveMarkdownImports(
			reader,
			root,
			'CLAUDE.md',
			'See @/etc/passwd and @../outside.md',
			() => false,
			rel => resolveGuidancePath(root, rel),
		);
		assert.ok(expanded.diagnostics.some(item => /outside-workspace or absolute/.test(item)));
		assert.doesNotMatch(expanded.text, /passwd|root:/);
	});

	test('expandKiroFileRefs blocks absolute and outside-workspace paths', async () => {
		const root = join(magnusDir, '../../../test/prebase/fixtures/project-guidance-kiro');
		const reader = fixtureReader(root);
		const expanded = await expandKiroFileRefs(
			reader,
			root,
			'.kiro/steering/file-match.md',
			'Safe #[[file:shared/note.md]] and bad #[[file:/etc/passwd]] #[[file:../../outside.md]]',
			() => false,
			rel => resolveGuidancePath(root, rel),
		);
		assert.match(expanded.text, /Kiro shared note body/);
		assert.doesNotMatch(expanded.text, /passwd|root:/);
		assert.ok(expanded.diagnostics.some(item => /outside-workspace Kiro file ref/.test(item)));
	});

	test('GUIDANCE_WATCH_PATTERNS covers kiro, opencode, gemini skills, and extra skill roots', () => {
		const required = [
			'**/.kiro/steering/**',
			'**/opencode.json',
			'**/.opencode/opencode.json',
			'**/.gemini/settings.json',
			'**/.gemini/skills/**/SKILL.md',
			'**/.kiro/skills/**/SKILL.md',
			'**/.opencode/skills/**/SKILL.md',
			'**/.devin/skills/**/SKILL.md',
			'**/.codeium/skills/**/SKILL.md',
			'**/.agents/skills/**/SKILL.md',
		];
		for (const pattern of required) {
			assert.ok(GUIDANCE_WATCH_PATTERNS.includes(pattern), `missing watch pattern ${pattern}`);
		}
		for (const { dir } of SKILL_DIRS) {
			assert.ok(GUIDANCE_WATCH_PATTERNS.includes(`**/${dir}/**/SKILL.md`), `skill watch missing for ${dir}`);
		}
	});

	test('skillScopePrefix strips nested skill roots to package scope', () => {
		assert.equal(skillScopePrefix('.agents/skills', '.agents/skills'), '');
		assert.equal(skillScopePrefix('packages/web/.agents/skills', '.agents/skills'), 'packages/web');
		assert.equal(skillScopePrefix('apps/api/.clinerules/skills', '.clinerules/skills'), 'apps/api');
	});

	test('viewProjectGuidance Quick Pick summary includes provenance labels', () => {
		const extension = readFileSync(join(magnusDir, 'extension.ts'), 'utf8');
		assert.match(extension, /Applied: \$\{snapshot\.alwaysApplicable\.length\} instructions/);
		assert.match(extension, /provenance\(item\.source\.ecosystem, 'Always'\)/);
		assert.match(extension, /Matches glob/);
		assert.match(extension, /Intelligent available/);
		assert.match(extension, /Manual \(activate_rule\)/);
		assert.match(extension, /Catalog only/);
		assert.match(extension, /prebase\.magnus\.viewProjectGuidance/);
	});

	test('chatParticipant injects guidance delta in the same tool turn', () => {
		const chat = readFileSync(join(magnusDir, 'chatParticipant.ts'), 'utf8');
		assert.match(chat, /const delta = computeGuidanceDelta\(previousGuidanceSnapshot, currentSnapshot, guidanceSession\)/);
		assert.match(chat, /responseParts\.push\(\{ text: deltaBlock \}\)/);
		assert.match(chat, /previousGuidanceSnapshot = currentSnapshot/);
		const deltaIdx = chat.indexOf('responseParts.push({ text: deltaBlock })');
		const continueIdx = chat.indexOf('messages.push({ role: \'user\', parts: responseParts })');
		assert.ok(deltaIdx > 0 && continueIdx > deltaIdx, 'delta must be appended before the next model turn');
	});

	test('parseTomlCommand parses basic and multiline TOML commands with argument hints', () => {
		const toml = `
# Gemini command definition
name = "deploy-preview"
description = "Deploy a preview instance"
argumentHint = "[environment]"
prompt = """
You are a deployment specialist.
Deploy to the specified target environment: {{args}}
Do not run foreign shell interpolation !{rm -rf /}.
Do not expand @{/etc/passwd}.
"""
`;
		const parsed = parseTomlCommand(toml);
		assert.equal(parsed.name, 'deploy-preview');
		assert.equal(parsed.description, 'Deploy a preview instance');
		assert.equal(parsed.argumentHint, '[environment]');
		assert.match(parsed.prompt, /Deploy to the specified target environment/);
		assert.match(parsed.prompt, /!\{rm -rf \/\}/);
		assert.match(parsed.prompt, /@\{\/etc\/passwd\}/);
		assert.match(parsed.prompt, /\{\{args\}\}/);
	});

	test('discoverHookDeclarations discovers hooks without executing them', async () => {
		const mockFileSystem: Record<string, string> = {
			'/test-root/.cursor/hooks.json': '{"preCommit": "echo test"}',
			'/test-root/.github/hooks/pre-push.json': '{"command": "echo test"}',
			'/test-root/.clinerules/hooks/post-tool.sh': '#!/bin/sh\necho test',
			'/test-root/.claude/settings.json': '{"hooks": {"beforePrompt": "echo test"}}',
		};
		const reader = {
			exists: (p: string) => Boolean(mockFileSystem[p]) || Object.keys(mockFileSystem).some(k => k.startsWith(p.endsWith('/') ? p : `${p}/`)),
			readFile: (p: string) => mockFileSystem[p] ?? '',
			readDirectory: (p: string) => {
				if (mockFileSystem[p] !== undefined) {
					throw new Error('ENOTDIR');
				}
				const prefix = p.endsWith('/') ? p : `${p}/`;
				const matches = Object.keys(mockFileSystem)
					.filter(k => k.startsWith(prefix))
					.map(k => k.slice(prefix.length).split('/')[0]);
				return [...new Set(matches)];
			},
		};
		const hooks = await discoverHookDeclarations(reader, '/test-root');
		assert.ok(hooks.includes('.cursor/hooks.json'));
		assert.ok(hooks.includes('.github/hooks/pre-push.json'));
		assert.ok(hooks.includes('.clinerules/hooks/post-tool.sh'));
		assert.ok(hooks.includes('.claude/settings.json (hooks declaration)'));
	});

	test('GUIDANCE_WATCH_PATTERNS contains GitHub agents, Gemini commands, Cline workflows, and hook patterns', () => {
		const expected = [
			'**/.github/agents/**',
			'**/.gemini/commands/**',
			'**/.clinerules/workflows/**',
			'**/.opencode/agents/**',
			'**/.opencode/commands/**',
			'**/.continue/rules/**',
			'**/.cursor/hooks.json',
			'**/.github/hooks/**',
			'**/.clinerules/hooks/**',
			'**/.cline/hooks/**',
			'**/.claude/hooks/**',
		];
		for (const pattern of expected) {
			assert.ok(GUIDANCE_WATCH_PATTERNS.includes(pattern), `Missing watch pattern: ${pattern}`);
		}
	});
});
