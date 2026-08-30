#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Targeted live Project Guidance smoke (not full Phase-3 matrix).
 *--------------------------------------------------------------------------------------------*/

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	acquirePhase3AcceptanceLock,
	dismissStartup,
	gracefulWorkbenchQuit,
	invokeLanguageModelTool,
	launchPreBase,
	waitForWorkbenchDriver,
	workbenchCommand,
} from './workbenchHarness.mjs';
import { phase3EvidenceMetadata } from './phase3Evidence.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const repo = resolve(dirname(scriptPath), '../../..');
const fixture = join(repo, 'test/prebase/fixtures/project-guidance-monorepo');
const evidenceDir = join(repo, 'reports/graph-acceptance/phase-3-final/magnus');

export function projectGuidanceSmokeFailures(evidence) {
	const failures = [];
	if (!evidence.rootSnapshot?.ok) failures.push('root guidance snapshot failed');
	if (!evidence.rootSnapshot?.always?.some(item => item.path === 'AGENTS.md')) failures.push('AGENTS.md not in always-applicable guidance');
	if (!evidence.rootSnapshot?.always?.some(item => item.path === 'CLAUDE.md')) failures.push('CLAUDE.md not always-applicable');
	if (!evidence.rootSnapshot?.always?.some(item => item.path === 'TEAM.md')) failures.push('Gemini context.fileName TEAM.md missing');
	if (!evidence.rootSnapshot?.always?.some(item => /kiro/i.test(item.ecosystem ?? '') || item.path.includes('.kiro/steering/always.md'))) {
		failures.push('Kiro always steering missing');
	}
	if (!evidence.rootSnapshot?.always?.some(item => item.path === 'docs/local-guide.md' || /OpenCode local/.test(item.body ?? ''))) {
		failures.push('OpenCode local instruction missing');
	}
	if (evidence.rootSnapshot?.always?.some(item => item.path === 'ignored-claude.md')) {
		failures.push('claudeMdExcludes failed; ignored-claude.md was loaded');
	}
	if (!evidence.rootSnapshot?.diagnostics?.some(message => /remote|not auto-loaded|http/i.test(message))) {
		failures.push('OpenCode remote URL diagnostic missing');
	}
	if (!evidence.rootSnapshot?.playbooks?.some(item => item.path.includes('.cursor/commands/ship.md') || item.name === 'ship')) {
		failures.push('Cursor ship playbook missing from catalog');
	}
	if (!evidence.rootSnapshot?.skills?.some(item => item.name === 'interop')) {
		failures.push('interop Agent Skill missing from catalog');
	}
	if (!evidence.graphSnapshot?.ok) failures.push('graphs path snapshot failed');
	if (!evidence.graphSnapshot?.pathScoped?.some(item => item.path.endsWith('graph.mdc'))) failures.push('graph.mdc not path-scoped for graphs/**');
	if (!evidence.graphSnapshot?.pathScoped?.some(item => /Graph path rule/.test(item.body ?? ''))) failures.push('graph rule body missing from path-scoped guidance');
	if (!evidence.graphSnapshot?.pathScoped?.some(item => item.path.includes('.kiro/steering/file-match.md') || /Kiro path steering/.test(item.body ?? ''))) {
		failures.push('Kiro path steering not path-scoped for graphs/**');
	}
	if (!evidence.toolGetForPaths?.ok) failures.push('prebase_project_guidance get_for_paths tool failed');
	if (!/Graph path rule/.test(evidence.toolGetForPaths?.content ?? '')) failures.push('get_for_paths did not return graph rule body');
	if (!evidence.jitSmoke?.ok) failures.push('guidance JIT smoke command failed');
	if (!evidence.jitSmoke?.deltaHasGraphRule) failures.push('JIT delta did not include graph rule body');
	if (evidence.jitSmoke && evidence.jitSmoke.packageRuleAbsent === false) failures.push('unrelated package override leaked into JIT delta');
	if (!evidence.skillActivate?.ok) failures.push('deploy skill activation failed');
	if (!evidence.playbookActivate?.ok) failures.push('ship playbook activate_rule failed');
	if (!/Manual ship playbook/.test(evidence.playbookActivate?.content ?? '')) failures.push('playbook body missing after activate_rule');
	if (evidence.quit?.remaining !== 'gone') failures.push('PreBase did not quit cleanly');
	return failures;
}

async function run() {
	const release = await acquirePhase3AcceptanceLock('magnus-guidance-smoke');
	mkdirSync(evidenceDir, { recursive: true });
	const startedAt = Date.now();
	let launched;
	const evidence = { ...phase3EvidenceMetadata(repo, 'magnus-guidance-smoke'), kind: 'project-guidance-live-smoke' };
	try {
		launched = await launchPreBase(repo, fixture);
		evidence.prebasePid = launched.info.pid;
		evidence.launchMs = Date.now() - startedAt;
		await dismissStartup(launched.page);
		await waitForWorkbenchDriver(launched.page);

		evidence.rootSnapshot = await workbenchCommand(launched.page, 'prebase.magnus.getGuidanceSnapshotForSmoke', { targetPaths: [] });
		evidence.graphSnapshot = await workbenchCommand(launched.page, 'prebase.magnus.getGuidanceSnapshotForSmoke', {
			targetPaths: ['graphs/src/foo.ts'],
		});

		evidence.toolGetForPaths = await invokeLanguageModelTool(launched.page, 'prebase_project_guidance', {
			operation: 'get_for_paths',
			paths: ['graphs/src/foo.ts'],
		});

		evidence.jitSmoke = await workbenchCommand(launched.page, 'prebase.magnus.runGuidanceJitSmoke');

		evidence.skillActivate = await invokeLanguageModelTool(launched.page, 'prebase_project_guidance', {
			operation: 'activate_skill',
			skillName: 'deploy',
		});

		evidence.playbookActivate = await invokeLanguageModelTool(launched.page, 'prebase_project_guidance', {
			operation: 'activate_rule',
			rulePath: '.cursor/commands/ship.md',
		});

		evidence.workspaceRead = await invokeLanguageModelTool(launched.page, 'prebase_workspace_read_file', {
			path: 'graphs/src/foo.ts',
		});

		evidence.durationMs = Date.now() - startedAt;
	} catch (error) {
		evidence.error = error instanceof Error ? error.stack ?? error.message : String(error);
	} finally {
		if (launched?.browser) {
			launched.browser.close = async () => undefined;
		}
		if (launched) {
			evidence.quit = await gracefulWorkbenchQuit(launched.page, launched.info.pid);
		}
		release();
	}
	const failures = projectGuidanceSmokeFailures(evidence);
	const result = { ok: failures.length === 0 && !evidence.error, failures, ...evidence };
	writeFileSync(join(evidenceDir, 'project-guidance-smoke.json'), JSON.stringify(result, null, 2));
	console.log(JSON.stringify({ ok: result.ok, failures, durationMs: result.durationMs }, null, 2));
	if (!result.ok) {
		process.exitCode = 1;
	}
}

if (resolve(process.argv[1] ?? '') === scriptPath) {
	await run();
}
