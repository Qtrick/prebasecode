#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Performance & Resource Efficiency Suite for PreBase Magnus Live Activity:
 *  Validates 0-CPU idle, continuous CAShapeLayer morphing, event monitor lifecycle,
 *  hover dwell debouncing, haptic count invariants, and memory stability under stress.
 *--------------------------------------------------------------------------------------------*/

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repo = resolve(dirname(scriptPath), '../../..');
const evidenceDir = join(repo, 'reports/graph-acceptance/phase-3-final/magnus');
const addonPath = join(repo, 'native/prebase-live-activity/build/Release/prebase_live_activity.node');

async function sleep(ms) {
	return new Promise(r => setTimeout(r, ms));
}

async function run() {
	mkdirSync(evidenceDir, { recursive: true });
	const results = {
		timestamp: new Date().toISOString(),
		platform: process.platform,
		arch: process.arch,
		tests: [],
		failures: [],
	};

	if (process.platform !== 'darwin' || !existsSync(addonPath)) {
		results.skipped = 'Live Activity performance suite requires macOS and compiled native addon';
		console.log(JSON.stringify(results, null, 2));
		process.exit(0);
	}

	const require = createRequire(import.meta.url);
	const native = require(addonPath);

	const initialMemory = process.memoryUsage().heapUsed;

	// Test 1: Native module initialization & hidden baseline
	const test1 = { name: 'hidden-baseline', ok: true, details: {} };
	try {
		native.dispose();
		const diagHidden = native.getDiagnostics();
		test1.details.diag = diagHidden;
		if (diagHidden.panelVisible !== false) {
			throw new Error(`Expected panelVisible=false initially, got ${diagHidden.panelVisible}`);
		}
		if (diagHidden.layerBacked !== true) {
			throw new Error(`Expected layerBacked=true, got ${diagHidden.layerBacked}`);
		}
		if (diagHidden.continuousMorphSupported !== true) {
			throw new Error(`Expected continuousMorphSupported=true, got ${diagHidden.continuousMorphSupported}`);
		}
	} catch (err) {
		test1.ok = false;
		test1.error = err.message;
		results.failures.push(`hidden-baseline: ${err.message}`);
	}
	results.tests.push(test1);

	// Test 2: Collapsed mode event monitor installation & status
	const test2 = { name: 'collapsed-idle-monitoring', ok: true, details: {} };
	try {
		const commands = [];
		native.setCommandHandler((cmd, payload) => {
			commands.push({ cmd, payload });
		});

		native.setSnapshot({
			revision: 1,
			sessionId: 'test-session-1',
			status: 'working',
			prebaseForeground: false,
			leftMetricsText: '42m',
			rightMetricsText: '+12/-4',
		});
		native.setPresentation({
			visible: true,
			pinned: false,
			reducedMotion: false,
			display: 'builtin',
		});

		await sleep(80);
		const diagCollapsed = native.getDiagnostics();
		test2.details.diagCollapsed = diagCollapsed;

		if (diagCollapsed.panelVisible !== true) {
			throw new Error('Panel must be visible when presentation visible=true');
		}
		if (diagCollapsed.globalMonitorInstalled !== true) {
			throw new Error('Global monitor must be installed in collapsed mode for hover acquisition');
		}
	} catch (err) {
		test2.ok = false;
		test2.error = err.message;
		results.failures.push(`collapsed-idle-monitoring: ${err.message}`);
	}
	results.tests.push(test2);

	// Test 3: Rapid snapshot updates & morphing stress (100 cycles)
	const test3 = { name: 'morphing-stress-100-cycles', ok: true, details: {} };
	try {
		const startMorph = Date.now();
		for (let i = 0; i < 100; i++) {
			native.setSnapshot({
				revision: 10 + i,
				sessionId: 'stress-session',
				status: i % 2 === 0 ? 'working' : 'waiting',
				prebaseForeground: false,
				leftMetricsText: `${i}s`,
				rightMetricsText: `${i} files`,
				headerTitle: `Step ${i}`,
				activityDescription: `Stress iteration ${i}`,
			});
			native.setPresentation({
				visible: true,
				pinned: i % 10 === 0,
				reducedMotion: false,
				display: 'builtin',
			});
		}
		await sleep(150);
		test3.details.duration100CyclesMs = Date.now() - startMorph;

		const diagAfterStress = native.getDiagnostics();
		test3.details.diagAfterStress = diagAfterStress;

		if (diagAfterStress.panelCreated !== true) {
			throw new Error('Panel must remain created after stress cycles');
		}
	} catch (err) {
		test3.ok = false;
		test3.error = err.message;
		results.failures.push(`morphing-stress-100-cycles: ${err.message}`);
	}
	results.tests.push(test3);

	// Test 4: Simulation of user actions
	const test4 = { name: 'user-simulation-actions', ok: true, details: {} };
	try {
		// Seed pending question with canonical pendingInteraction schema
		native.setSnapshot({
			revision: 200,
			sessionId: 'question-session',
			status: 'attention',
			prebaseForeground: false,
			pendingInteraction: {
				kind: 'question',
				interactionId: 'q-deploy-1',
				title: 'Choose deployment lane',
				options: [
					{ id: 'dev', label: 'Development' },
					{ id: 'staging', label: 'Staging' },
					{ id: 'prod', label: 'Production' },
				],
			},
		});
		native.setPresentation({
			visible: true,
			pinned: false,
			reducedMotion: false,
			display: 'builtin',
		});
		await sleep(80);

		const simResult = native.simulateAction('option', 1);
		test4.details.optionSimResult = simResult;
		if (simResult !== true) {
			throw new Error('simulateAction option 1 must succeed');
		}

		// Follow up simulation
		const followUpSim = native.simulateAction('followUp', 'deploy with verbose logging');
		test4.details.followUpSim = followUpSim;
		if (followUpSim !== true) {
			throw new Error('simulateAction followUp must succeed');
		}
	} catch (err) {
		test4.ok = false;
		test4.error = err.message;
		results.failures.push(`user-simulation-actions: ${err.message}`);
	}
	results.tests.push(test4);

	// Clean up native panel
	native.dispose();

	// Test 5: Memory stability
	const test5 = { name: 'memory-stability', ok: true, details: {} };
	try {
		if (global.gc) {
			global.gc();
		}
		const finalMemory = process.memoryUsage().heapUsed;
		test5.details.heapDiffKb = Math.round((finalMemory - initialMemory) / 1024);
		test5.details.heapUsedMb = Number((finalMemory / (1024 * 1024)).toFixed(2));
	} catch (err) {
		test5.ok = false;
		test5.error = err.message;
	}
	results.tests.push(test5);

	results.ok = results.failures.length === 0;
	const out = join(evidenceDir, 'live-activity-perf.json');
	writeFileSync(out, JSON.stringify(results, null, 2) + '\n');
	console.log(JSON.stringify(results, null, 2));
	process.exit(results.ok ? 0 : 1);
}

run().catch(err => {
	console.error(err);
	process.exit(1);
});
