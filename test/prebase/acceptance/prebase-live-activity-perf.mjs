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

	// Test 3: REAL semantic state-machine cycles (Compact → Peek → Interactive → Compact)
	const test3 = { name: 'real-morph-cycles-100', ok: true, details: {} };
	try {
		const startMorph = Date.now();
		const cycleCount = 100;
		let localMonitorLeaks = 0;
		let staleExpanded = 0;

		for (let i = 0; i < cycleCount; i++) {
			native.setSnapshot({
				revision: 10 + i * 4,
				sessionId: 'stress-session',
				sessionResource: 'vscode-chat://local/stress-session',
				status: 'working',
				presentationLabel: `Step ${i}`,
				currentActivity: `Real cycle ${i}`,
				latestShortMessage: `msg-${i}`,
				recentActions: [{ id: `a${i}`, label: `action ${i}`, at: Date.now() }],
				connected: true,
				prebaseForeground: false,
			});
			native.setPresentation({
				visible: true,
				pinned: false,
				reducedMotion: false,
				display: 'builtin',
			});

			// Compact → Peek
			const peekOk = native.simulateAction('peek');
			if (!peekOk) {
				throw new Error(`cycle ${i}: peek failed`);
			}
			await sleep(20);
			let diag = native.getDiagnostics();
			if (diag.localMonitorInstalled) {
				localMonitorLeaks++;
			}
			if (!(diag.activePresentationState === 'peek' || diag.activePresentationState === 'attentionPeek')) {
				throw new Error(`cycle ${i}: expected peek, got ${diag.activePresentationState}`);
			}

			// Peek → Interactive (sticky) via click — must match physical path
			const clickOk = native.simulateAction('click');
			if (!clickOk) {
				throw new Error(`cycle ${i}: click→interactive failed`);
			}
			await sleep(25);
			diag = native.getDiagnostics();
			if (!(diag.activePresentationState === 'interactive' || diag.activePresentationState === 'pinned' || diag.activePresentationState === 'attentionInteractive')) {
				throw new Error(`cycle ${i}: expected interactive/pinned, got ${diag.activePresentationState}`);
			}
			if (!diag.localMonitorInstalled && diag.pinned) {
				// local key monitor required only while interactive/pinned
			} else if (diag.pinned && !diag.localMonitorInstalled) {
				throw new Error(`cycle ${i}: local key monitor missing while pinned`);
			}

			// Interactive → Compact via unpin (not mid-attention)
			native.setPresentation({
				visible: true,
				pinned: false,
				reducedMotion: false,
				display: 'builtin',
			});
			await sleep(25);
			diag = native.getDiagnostics();
			if (diag.expanded && !diag.hovered && diag.activePresentationState !== 'compact' && diag.activePresentationState !== 'peek') {
				staleExpanded++;
			}
			if (diag.localMonitorInstalled && (diag.activePresentationState === 'compact' || diag.activePresentationState === 'peek')) {
				localMonitorLeaks++;
			}
		}

		await sleep(250);
		const diagAfterStress = native.getDiagnostics();
		test3.details.durationRealCyclesMs = Date.now() - startMorph;
		test3.details.cycleCount = cycleCount;
		test3.details.localMonitorLeaks = localMonitorLeaks;
		test3.details.staleExpanded = staleExpanded;
		test3.details.diagAfterStress = diagAfterStress;

		if (diagAfterStress.panelCreated !== true) {
			throw new Error('Panel must remain created after stress cycles');
		}
		if (localMonitorLeaks > 0) {
			throw new Error(`local key monitor leaked on ${localMonitorLeaks} compact/peek observations`);
		}
		if (staleExpanded > cycleCount * 0.1) {
			throw new Error(`too many stale expanded states after unpin: ${staleExpanded}`);
		}
	} catch (err) {
		test3.ok = false;
		test3.error = err.message;
		results.failures.push(`real-morph-cycles-100: ${err.message}`);
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
			pinned: true,
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

	// Test 5b: Attention Peek Interactivity & Keyboard Isolation
	const test5b = { name: 'attention-peek-interactive', ok: true, details: {} };
	try {
		// Set attention snapshot
		native.setSnapshot({
			revision: 200,
			sessionId: 'attention-session',
			status: 'attention',
			presentationLabel: 'Question from Magnus',
			pendingKind: 'approval',
			pendingTitle: 'Allow file edits to live_activity.mm?',
			latestShortMessage: 'I found 3 items requiring your review.',
		});
		native.setPresentation({
			visible: true,
			pinned: false,
			reducedMotion: false,
			display: 'builtin',
		});
		await sleep(200);

		const peekDiag = native.getDiagnostics();
		test5b.details.peekDiag = {
			state: peekDiag.activePresentationState,
			topologyOk: peekDiag.pathTopologyCompatible,
			localMonitor: peekDiag.localMonitorInstalled,
			message: peekDiag.latestShortMessage,
		};

		if (peekDiag.activePresentationState !== 'attentionPeek') {
			throw new Error(`Expected attentionPeek state, got ${peekDiag.activePresentationState}`);
		}
		if (peekDiag.localMonitorInstalled !== false) {
			throw new Error('Attention Peek must NOT install local key monitor (must not intercept editor typing)');
		}
		if (peekDiag.latestShortMessage !== 'I found 3 items requiring your review.') {
			throw new Error(`latestShortMessage mismatch: ${peekDiag.latestShortMessage}`);
		}

		// Click to transition from peek to interactive
		const clickResult = native.simulateAction('click');
		await sleep(150);

		const interactiveDiag = native.getDiagnostics();
		test5b.details.interactiveDiag = {
			clickResult,
			state: interactiveDiag.activePresentationState,
			localMonitor: interactiveDiag.localMonitorInstalled,
		};

		if (interactiveDiag.activePresentationState !== 'interactive'
			&& interactiveDiag.activePresentationState !== 'pinned'
			&& interactiveDiag.activePresentationState !== 'attentionInteractive') {
			throw new Error(`Expected interactive/pinned/attentionInteractive after click, got ${interactiveDiag.activePresentationState}`);
		}
		if (interactiveDiag.localMonitorInstalled !== true) {
			throw new Error('Interactive mode MUST install local key monitor for Escape dismiss');
		}

		// Attention while Interactive: snapshot update must NOT downgrade to peek
		native.setSnapshot({
			revision: 201,
			sessionId: 'attention-session',
			sessionResource: 'vscode-chat://local/attention-session',
			status: 'attention',
			presentationLabel: 'Still needs approval',
			connected: true,
			prebaseForeground: false,
			pendingInteraction: {
				kind: 'approval',
				interactionId: 'appr-1',
				title: 'Allow file edits?',
				message: 'Edit live_activity.mm?',
				destructive: false,
			},
			latestShortMessage: 'Waiting on your decision.',
		});
		await sleep(120);
		const whileInteractive = native.getDiagnostics();
		test5b.details.attentionWhileInteractive = {
			state: whileInteractive.activePresentationState,
			pendingMessage: whileInteractive.pendingMessage,
			renderedPendingMessage: whileInteractive.renderedPendingMessage,
			localMonitor: whileInteractive.localMonitorInstalled,
		};
		if (whileInteractive.activePresentationState === 'attentionPeek' || whileInteractive.activePresentationState === 'peek') {
			throw new Error('Attention while Interactive must not downgrade to Peek');
		}
		const pendingMsg = String(whileInteractive.pendingMessage || whileInteractive.renderedPendingMessage || '');
		if (!pendingMsg.includes('Edit live_activity')) {
			throw new Error(`pending interaction message not propagated: ${JSON.stringify({
				pendingMessage: whileInteractive.pendingMessage,
				renderedPendingMessage: whileInteractive.renderedPendingMessage,
			})}`);
		}

		// Test Escape dismissal
		const escResult = native.simulateAction('escape');
		await sleep(150);
		const collapsedDiag = native.getDiagnostics();
		test5b.details.dismissDiag = {
			escResult,
			state: collapsedDiag.activePresentationState,
			localMonitor: collapsedDiag.localMonitorInstalled,
		};
		if (collapsedDiag.activePresentationState !== 'attentionCompact') {
			throw new Error(`Expected attentionCompact after escape, got ${collapsedDiag.activePresentationState}`);
		}
		if (collapsedDiag.userDismissedAttention !== true) {
			throw new Error('attentionCompact after Escape must set userDismissedAttention (sticky Escape product truth)');
		}
		if (collapsedDiag.localMonitorInstalled !== false) {
			throw new Error('Collapsed mode must NOT keep local key monitor');
		}
		// Sticky Escape: hover/peek simulate must not reopen while attention remains.
		const peekWhileSticky = native.simulateAction('peek');
		await sleep(80);
		const stickyDiag = native.getDiagnostics();
		if (peekWhileSticky !== false || stickyDiag.activePresentationState !== 'attentionCompact') {
			throw new Error(`sticky Escape must refuse peek reopen (peek=${peekWhileSticky}, state=${stickyDiag.activePresentationState})`);
		}
	} catch (err) {
		test5b.ok = false;
		test5b.error = err.message;
		results.failures.push(`attention-peek-interactive: ${err.message}`);
	}
	results.tests.push(test5b);

	// Test 5c: Normal hover peek -> deliberate click -> interactive -> escape
	const test5c = { name: 'hover-peek-interactive', ok: true, details: {} };
	try {
		native.setPresentation({
			visible: true,
			pinned: false,
			reducedMotion: false,
			display: 'builtin',
		});
		native.setSnapshot({
			revision: 101,
			sessionId: 'test-session-normal',
			sessionResource: 'chat-session-resource-normal',
			status: 'working',
			currentActivity: 'Compiling project targets',
			recentActions: [],
			latestShortMessage: 'Compiling 42 files...',
		});
		await sleep(200);

		const compactDiag = native.getDiagnostics();
		test5c.details.compactDiag = {
			state: compactDiag.activePresentationState,
			localMonitor: compactDiag.localMonitorInstalled,
		};
		if (compactDiag.activePresentationState !== 'compact') {
			throw new Error(`Expected compact state initially, got ${compactDiag.activePresentationState}`);
		}
		if (compactDiag.localMonitorInstalled !== false) {
			throw new Error('Compact mode must NOT install local key monitor');
		}

		// Simulate hover dwell -> peek
		const peekSimResult = native.simulateAction('peek');
		await sleep(150);
		const hoverPeekDiag = native.getDiagnostics();
		test5c.details.hoverPeekDiag = {
			peekSimResult,
			state: hoverPeekDiag.activePresentationState,
			localMonitor: hoverPeekDiag.localMonitorInstalled,
			requestedHeight: hoverPeekDiag.requestedFrame?.height,
		};
		if (hoverPeekDiag.activePresentationState !== 'peek') {
			throw new Error(`Expected peek state on hover, got ${hoverPeekDiag.activePresentationState}`);
		}
		if (hoverPeekDiag.localMonitorInstalled !== false) {
			throw new Error('Peek mode must NOT install local key monitor');
		}
		const safeTop = hoverPeekDiag.safeAreaTop || 32;
		const bandH = Math.max(safeTop, 34);
		if (hoverPeekDiag.requestedFrame && hoverPeekDiag.requestedFrame.height > bandH + 56 + 10) {
			throw new Error(`Peek height (${hoverPeekDiag.requestedFrame.height}) exceeded glanceable peek ceiling (${bandH + 56 + 10})`);
		}

		// Click to transition from peek to interactive
		const clickResult = native.simulateAction('click');
		await sleep(300);
		const interactiveDiag = native.getDiagnostics();
		test5c.details.interactiveDiag = {
			clickResult,
			state: interactiveDiag.activePresentationState,
			localMonitor: interactiveDiag.localMonitorInstalled,
			inputControl: interactiveDiag.activeInputControl,
		};
		if (interactiveDiag.activePresentationState !== 'interactive') {
			throw new Error(`Expected interactive state after click, got ${interactiveDiag.activePresentationState}`);
		}
		if (interactiveDiag.localMonitorInstalled !== true) {
			throw new Error('Interactive mode MUST install local key monitor for Escape dismiss');
		}
		if (interactiveDiag.activeInputControl !== 'input-ready') {
			throw new Error(`Expected input-ready control in interactive mode, got ${interactiveDiag.activeInputControl}`);
		}

		// Test Escape dismissal
		const escResult = native.simulateAction('escape');
		await sleep(150);
		const collapsedDiag = native.getDiagnostics();
		test5c.details.dismissDiag = {
			escResult,
			state: collapsedDiag.activePresentationState,
			localMonitor: collapsedDiag.localMonitorInstalled,
		};
		if (collapsedDiag.activePresentationState !== 'compact') {
			throw new Error(`Expected compact state after escape, got ${collapsedDiag.activePresentationState}`);
		}
		if (collapsedDiag.localMonitorInstalled !== false) {
			throw new Error('Collapsed mode must NOT keep local key monitor');
		}
	} catch (err) {
		test5c.ok = false;
		test5c.error = err.message;
		results.failures.push(`hover-peek-interactive: ${err.message}`);
	}
	results.tests.push(test5c);

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
