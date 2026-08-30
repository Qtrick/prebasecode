import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	ProjectGuidanceSession,
	beginProjectGuidanceSession,
	endProjectGuidanceSession,
	getProjectGuidanceSession,
} from './projectGuidanceSession';

describe('projectGuidanceSession', () => {
	test('tracks targets, activated skills, and activated rules for a chat request', () => {
		const session = new ProjectGuidanceSession();
		session.addTargets(['graphs/src/foo.ts', 'graphs\\src\\bar.ts']);
		session.activateSkill('deploy');
		session.activateRule('.cursor/rules/manual-only.mdc');
		assert.deepEqual(session.getTargetPaths().sort(), ['graphs/src/bar.ts', 'graphs/src/foo.ts']);
		assert.deepEqual(session.getActivatedSkillNames(), ['deploy']);
		assert.deepEqual(session.getActivatedRulePaths(), ['.cursor/rules/manual-only.mdc']);
	});

	test('begin/end session wiring exposes the active session only during a request', () => {
		endProjectGuidanceSession();
		assert.equal(getProjectGuidanceSession(), undefined);
		const session = beginProjectGuidanceSession(['src/main.ts']);
		assert.equal(getProjectGuidanceSession(), session);
		assert.deepEqual(session.getTargetPaths(), ['src/main.ts']);
		endProjectGuidanceSession();
		assert.equal(getProjectGuidanceSession(), undefined);
	});
});
