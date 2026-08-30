import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { computeGuidanceDelta, formatGetForPathsResult, formatGuidanceDeltaForPrompt } from './projectGuidanceDelta';
import { createProjectGuidanceSession } from './projectGuidanceSession';
import type { ProjectGuidanceSnapshot } from './projectGuidanceService';

function emptySnapshot(root: string): ProjectGuidanceSnapshot {
	return {
		enabled: true,
		workspaceRoot: root,
		alwaysApplicable: [],
		pathApplicable: [],
		activatedRules: [],
		onDemandRules: [],
		skillCatalog: [],
		playbookCatalog: [],
		activatedSkills: [],
		conflicts: [],
		diagnostics: [],
		totalChars: 0,
	};
}

describe('projectGuidanceDelta', () => {
	test('returns newly applicable bodies and avoids repeating seen sources', () => {
		const root = '/tmp/root';
		const session = createProjectGuidanceSession();
		const previous = emptySnapshot(root);
		const current: ProjectGuidanceSnapshot = {
			...previous,
			pathApplicable: [{
				source: {
					path: '.cursor/rules/graph.mdc',
					ecosystem: 'cursor',
					scope: 'graphs/**',
					alwaysApply: false,
					activationMode: 'path',
					globs: ['graphs/**'],
					contentHash: 'abc123',
				},
				text: 'Only edit graphs/.',
			}],
		};
		const first = computeGuidanceDelta(previous, current, session);
		assert.equal(first.newlyApplied.length, 1);
		assert.match(formatGuidanceDeltaForPrompt(first), /Only edit graphs/);
		const second = computeGuidanceDelta(current, current, session);
		assert.equal(second.newlyApplied.length, 0);
		assert.equal(formatGuidanceDeltaForPrompt(second), '');
	});

	test('formatGetForPathsResult includes guidance bodies for newly applied sources', () => {
		const root = '/tmp/root';
		const session = createProjectGuidanceSession();
		const previous = emptySnapshot(root);
		const current: ProjectGuidanceSnapshot = {
			...previous,
			pathApplicable: [{
				source: {
					path: '.cursor/rules/shared-path.mdc',
					ecosystem: 'cursor',
					scope: 'shared/**',
					alwaysApply: false,
					activationMode: 'path',
					globs: ['shared/**'],
					contentHash: 'def456',
				},
				text: 'Root A path-scoped rule.',
			}],
		};
		const delta = computeGuidanceDelta(previous, current, session);
		const result = formatGetForPathsResult(current, delta);
		assert.equal(result.ok, true);
		const newlyApplied = result.newlyApplied as Array<{ path: string; body: string }>;
		assert.equal(newlyApplied.length, 1);
		assert.match(newlyApplied[0].body, /Root A path-scoped rule/);
	});
});
