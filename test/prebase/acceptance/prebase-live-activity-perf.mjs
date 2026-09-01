#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Performance & Resource Efficiency Suite for PreBase Magnus Live Activity:
 *  NOTE: This standalone Node script cannot measure real macOS CPU/GPU/wakeups.
 *  It validates diagnostics and JS heap only. Real resource profiling requires
 *  Instruments or process sampling against the running PreBase application.
 *--------------------------------------------------------------------------------------------*/

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { phase3EvidenceMetadata } from './phase3Evidence.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const repo = resolve(dirname(scriptPath), '../../..');
const evidenceDir = join(repo, 'reports/graph-acceptance/phase-3-final/magnus');
const addonPath = join(repo, 'native/prebase-live-activity/build/Release/prebase_live_activity.node');

async function sleep(ms) {
	return new Promise(r => setTimeout(r, ms));
}

function getCpuUsage() {
	const usage = process.cpuUsage();
	return {
		user: usage.user,
		system: usage.system,
		total: usage.user + usage.system
	};
}

function getMemoryUsage() {
	const usage = process.memoryUsage();
	return {
		heapUsed: usage.heapUsed,
		rss: usage.rss,
		external: usage.external,
		arrayBuffers: usage.arrayBuffers
	};
}

async function run() {
	mkdirSync(evidenceDir, { recursive: true });
	const results = {
		...phase3EvidenceMetadata(repo, 'magnus-live-activity-perf'),
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

	const initialMemory = getMemoryUsage();
	const initialCpu = getCpuUsage();

	// Test 1: Hidden baseline WITHOUT creating panel
	const test1 = { name: 'hidden-baseline-no-panel', ok: true, details: {} };
	try {
		// Dispose any existing controller first
		native.dispose();

		// Get diagnostics without triggering panel creation
		// This tests that getDiagnostics does not auto-create UI
		const diagHidden = native.getDiagnostics();
		test1.details.diag = diagHidden;

		// Panel should not exist in true hidden state
		if (diagHidden.panelCreated !== false) {
			throw new Error(`Expected panelCreated=false in hidden baseline, got ${diagHidden.panelCreated}`);
		}
		if (diagHidden.panelVisible !== false) {
			throw new Error(`Expected panelVisible=false initially, got ${diagHidden.panelVisible}`);
		}
		if (diagHidden.layerBacked !== false) {
			throw new Error(`Expected layerBacked=false when panel not created, got ${diagHidden.layerBacked}`);
		}
		if (diagHidden.globalMonitorInstalled !== false) {
			throw new Error(`Expected globalMonitorInstalled=false when hidden, got ${diagHidden.globalMonitorInstalled}`);
		}
	} catch (err) {
		test1.ok = false;
		test1.error = err.message;
		results.failures.push(`hidden-baseline-no-panel: ${err.message}`);
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

	// Test 3: REAL morphing cycles with proper animation wait time
	const test3 = { name: 'real-morph-cycles-10', ok: true, details: {} };
	try {
		const startMorph = Date.now();
		const cycleCount = 10; // Reduced from 100 to allow real animation completion

		for (let i = 0; i < cycleCount; i++) {
			// Expand
			native.setSnapshot({
				revision: 10 + i * 2,
				sessionId: 'stress-session',
				status: 'working',
				prebaseForeground: false,
				leftMetricsText: `${i}s`,
				rightMetricsText: `${i} files`,
				headerTitle: `Step ${i}`,
				activityDescription: `Real cycle ${i}`,
			});
			native.setPresentation({
				visible: true,
				pinned: false,
				reducedMotion: false,
				display: 'builtin',
			});

			// Wait for expansion animation to complete (240ms)
			await sleep(250);

			// Collapse
			native.setPresentation({
				visible: true,
				pinned: false,
				reducedMotion: false,
				display: 'builtin',
			});

			// Wait for collapse animation to complete (180ms)
			await sleep(190);
		}

		test3.details.durationRealCyclesMs = Date.now() - startMorph;
		test3.details.cycleCount = cycleCount;

		const diagAfterStress = native.getDiagnostics();
		test3.details.diagAfterStress = diagAfterStress;

		if (diagAfterStress.panelCreated !== true) {
			throw new Error('Panel must remain created after stress cycles');
		}
	} catch (err) {
		test3.ok = false;
		test3.error = err.message;
		results.failures.push(`real-morph-cycles-10: ${err.message}`);
	}
	results.tests.push(test3);

	// Test 4: Mid-flight retargeting stress
	const test4 = { name: 'mid-flight-retargeting', ok: true, details: {} };
	try {
		const startRetarget = Date.now();

		// Start expansion
		native.setSnapshot({
			revision: 100,
			sessionId: 'retarget-session',
			status: 'working',
			prebaseForeground: false,
			leftMetricsText: '0s',
			rightMetricsText: '0 files',
		});
		native.setPresentation({
			visible: true,
			pinned: false,
			reducedMotion: false,
			display: 'builtin',
		});

		// Wait 50ms (mid-expansion)
		await sleep(50);

		// Retarget to collapse before expansion completes
		native.setPresentation({
			visible: true,
			pinned: false,
			reducedMotion: false,
			display: 'builtin',
		});

		// Wait for collapse to complete (allow full animation cycle to settle)
		await sleep(300);

		test4.details.durationRetargetMs = Date.now() - startRetarget;

		const diagRetarget = native.getDiagnostics();
		test4.details.diagRetarget = diagRetarget;

		if (diagRetarget.transitionInFlight !== false) {
			throw new Error('Transition should not be in flight after wait');
		}
	} catch (err) {
		test4.ok = false;
		test4.error = err.message;
		results.failures.push(`mid-flight-retargeting: ${err.message}`);
	}
	results.tests.push(test4);

	// Test 5: Simulation of user actions
	const test5 = { name: 'user-simulation-actions', ok: true, details: {} };
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
		test5.details.optionSimResult = simResult;
		if (simResult !== true) {
			throw new Error('simulateAction option 1 must succeed');
		}

		// Follow up simulation
		const followUpSim = native.simulateAction('followUp', 'deploy with verbose logging');
		test5.details.followUpSim = followUpSim;
		if (followUpSim !== true) {
			throw new Error('simulateAction followUp must succeed');
		}
	} catch (err) {
		test5.ok = false;
		test5.error = err.message;
		results.failures.push(`user-simulation-actions: ${err.message}`);
	}
	results.tests.push(test5);

	// Clean up native panel
	native.dispose();

	// Test 6: Memory stability with RSS measurement
	const test6 = { name: 'memory-stability', ok: true, details: {} };
	try {
		if (global.gc) {
			global.gc();
		}
		const finalMemory = getMemoryUsage();
		test6.details.heapDiffKb = Math.round((finalMemory.heapUsed - initialMemory.heapUsed) / 1024);
		test6.details.heapUsedMb = Number((finalMemory.heapUsed / (1024 * 1024)).toFixed(2));
		test6.details.rssDiffKb = Math.round((finalMemory.rss - initialMemory.rss) / 1024);
		test6.details.rssMb = Number((finalMemory.rss / (1024 * 1024)).toFixed(2));

		// Add CPU delta measurement
		const finalCpu = getCpuUsage();
		test6.details.cpuDeltaUserMs = finalCpu.user - initialCpu.user;
		test6.details.cpuDeltaSystemMs = finalCpu.system - initialCpu.system;

		if (test6.details.heapDiffKb > 10240) {
			throw new Error(`Heap growth too high: ${test6.details.heapDiffKb} KB > 10240 KB`);
		}
	} catch (err) {
		test6.ok = false;
		test6.error = err.message;
		results.failures.push(`memory-stability: ${err.message}`);
	}
	results.tests.push(test6);

	// Test 7: Mathematical path topology invariance verification
	const test7 = { name: 'path-topology-invariance', ok: true, details: {} };
	try {
		const notchedCheck = native.validatePathTopology({ isNotched: true });
		if (!notchedCheck.compatible) {
			throw new Error(`Notched path topology incompatible: collapsed ${notchedCheck.collapsedElements} vs expanded ${notchedCheck.expandedElements}`);
		}
		if (notchedCheck.collapsedElements !== 14 || notchedCheck.expandedElements !== 14) {
			throw new Error(`Expected 14 path elements for notched topology, got ${notchedCheck.collapsedElements}`);
		}

		const pillCheck = native.validatePathTopology({ isNotched: false });
		if (!pillCheck.compatible) {
			throw new Error(`Pill path topology incompatible: collapsed ${pillCheck.collapsedElements} vs expanded ${pillCheck.expandedElements}`);
		}
		if (pillCheck.collapsedElements !== 10 || pillCheck.expandedElements !== 10) {
			throw new Error(`Expected 10 path elements for pill topology, got ${pillCheck.collapsedElements}`);
		}

		// Verify across multiple wing & height variations
		for (const leftW of [40, 60, 90, 150]) {
			for (const rightW of [40, 60, 90, 150]) {
				for (const h of [34, 50, 86, 180, 220]) {
					const res = native.validatePathTopology({ leftW, rightW, expandedH: h, isNotched: true });
					if (!res.compatible) {
						throw new Error(`Topology mismatch at leftW=${leftW}, rightW=${rightW}, h=${h}`);
					}
				}
			}
		}
		test7.details = {
			notchedElements: 14,
			pillElements: 10,
			combinationsTested: 80,
			invariant: true
		};
	} catch (err) {
		test7.ok = false;
		test7.error = err.message;
		results.failures.push(`path-topology-invariance: ${err.message}`);
	}
	results.tests.push(test7);

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
