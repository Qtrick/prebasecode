import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { projectGuidanceSmokeFailures } from './prebase-magnus-guidance-live.mjs';

function greenEvidence(overrides = {}) {
	return {
		rootSnapshot: {
			ok: true,
			always: [
				{ path: 'AGENTS.md', ecosystem: 'agents', body: 'Agents root' },
				{ path: 'CLAUDE.md', ecosystem: 'claude', body: 'Claude root' },
				{ path: 'TEAM.md', ecosystem: 'gemini', body: 'Gemini TEAM' },
				{ path: '.kiro/steering/always.md', ecosystem: 'kiro', body: 'Kiro always' },
				{ path: 'docs/local-guide.md', ecosystem: 'opencode', body: 'OpenCode local guide' },
			],
			diagnostics: ['OpenCode remote URL http://example.com is not auto-loaded'],
			playbooks: [{ path: '.cursor/commands/ship.md', name: 'ship' }],
			skills: [{ name: 'interop' }],
		},
		graphSnapshot: {
			ok: true,
			pathScoped: [
				{ path: '.cursor/rules/graph.mdc', body: 'Graph path rule for graphs/**' },
				{ path: '.kiro/steering/file-match.md', body: 'Kiro path steering for graphs' },
			],
		},
		toolGetForPaths: { ok: true, content: 'Graph path rule body from tool' },
		jitSmoke: {
			ok: true,
			deltaHasGraphRule: true,
			packageRuleAbsent: true,
		},
		skillActivate: { ok: true },
		playbookActivate: { ok: true, content: 'Manual ship playbook body' },
		quit: { remaining: 'gone' },
		...overrides,
	};
}

describe('projectGuidanceSmokeFailures classifier', () => {
	test('returns no failures for complete green synthetic evidence', () => {
		assert.deepEqual(projectGuidanceSmokeFailures(greenEvidence()), []);
	});

	test('flags missing ecosystem always-applicable sources without false-passing', () => {
		const failures = projectGuidanceSmokeFailures(greenEvidence({
			rootSnapshot: {
				ok: true,
				always: [{ path: 'AGENTS.md', ecosystem: 'agents', body: 'only agents' }],
				diagnostics: ['remote URL not auto-loaded'],
				playbooks: [{ path: '.cursor/commands/ship.md', name: 'ship' }],
				skills: [{ name: 'interop' }],
			},
		}));
		assert.ok(failures.includes('CLAUDE.md not always-applicable'));
		assert.ok(failures.includes('Gemini context.fileName TEAM.md missing'));
		assert.ok(failures.includes('Kiro always steering missing'));
		assert.ok(failures.includes('OpenCode local instruction missing'));
	});

	test('flags claudeMdExcludes regression when ignored-claude.md loads', () => {
		const failures = projectGuidanceSmokeFailures(greenEvidence({
			rootSnapshot: {
				...greenEvidence().rootSnapshot,
				always: [
					...greenEvidence().rootSnapshot.always,
					{ path: 'ignored-claude.md', body: 'should not load' },
				],
			},
		}));
		assert.ok(failures.includes('claudeMdExcludes failed; ignored-claude.md was loaded'));
	});

	test('flags JIT false-positives: missing graph rule or package override leak', () => {
		assert.ok(projectGuidanceSmokeFailures(greenEvidence({
			jitSmoke: { ok: true, deltaHasGraphRule: false, packageRuleAbsent: true },
		})).includes('JIT delta did not include graph rule body'));

		assert.ok(projectGuidanceSmokeFailures(greenEvidence({
			jitSmoke: { ok: true, deltaHasGraphRule: true, packageRuleAbsent: false },
		})).includes('unrelated package override leaked into JIT delta'));
	});

	test('flags path-scoped and tool content gaps without requiring PreBase launch', () => {
		const failures = projectGuidanceSmokeFailures(greenEvidence({
			graphSnapshot: { ok: true, pathScoped: [] },
			toolGetForPaths: { ok: true, content: 'no graph body here' },
		}));
		assert.ok(failures.includes('graph.mdc not path-scoped for graphs/**'));
		assert.ok(failures.includes('get_for_paths did not return graph rule body'));
	});

	test('flags unclean quit and activation failures', () => {
		const failures = projectGuidanceSmokeFailures(greenEvidence({
			skillActivate: { ok: false },
			playbookActivate: { ok: true, content: 'wrong body' },
			quit: { remaining: 'alive' },
		}));
		assert.ok(failures.includes('deploy skill activation failed'));
		assert.ok(failures.includes('playbook body missing after activate_rule'));
		assert.ok(failures.includes('PreBase did not quit cleanly'));
	});
});
