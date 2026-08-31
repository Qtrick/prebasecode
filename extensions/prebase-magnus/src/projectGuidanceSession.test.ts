/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	ProjectGuidanceSession,
	createProjectGuidanceSession,
	getProjectGuidanceSession,
	runWithProjectGuidanceSession,
} from './projectGuidanceSession';

const ROOT = '/tmp/workspace-a';

describe('projectGuidanceSession', () => {
	test('tracks targets, activated skills, and activated rules for a chat request', () => {
		const session = new ProjectGuidanceSession();
		session.addTarget(ROOT, 'graphs/src/foo.ts');
		session.addTarget(ROOT, 'graphs/src/bar.ts');
		session.activateSkill('deploy');
		session.activateRule('.cursor/rules/manual-only.mdc');
		assert.deepEqual(session.getTargetPathsForRoot(ROOT).sort(), ['graphs/src/bar.ts', 'graphs/src/foo.ts']);
		assert.deepEqual(session.getActivatedSkillIds(), ['deploy']);
		assert.deepEqual(session.getActivatedRulePaths(), ['.cursor/rules/manual-only.mdc']);
		session.clearActivatedRule('.cursor/rules/manual-only.mdc');
		assert.deepEqual(session.getActivatedRulePaths(), []);
	});

	test('AsyncLocalStorage isolates concurrent sessions', async () => {
		const sessionA = createProjectGuidanceSession([{ workspaceRoot: ROOT, relativePath: 'packages/a/x.ts' }]);
		const sessionB = createProjectGuidanceSession([{ workspaceRoot: '/tmp/workspace-b', relativePath: 'packages/b/y.ts' }]);
		sessionA.activateSkill('skill-a');
		sessionB.activateSkill('skill-b');

		const results = await Promise.all([
			runWithProjectGuidanceSession(sessionA, async () => {
				await new Promise(r => setTimeout(r, 5));
				return getProjectGuidanceSession()?.getActivatedSkillIds();
			}),
			runWithProjectGuidanceSession(sessionB, async () => {
				await new Promise(r => setTimeout(r, 2));
				return getProjectGuidanceSession()?.getActivatedSkillIds();
			}),
		]);
		assert.deepEqual(results[0], ['skill-a']);
		assert.deepEqual(results[1], ['skill-b']);
	});

	test('cancellation of one async scope does not clear another session store', async () => {
		const sessionA = createProjectGuidanceSession();
		const sessionB = createProjectGuidanceSession();
		sessionB.activateSkill('keeps-b');
		let afterA: string[] | undefined;
		await runWithProjectGuidanceSession(sessionA, async () => {
			sessionA.activateSkill('temp-a');
		});
		await runWithProjectGuidanceSession(sessionB, async () => {
			afterA = getProjectGuidanceSession()?.getActivatedSkillIds();
		});
		assert.deepEqual(afterA, ['keeps-b']);
	});

	test('hasSeenSource treats content hash changes as unseen', () => {
		const session = new ProjectGuidanceSession();
		const id = `${ROOT}::AGENTS.md`;
		session.markSeenSource(id, 'hash-a');
		assert.equal(session.hasSeenSource(id, 'hash-a'), true);
		assert.equal(session.hasSeenSource(id, 'hash-b'), false);
		assert.equal(session.hasSeenSource(id), true);
	});
});
