import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { cursorRuleMode, parseFrontmatter } from './projectGuidanceDiscovery';

describe('projectGuidanceDiscovery', () => {
	test('cursorRuleMode distinguishes always, path, intelligent, and manual rules', () => {
		assert.equal(cursorRuleMode({ alwaysApply: true }, []), 'always');
		assert.equal(cursorRuleMode({}, ['graphs/**']), 'path');
		assert.equal(cursorRuleMode({ description: 'Use when editing UI' }, []), 'intelligent');
		assert.equal(cursorRuleMode({}, []), 'manual');
	});

	test('parseFrontmatter reads boolean flags and glob lists', () => {
		const parsed = parseFrontmatter(`---
alwaysApply: false
globs:
  - graphs/**
description: Graph-only edits
---
Body
`);
		assert.equal(parsed.meta.alwaysApply, false);
		assert.deepEqual(parsed.meta.globs, ['graphs/**']);
		assert.equal(parsed.meta.description, 'Graph-only edits');
		assert.equal(parsed.body.trim(), 'Body');
	});
});
