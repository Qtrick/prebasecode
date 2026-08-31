/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { computeGuidanceDelta, formatGetForPathsResult, formatGuidanceDeltaForPrompt, seedSessionFromSnapshot } from './projectGuidanceDelta';
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
		agentProfileCatalog: [],
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
				text: 'Root A path-scoped rule.\nAPI_KEY=super-secret-value\n',
			}],
			skillCatalog: [{
				id: 'agents:abc:review',
				name: 'review',
				description: 'password=should-not-leak',
				path: '.agents/skills/review/SKILL.md',
				ecosystem: 'agents',
				scopePrefix: '',
				pathGlobs: [],
			}],
		};
		const delta = computeGuidanceDelta(previous, current, session);
		const result = formatGetForPathsResult(current, delta);
		assert.equal(result.ok, true);
		const newlyApplied = result.newlyApplied as Array<{ path: string; body: string }>;
		assert.equal(newlyApplied.length, 1);
		assert.match(newlyApplied[0].body, /Root A path-scoped rule/);
		assert.doesNotMatch(newlyApplied[0].body, /super-secret-value/);
		assert.match(newlyApplied[0].body, /\[redacted\]/);
		const skills = result.skills as Array<{ description: string }>;
		assert.doesNotMatch(JSON.stringify(skills), /should-not-leak/);
	});

	test('seedSessionFromSnapshot prevents duplicated delta bodies on subsequent turns', () => {
		const root = '/tmp/root';
		const session = createProjectGuidanceSession();
		const snapshot: ProjectGuidanceSnapshot = {
			...emptySnapshot(root),
			alwaysApplicable: [{
				source: {
					path: 'AGENTS.md',
					ecosystem: 'agents',
					scope: 'repository',
					alwaysApply: true,
					activationMode: 'always',
					globs: [],
					contentHash: 'always-1',
				},
				text: 'Always apply agents guidance.',
			}],
			pathApplicable: [{
				source: {
					path: '.cursor/rules/graph.mdc',
					ecosystem: 'cursor',
					scope: 'graphs/**',
					alwaysApply: false,
					activationMode: 'path',
					globs: ['graphs/**'],
					contentHash: 'graph-1',
				},
				text: 'Graph path rule.',
			}],
		};
		seedSessionFromSnapshot(snapshot, session);
		const delta = computeGuidanceDelta(snapshot, snapshot, session);
		assert.equal(delta.newlyApplied.length, 0);
		assert.equal(formatGuidanceDeltaForPrompt(delta), '');
	});

	test('path rule becomes newly applied in the same turn after target registration', () => {
		const root = '/tmp/root';
		const session = createProjectGuidanceSession();
		const initial: ProjectGuidanceSnapshot = {
			...emptySnapshot(root),
			alwaysApplicable: [{
				source: {
					path: 'AGENTS.md',
					ecosystem: 'agents',
					scope: 'repository',
					alwaysApply: true,
					activationMode: 'always',
					globs: [],
					contentHash: 'always-1',
				},
				text: 'Always apply agents guidance.',
			}],
		};
		seedSessionFromSnapshot(initial, session);
		session.addTarget(root, 'graphs/src/foo.ts');
		const after: ProjectGuidanceSnapshot = {
			...initial,
			pathApplicable: [{
				source: {
					path: '.cursor/rules/graph.mdc',
					ecosystem: 'cursor',
					scope: 'graphs/**',
					alwaysApply: false,
					activationMode: 'path',
					globs: ['graphs/**'],
					contentHash: 'graph-1',
				},
				text: 'Graph path rule for graphs/**.',
			}],
		};
		const delta = computeGuidanceDelta(initial, after, session);
		assert.equal(delta.newlyApplied.length, 1);
		assert.equal(delta.newlyApplied[0].path, '.cursor/rules/graph.mdc');
		assert.match(formatGuidanceDeltaForPrompt(delta), /Graph path rule/);
		const second = computeGuidanceDelta(after, after, session);
		assert.equal(second.newlyApplied.length, 0);
	});

	test('formatGetForPathsResult scrubs secrets in full always/path bodies when delta is empty', () => {
		const root = '/tmp/root';
		const snapshot: ProjectGuidanceSnapshot = {
			...emptySnapshot(root),
			alwaysApplicable: [{
				source: {
					path: 'AGENTS.md',
					ecosystem: 'agents',
					scope: 'repository',
					alwaysApply: true,
					activationMode: 'always',
					globs: [],
					contentHash: 'a1',
				},
				text: 'API_KEY=super-secret-always',
			}],
			pathApplicable: [{
				source: {
					path: '.cursor/rules/path.mdc',
					ecosystem: 'cursor',
					scope: 'src/**',
					alwaysApply: false,
					activationMode: 'path',
					globs: ['src/**'],
					contentHash: 'p1',
				},
				text: 'password=path-secret-value',
			}],
		};
		const emptyDelta = { newlyApplied: [], newlyAvailableRules: [], newlyAvailableSkills: [], diagnostics: [] };
		const result = formatGetForPathsResult(snapshot, emptyDelta);
		const always = result.always as Array<{ path: string; body: string }>;
		const pathScoped = result.pathScoped as Array<{ path: string; body: string }>;
		assert.equal(always[0].path, 'AGENTS.md');
		assert.doesNotMatch(always[0].body, /super-secret-always/);
		assert.match(always[0].body, /\[redacted\]/);
		assert.doesNotMatch(pathScoped[0].body, /path-secret-value/);
		assert.match(pathScoped[0].body, /\[redacted\]/);
	});
});
