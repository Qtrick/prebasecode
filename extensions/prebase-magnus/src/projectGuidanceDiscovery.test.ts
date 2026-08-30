import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import {
	cursorRuleMode,
	globMatches,
	resolveMarkdownImports,
	stripCodeRegionsForImports,
	windsurfRuleMode,
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

	test('cursorRuleMode distinguishes always, path, intelligent, and manual rules', () => {
		assert.equal(cursorRuleMode({ alwaysApply: true }, []), 'always');
		assert.equal(cursorRuleMode({}, ['graphs/**']), 'path');
		assert.equal(cursorRuleMode({ description: 'Use when editing UI' }, []), 'intelligent');
		assert.equal(cursorRuleMode({}, []), 'manual');
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
});
