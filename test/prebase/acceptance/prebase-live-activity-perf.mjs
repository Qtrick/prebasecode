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

async function drainMain(native, iterations = 4) {
	for (let i = 0; i < iterations; i++) {
		// getDiagnostics pumps CFRunLoop when on the main thread.
		native.getDiagnostics();
		await new Promise(r => setImmediate(r));
	}
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

function captureFrame(diag) {
	const preferred = diag?.requestedFrame;
	const fallback = diag?.panelFrame;
	const hasPreferred = preferred
		&& Number(preferred.width) > 0
		&& Number(preferred.height) > 0;
	const frame = hasPreferred ? preferred : fallback;
	if (!frame) {
		return null;
	}
	return {
		x: Number(frame.x) || 0,
		y: Number(frame.y) || 0,
		width: Number(frame.width) || 0,
		height: Number(frame.height) || 0,
	};
}

function framesEqualWithin(a, b, tol = 1) {
	if (!a || !b) {
		return a === b;
	}
	return Math.abs(a.x - b.x) <= tol
		&& Math.abs(a.y - b.y) <= tol
		&& Math.abs(a.width - b.width) <= tol
		&& Math.abs(a.height - b.height) <= tol;
}

function captureStabilityBaseline(diag) {
	return {
		animationCount: Number(diag.animationCount) || 0,
		transitionGeneration: Number(diag.transitionGeneration) || 0,
		transitionInFlight: !!diag.transitionInFlight,
		redrawCount: Number(diag.redrawCount) || 0,
		activePresentationState: diag.activePresentationState,
		targetPresentationState: diag.targetPresentationState,
		frame: captureFrame(diag),
		geometryTransitionCount: typeof diag.geometryTransitionCount === 'number' ? diag.geometryTransitionCount : undefined,
		contentOnlyUpdateCount: typeof diag.contentOnlyUpdateCount === 'number' ? diag.contentOnlyUpdateCount : undefined,
		contentRefreshCount: typeof diag.contentRefreshCount === 'number' ? diag.contentRefreshCount : undefined,
		orderFrontCount: typeof diag.orderFrontCount === 'number' ? diag.orderFrontCount : undefined,
		lastRenderedRevision: typeof diag.lastRenderedRevision === 'number' ? diag.lastRenderedRevision : undefined,
		revision: typeof diag.revision === 'number' ? diag.revision : undefined,
		lastTransitionReason: diag.lastTransitionReason,
	};
}

function contentSnapshot(revision, extras = {}) {
	const status = extras.status || 'working';
	const snap = {
		revision,
		sessionId: extras.sessionId || 'content-stability-session',
		sessionResource: extras.sessionResource || 'vscode-chat://local/content-stability',
		status,
		presentationLabel: extras.presentationLabel ?? `Label ${revision}`,
		currentActivity: extras.currentActivity ?? `Activity ${revision}`,
		latestShortMessage: extras.latestShortMessage ?? `msg-${revision}`,
		connected: true,
		prebaseForeground: false,
		workspaceDiff: extras.workspaceDiff || {
			additions: revision % 50,
			deletions: (revision + 3) % 40,
			files: (revision % 7) + 1,
		},
	};
	if (extras.pendingInteraction) {
		snap.pendingInteraction = extras.pendingInteraction;
	}
	if (extras.pendingKind) {
		snap.pendingKind = extras.pendingKind;
	}
	if (extras.pendingTitle) {
		snap.pendingTitle = extras.pendingTitle;
	}
	if (extras.interactionId) {
		snap.interactionId = extras.interactionId;
	}
	if (typeof extras.userDismissedAttention === 'boolean') {
		snap.userDismissedAttention = extras.userDismissedAttention;
	}
	return snap;
}

async function applyContentStorm(native, {
	startRevision,
	count,
	batchSize = 25,
	status = 'working',
	sessionId,
	pendingInteraction,
	labelPrefix = 'Label',
} = {}) {
	let revision = startRevision;
	const lastApplied = { revision: startRevision - 1, label: null, message: null };
	for (let i = 0; i < count; i++) {
		revision = startRevision + i;
		const label = `${labelPrefix} ${revision}`;
		const message = `msg-${revision}`;
		native.setSnapshot(contentSnapshot(revision, {
			status,
			sessionId,
			presentationLabel: label,
			currentActivity: `Activity ${revision}`,
			latestShortMessage: message,
			pendingInteraction,
			workspaceDiff: {
				additions: revision % 50,
				deletions: (revision + 3) % 40,
				files: (revision % 7) + 1,
			},
		}));
		lastApplied.revision = revision;
		lastApplied.label = label;
		lastApplied.message = message;
		if ((i + 1) % batchSize === 0) {
			await drainMain(native, 1);
		}
	}
	await drainMain(native, 3);
	return lastApplied;
}

function assertContentOnlyStable(diag, baseline, {
	expectedState,
	expectedTarget,
	lastApplied,
	allowRedrawGrowth = true,
} = {}) {
	if (diag.activePresentationState !== expectedState) {
		throw new Error(`expected activePresentationState=${expectedState}, got ${diag.activePresentationState}`);
	}
	if (diag.targetPresentationState !== expectedTarget) {
		throw new Error(`expected targetPresentationState=${expectedTarget}, got ${diag.targetPresentationState}`);
	}
	if (diag.transitionInFlight !== false) {
		throw new Error('transitionInFlight must be false after content-only settle');
	}
	if ((Number(diag.animationCount) || 0) !== baseline.animationCount) {
		throw new Error(`content-only updates must not increase animationCount (baseline=${baseline.animationCount}, after=${diag.animationCount})`);
	}
	if ((Number(diag.transitionGeneration) || 0) !== baseline.transitionGeneration) {
		throw new Error(`content-only updates must not increase transitionGeneration (baseline=${baseline.transitionGeneration}, after=${diag.transitionGeneration})`);
	}
	const afterFrame = captureFrame(diag);
	if (!framesEqualWithin(baseline.frame, afterFrame, 1)) {
		throw new Error(`panel/requested frame drifted after content-only updates: baseline=${JSON.stringify(baseline.frame)} after=${JSON.stringify(afterFrame)}`);
	}
	if (typeof baseline.geometryTransitionCount === 'number'
		&& typeof diag.geometryTransitionCount === 'number'
		&& diag.geometryTransitionCount !== baseline.geometryTransitionCount) {
		throw new Error(`geometryTransitionCount must not rise for content-only updates (${baseline.geometryTransitionCount} → ${diag.geometryTransitionCount})`);
	}
	if (typeof baseline.orderFrontCount === 'number'
		&& typeof diag.orderFrontCount === 'number'
		&& diag.orderFrontCount !== baseline.orderFrontCount) {
		throw new Error(`orderFrontCount must not rise for content-only updates (${baseline.orderFrontCount} → ${diag.orderFrontCount})`);
	}
	if (typeof diag.contentOnlyUpdateCount === 'number' && lastApplied) {
		if (diag.contentOnlyUpdateCount < (baseline.contentOnlyUpdateCount || 0)) {
			throw new Error('contentOnlyUpdateCount must not decrease');
		}
	}
	if (typeof diag.contentRefreshCount === 'number' && lastApplied) {
		if (diag.contentRefreshCount < (baseline.contentRefreshCount || 0)) {
			throw new Error('contentRefreshCount must not decrease');
		}
	}
	if (lastApplied) {
		const renderedRevision = typeof diag.lastRenderedRevision === 'number'
			? diag.lastRenderedRevision
			: (typeof diag.revision === 'number' ? diag.revision : undefined);
		if (typeof renderedRevision !== 'number') {
			throw new Error('diagnostics must expose lastRenderedRevision (or revision) for content-only assertions');
		}
		if (renderedRevision !== lastApplied.revision) {
			throw new Error(`rendered revision must equal last applied (${lastApplied.revision}), got ${renderedRevision}`);
		}
		if (diag.statusLabel && lastApplied.label && diag.statusLabel !== lastApplied.label) {
			throw new Error(`statusLabel not updated to latest content (expected ${lastApplied.label}, got ${diag.statusLabel})`);
		}
		if (diag.latestShortMessage && lastApplied.message && diag.latestShortMessage !== lastApplied.message) {
			throw new Error(`latestShortMessage not updated to latest content (expected ${lastApplied.message}, got ${diag.latestShortMessage})`);
		}
	}
	if (!allowRedrawGrowth && (Number(diag.redrawCount) || 0) !== baseline.redrawCount) {
		throw new Error(`unexpected redrawCount change (${baseline.redrawCount} → ${diag.redrawCount})`);
	}
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
		if (diagAfterStress.hapticCount !== 0) {
			throw new Error(`Expected zero haptics during click/morph stress cycles under hover-only policy, got ${diagAfterStress.hapticCount}`);
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
		native.dispose();
		// Seed pending question with canonical pendingInteraction schema
		native.setPresentation({
			visible: true,
			pinned: false,
			reducedMotion: false,
			display: 'builtin',
		});
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
		await sleep(80);

		const simResult = native.simulateAction('option', 1);
		test5.details.optionSimResult = simResult;
		if (simResult !== true) {
			throw new Error('simulateAction option 1 must succeed');
		}

		// Follow up simulation (click into interactive mode to make input available)
		native.simulateAction('click');
		const followUpSim = native.simulateAction('followUp', 'deploy with verbose logging');
		test5.details.followUpSim = followUpSim;
		if (followUpSim !== true) {
			throw new Error('simulateAction followUp must succeed');
		}
		native.setSnapshot({
			revision: 201,
			sessionId: 'question-session',
			status: 'idle',
			prebaseForeground: false,
		});
		native.simulateAction('escape');
		await sleep(50);
	} catch (err) {
		test5.ok = false;
		test5.error = err.message;
		results.failures.push(`user-simulation-actions: ${err.message}`);
	}
	results.tests.push(test5);

	// Test 5b: Attention Peek Interactivity & Keyboard Isolation
	const test5b = { name: 'attention-peek-interactive', ok: true, details: {} };
	try {
		native.dispose();
		// Presentation before snapshot — matches contribution flush order.
		native.setPresentation({
			visible: true,
			pinned: false,
			reducedMotion: false,
			display: 'builtin',
		});
		native.setSnapshot({
			revision: 200,
			sessionId: 'attention-session',
			status: 'attention',
			presentationLabel: 'Question from Magnus',
			pendingKind: 'approval',
			pendingTitle: 'Allow file edits to live_activity.mm?',
			latestShortMessage: 'I found 3 items requiring your review.',
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
		native.dispose();
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

	// Test 8: Click Peek to enter Interactive does NOT accidentally pin
	const test8 = { name: 'click-peek-not-accidentally-pinned', ok: true, details: {} };
	try {
		native.setPresentation({ visible: true, pinned: false, reducedMotion: false, display: 'builtin' });
		native.setSnapshot({
			revision: 201,
			sessionId: 'test-session-pin-coupling',
			status: 'working',
			currentActivity: 'Compiling project',
			prebaseForeground: false,
		});
		await sleep(50);
		// Enter peek
		const peekOk = native.simulateAction('peek');
		if (!peekOk) {
			throw new Error('Failed to simulate peek');
		}
		const diagPeek = native.getDiagnostics();
		test8.details.diagPeek = { state: diagPeek.activePresentationState, pinned: diagPeek.pinned };
		if (diagPeek.activePresentationState !== 'peek') {
			throw new Error(`Expected peek state, got ${diagPeek.activePresentationState}`);
		}
		// Click peek to enter interactive
		const clickOk = native.simulateAction('click');
		if (!clickOk) {
			throw new Error('Failed to simulate click on peek');
		}
		const diagInteractive = native.getDiagnostics();
		test8.details.diagInteractive = {
			state: diagInteractive.activePresentationState,
			pinned: diagInteractive.pinned,
			pinButtonVisible: diagInteractive.pinButtonVisible,
			pinButtonTitle: diagInteractive.pinButtonTitle,
		};
		if (diagInteractive.activePresentationState !== 'interactive') {
			throw new Error(`Expected interactive state after clicking peek, got ${diagInteractive.activePresentationState}`);
		}
		if (diagInteractive.pinned !== false) {
			throw new Error('REGRESSION: clicking Peek accidentally set pinned=true! Peek->Interactive must NOT pin.');
		}
		if (diagInteractive.pinButtonVisible !== true) {
			throw new Error('Expected explicit Pin affordance to be visible in Interactive mode');
		}
		if (diagInteractive.pinButtonTitle !== 'Pin') {
			throw new Error(`Expected Pin button title to be 'Pin', got '${diagInteractive.pinButtonTitle}'`);
		}
	} catch (err) {
		test8.ok = false;
		test8.error = err.message;
		results.failures.push(`click-peek-not-accidentally-pinned: ${err.message}`);
	}
	results.tests.push(test8);

	// Test 9: Explicit Pin affordance toggles pinned state deliberately
	const test9 = { name: 'explicit-pin-affordance-toggle', ok: true, details: {} };
	try {
		// Currently in interactive mode from Test 8. Click Pin button.
		const pinClick1 = native.simulateAction('pin');
		if (!pinClick1) {
			throw new Error('simulateAction(pin) returned false');
		}
		const diagPinned = native.getDiagnostics();
		test9.details.diagPinned = {
			state: diagPinned.activePresentationState,
			pinned: diagPinned.pinned,
			pinButtonTitle: diagPinned.pinButtonTitle,
		};
		if (diagPinned.pinned !== true) {
			throw new Error('Expected pinned=true after clicking Pin button');
		}
		if (diagPinned.pinButtonTitle !== 'Unpin') {
			throw new Error(`Expected Pin button title 'Unpin' when pinned, got '${diagPinned.pinButtonTitle}'`);
		}

		// Click Pin button again to unpin
		const pinClick2 = native.simulateAction('pin');
		if (!pinClick2) {
			throw new Error('simulateAction(pin) second toggle returned false');
		}
		const diagUnpinned = native.getDiagnostics();
		test9.details.diagUnpinned = {
			state: diagUnpinned.activePresentationState,
			pinned: diagUnpinned.pinned,
			pinButtonTitle: diagUnpinned.pinButtonTitle,
		};
		if (diagUnpinned.pinned !== false) {
			throw new Error('Expected pinned=false after second Pin button click');
		}
		if (diagUnpinned.pinButtonTitle !== 'Pin') {
			throw new Error(`Expected Pin button title 'Pin' after unpinning, got '${diagUnpinned.pinButtonTitle}'`);
		}
	} catch (err) {
		test9.ok = false;
		test9.error = err.message;
		results.failures.push(`explicit-pin-affordance-toggle: ${err.message}`);
	}
	results.tests.push(test9);

	// Test 10: Escape dismisses Interactive and unpins if pinned
	const test10 = { name: 'escape-dismiss-and-unpin', ok: true, details: {} };
	try {
		// Re-pin
		native.simulateAction('pin');
		const diagBeforeEsc = native.getDiagnostics();
		if (diagBeforeEsc.pinned !== true) {
			throw new Error('Failed to setup pinned state for escape test');
		}
		// Escape
		const escOk = native.simulateAction('escape');
		if (!escOk) {
			throw new Error('simulateAction(escape) failed');
		}
		const diagAfterEsc = native.getDiagnostics();
		test10.details.diagAfterEsc = {
			state: diagAfterEsc.activePresentationState,
			pinned: diagAfterEsc.pinned,
			expanded: diagAfterEsc.expanded,
		};
		if (diagAfterEsc.pinned !== false) {
			throw new Error('Expected pinned=false after Escape');
		}
		if (diagAfterEsc.expanded !== false) {
			throw new Error('Expected expanded=false after Escape');
		}
		if (diagAfterEsc.activePresentationState !== 'compact') {
			throw new Error(`Expected compact state after Escape, got ${diagAfterEsc.activePresentationState}`);
		}
	} catch (err) {
		test10.ok = false;
		test10.error = err.message;
		results.failures.push(`escape-dismiss-and-unpin: ${err.message}`);
	}
	results.tests.push(test10);

	// Test 11: Screen-locked safety (status-only, refuses expansion, commands rejected)
	const test11 = { name: 'screen-locked-safety', ok: true, details: {} };
	try {
		native.setSnapshot({
			revision: 301,
			sessionId: 'test-locked-session',
			status: 'working',
			currentActivity: 'Sensitive activity text',
			latestShortMessage: 'Sensitive secret message',
			screenLocked: true,
			prebaseForeground: false,
		});
		await sleep(50);
		const diagLocked = native.getDiagnostics();
		test11.details.diagLocked = {
			state: diagLocked.activePresentationState,
			statusLabel: diagLocked.statusLabel,
			activityLabel: diagLocked.activityLabel,
			latestShortMessage: diagLocked.latestShortMessage,
			expanded: diagLocked.expanded,
		};
		if (diagLocked.expanded !== false) {
			throw new Error('Expected expanded=false when screenLocked=true');
		}
		if (diagLocked.statusLabel !== 'Magnus') {
			throw new Error(`Expected status-safe label 'Magnus' when locked, got '${diagLocked.statusLabel}'`);
		}
		if (diagLocked.activityLabel !== '') {
			throw new Error(`Expected blank activityLabel when locked, got '${diagLocked.activityLabel}'`);
		}
		if (diagLocked.latestShortMessage !== '') {
			throw new Error(`Expected blank latestShortMessage when locked, got '${diagLocked.latestShortMessage}'`);
		}

		// Attempt hover peek while locked — must be rejected / remain compact
		native.simulateAction('peek');
		const diagAfterPeek = native.getDiagnostics();
		if (diagAfterPeek.expanded !== false) {
			throw new Error('REGRESSION: screen-locked notch expanded on peek!');
		}

		// Attempt click while locked — must be rejected
		const clickResult = native.simulateAction('click');
		if (clickResult !== false) {
			throw new Error('Expected simulateAction(click) to return false while screen is locked');
		}
		const diagAfterClick = native.getDiagnostics();
		if (diagAfterClick.expanded !== false) {
			throw new Error('REGRESSION: screen-locked notch expanded on click!');
		}

		// Attempt pin while locked — must be rejected
		const pinResult = native.simulateAction('pin');
		if (pinResult !== false) {
			throw new Error('Expected simulateAction(pin) to return false while screen is locked');
		}
	} catch (err) {
		test11.ok = false;
		test11.error = err.message;
		results.failures.push(`screen-locked-safety: ${err.message}`);
	}
	results.tests.push(test11);

	// -------------------------------------------------------------------------
	// Content-update stability / notch flicker regressions (TDD against native fix)
	// -------------------------------------------------------------------------

	// Test 12: content-only snapshots must not morph / retarget presentation
	const test12 = { name: 'content-update-stability', ok: true, details: {} };
	try {
		native.dispose();
		native.setSnapshot(contentSnapshot(1000, {
			presentationLabel: 'Baseline compact',
			currentActivity: 'Settling',
			latestShortMessage: 'ready',
		}));
		native.setPresentation({
			visible: true,
			pinned: false,
			reducedMotion: false,
			display: 'builtin',
		});
		await sleep(120);
		await drainMain(native, 4);

		const baselineDiag = native.getDiagnostics();
		const baseline = captureStabilityBaseline(baselineDiag);
		test12.details.baseline = {
			...baseline,
			statusLabel: baselineDiag.statusLabel,
			metricsLabel: baselineDiag.metricsLabel,
		};

		if (baseline.activePresentationState !== 'compact') {
			throw new Error(`setup expected compact, got ${baseline.activePresentationState}`);
		}
		if (baseline.targetPresentationState !== 'compact') {
			throw new Error(`setup expected target compact, got ${baseline.targetPresentationState}`);
		}

		const storm1 = await applyContentStorm(native, {
			startRevision: 1001,
			count: 100,
			batchSize: 20,
			labelPrefix: 'StormA',
		});
		// Sample mid-storm: content-only must not need an in-flight geometry transition.
		const midStormSample = native.getDiagnostics();
		test12.details.midStormSample = {
			transitionInFlight: midStormSample.transitionInFlight,
			animationCount: midStormSample.animationCount,
			transitionGeneration: midStormSample.transitionGeneration,
		};
		if (midStormSample.transitionInFlight === true) {
			throw new Error('content-only updates must not require transitionInFlight=true');
		}
		await sleep(80);
		await drainMain(native, 4);

		const midDiag = native.getDiagnostics();
		test12.details.afterFirstStorm = {
			animationCount: midDiag.animationCount,
			transitionGeneration: midDiag.transitionGeneration,
			transitionInFlight: midDiag.transitionInFlight,
			activePresentationState: midDiag.activePresentationState,
			targetPresentationState: midDiag.targetPresentationState,
			frame: captureFrame(midDiag),
			lastRenderedRevision: midDiag.lastRenderedRevision,
			revision: midDiag.revision,
			geometryTransitionCount: midDiag.geometryTransitionCount,
			contentOnlyUpdateCount: midDiag.contentOnlyUpdateCount,
			contentRefreshCount: midDiag.contentRefreshCount,
			statusLabel: midDiag.statusLabel,
			latestShortMessage: midDiag.latestShortMessage,
			metricsLabel: midDiag.metricsLabel,
			lastApplied: storm1,
		};
		assertContentOnlyStable(midDiag, baseline, {
			expectedState: 'compact',
			expectedTarget: 'compact',
			lastApplied: storm1,
		});

		const midBaseline = captureStabilityBaseline(midDiag);
		const storm2 = await applyContentStorm(native, {
			startRevision: storm1.revision + 1,
			count: 160,
			batchSize: 40,
			labelPrefix: 'StormB',
		});
		await sleep(80);
		await drainMain(native, 4);

		const afterDiag = native.getDiagnostics();
		test12.details.afterHighFrequencyStorm = {
			animationCount: afterDiag.animationCount,
			transitionGeneration: afterDiag.transitionGeneration,
			transitionInFlight: afterDiag.transitionInFlight,
			activePresentationState: afterDiag.activePresentationState,
			targetPresentationState: afterDiag.targetPresentationState,
			frame: captureFrame(afterDiag),
			lastRenderedRevision: afterDiag.lastRenderedRevision,
			revision: afterDiag.revision,
			geometryTransitionCount: afterDiag.geometryTransitionCount,
			contentOnlyUpdateCount: afterDiag.contentOnlyUpdateCount,
			contentRefreshCount: afterDiag.contentRefreshCount,
			statusLabel: afterDiag.statusLabel,
			latestShortMessage: afterDiag.latestShortMessage,
			metricsLabel: afterDiag.metricsLabel,
			lastApplied: storm2,
			redrawDelta: (Number(afterDiag.redrawCount) || 0) - baseline.redrawCount,
		};
		assertContentOnlyStable(afterDiag, midBaseline, {
			expectedState: 'compact',
			expectedTarget: 'compact',
			lastApplied: storm2,
		});
		assertContentOnlyStable(afterDiag, baseline, {
			expectedState: 'compact',
			expectedTarget: 'compact',
			lastApplied: storm2,
		});

		if (typeof afterDiag.lastTransitionReason === 'string'
			&& /content|refresh|text|metrics/i.test(afterDiag.lastTransitionReason)
			&& /geometry|morph|presentation|expand|collapse/i.test(afterDiag.lastTransitionReason)) {
			throw new Error(`lastTransitionReason must not claim geometry morph for content-only: ${afterDiag.lastTransitionReason}`);
		}
	} catch (err) {
		test12.ok = false;
		test12.error = err.message;
		results.failures.push(`content-update-stability: ${err.message}`);
	}
	results.tests.push(test12);

	// Test 12b: content updates DURING an in-flight peek morph must not cancel/snap geometry
	const test12b = { name: 'content-during-morph', ok: true, details: {} };
	try {
		native.dispose();
		native.setSnapshot(contentSnapshot(1500, {
			presentationLabel: 'Morph baseline',
			currentActivity: 'Settling',
		}));
		native.setPresentation({
			visible: true,
			pinned: false,
			reducedMotion: false,
			display: 'builtin',
		});
		await sleep(80);
		await drainMain(native, 3);

		const beforePeek = captureStabilityBaseline(native.getDiagnostics());
		if (beforePeek.activePresentationState !== 'compact') {
			throw new Error(`expected compact before morph, got ${beforePeek.activePresentationState}`);
		}

		const peekOk = native.simulateAction('peek');
		if (!peekOk) {
			throw new Error('simulateAction(peek) failed to start morph');
		}
		// Do NOT wait for morph to finish — content must arrive mid-transition.
		await drainMain(native, 1);
		const midMorphBefore = native.getDiagnostics();
		test12b.details.midMorphBefore = captureStabilityBaseline(midMorphBefore);
		if (midMorphBefore.transitionInFlight !== true
			&& !((Number(midMorphBefore.animationCount) || 0) > (beforePeek.animationCount || 0))) {
			throw new Error('expected peek morph to be in flight (transitionInFlight or animationCount bump) before content storm');
		}

		// Immediate content snapshots (minimal drain) while morph should still be active.
		const contentStart = Number(midMorphBefore.contentOnlyUpdateCount) || 0;
		let sawInFlightDuringContent = midMorphBefore.transitionInFlight === true;
		for (let i = 0; i < 12; i++) {
			native.setSnapshot(contentSnapshot(1501 + i, {
				presentationLabel: `DuringMorph ${1501 + i}`,
				latestShortMessage: `msg-${1501 + i}`,
			}));
			if (i === 0 || i === 5) {
				const inFlightSample = native.getDiagnostics();
				if (inFlightSample.transitionInFlight === true) {
					sawInFlightDuringContent = true;
				}
				await drainMain(native, 1);
			}
		}
		test12b.details.sawInFlightDuringContent = sawInFlightDuringContent;
		await drainMain(native, 2);
		const midMorphAfter = native.getDiagnostics();
		test12b.details.midMorphAfter = {
			...captureStabilityBaseline(midMorphAfter),
			lastAppliedRevision: 1512,
		};

		const animDelta = (Number(midMorphAfter.animationCount) || 0) - (Number(midMorphBefore.animationCount) || 0);
		const geoDelta = (Number(midMorphAfter.geometryTransitionCount) || 0) - (Number(midMorphBefore.geometryTransitionCount) || 0);
		const genDelta = (Number(midMorphAfter.transitionGeneration) || 0) - (Number(midMorphBefore.transitionGeneration) || 0);
		const contentDelta = (Number(midMorphAfter.contentOnlyUpdateCount) || 0) - contentStart;

		if (contentDelta < 1) {
			throw new Error(`content-during-morph expected contentOnlyUpdateCount to rise, delta=${contentDelta}`);
		}
		if (animDelta !== 0) {
			throw new Error(`content-during-morph must not increase animationCount (delta=${animDelta})`);
		}
		if (geoDelta !== 0) {
			throw new Error(`content-during-morph must not increase geometryTransitionCount (delta=${geoDelta})`);
		}
		if (genDelta !== 0) {
			throw new Error(`content-during-morph must not bump transitionGeneration (delta=${genDelta})`);
		}
		// Content must not start a new geometry morph. Natural morph completion via
		// transitionEndTime is allowed; a content-driven generation bump is not (checked above).

		// Let morph settle, then verify final peek.
		await sleep(220);
		await drainMain(native, 4);
		const settled = native.getDiagnostics();
		test12b.details.settled = captureStabilityBaseline(settled);
		if (settled.activePresentationState !== 'peek') {
			throw new Error(`after content-during-morph expected peek, got ${settled.activePresentationState}`);
		}
		if (settled.peekOnly !== undefined && settled.peekOnly !== true) {
			throw new Error(`peekOnly must remain true, got ${settled.peekOnly}`);
		}

		// Interactive morph + immediate content storm
		if (!native.simulateAction('click')) {
			throw new Error('click→interactive failed');
		}
		await drainMain(native, 1);
		const interactiveMid = native.getDiagnostics();
		const interactiveStorm = await applyContentStorm(native, {
			startRevision: 1600,
			count: 30,
			batchSize: 10,
			labelPrefix: 'InteractiveMorph',
		});
		const interactiveAfter = native.getDiagnostics();
		test12b.details.interactiveDuring = {
			before: captureStabilityBaseline(interactiveMid),
			after: captureStabilityBaseline(interactiveAfter),
			lastApplied: interactiveStorm,
		};
		const iAnim = (Number(interactiveAfter.animationCount) || 0) - (Number(interactiveMid.animationCount) || 0);
		const iGeo = (Number(interactiveAfter.geometryTransitionCount) || 0) - (Number(interactiveMid.geometryTransitionCount) || 0);
		const iGen = (Number(interactiveAfter.transitionGeneration) || 0) - (Number(interactiveMid.transitionGeneration) || 0);
		const iContent = (Number(interactiveAfter.contentOnlyUpdateCount) || 0) - (Number(interactiveMid.contentOnlyUpdateCount) || 0);
		if (iContent < 1) {
			throw new Error(`interactive morph content storm expected contentOnlyUpdateCount rise, delta=${iContent}`);
		}
		if (iAnim !== 0 || iGeo !== 0 || iGen !== 0) {
			throw new Error(`interactive morph content storm must not bump anim/geo/gen (Δa=${iAnim} Δg=${iGeo} Δgen=${iGen})`);
		}
		await sleep(220);
		await drainMain(native, 4);
		const interactiveSettled = native.getDiagnostics();
		if (interactiveSettled.activePresentationState !== 'interactive') {
			throw new Error(`expected interactive after morph+content, got ${interactiveSettled.activePresentationState}`);
		}
		if (interactiveSettled.localMonitorInstalled !== true) {
			throw new Error('interactive must keep local key monitor after content-during-morph');
		}
	} catch (err) {
		test12b.ok = false;
		test12b.error = err.message;
		results.failures.push(`content-during-morph: ${err.message}`);
	}
	results.tests.push(test12b);

	// Test 13: content-only while Peek must remain peek / non-interactive
	const test13 = { name: 'content-only-in-peek', ok: true, details: {} };
	try {
		native.dispose();
		native.setSnapshot(contentSnapshot(2000));
		native.setPresentation({ visible: true, pinned: false, reducedMotion: false, display: 'builtin' });
		await sleep(100);
		const peekOk = native.simulateAction('peek');
		if (!peekOk) {
			throw new Error('simulateAction(peek) failed');
		}
		await sleep(120);
		await drainMain(native, 3);

		const baselineDiag = native.getDiagnostics();
		const baseline = captureStabilityBaseline(baselineDiag);
		test13.details.baseline = {
			state: baselineDiag.activePresentationState,
			expanded: baselineDiag.expanded,
			peekOnly: baselineDiag.peekOnly,
			localMonitorInstalled: baselineDiag.localMonitorInstalled,
			animationCount: baseline.animationCount,
			frame: baseline.frame,
		};
		if (baselineDiag.activePresentationState !== 'peek') {
			throw new Error(`expected peek before content storm, got ${baselineDiag.activePresentationState}`);
		}
		if (baselineDiag.localMonitorInstalled === true) {
			throw new Error('peek must not install local key monitor');
		}

		const storm = await applyContentStorm(native, {
			startRevision: 2001,
			count: 100,
			batchSize: 25,
			labelPrefix: 'PeekStorm',
		});
		await sleep(80);
		await drainMain(native, 4);
		const after = native.getDiagnostics();
		test13.details.after = {
			state: after.activePresentationState,
			target: after.targetPresentationState,
			expanded: after.expanded,
			peekOnly: after.peekOnly,
			localMonitorInstalled: after.localMonitorInstalled,
			animationCount: after.animationCount,
			transitionGeneration: after.transitionGeneration,
			frame: captureFrame(after),
			lastApplied: storm,
		};

		if (after.activePresentationState !== 'peek') {
			throw new Error(`content-only must remain peek, got ${after.activePresentationState}`);
		}
		if (after.targetPresentationState !== 'peek') {
			throw new Error(`target must remain peek, got ${after.targetPresentationState}`);
		}
		if (after.peekOnly !== undefined && after.peekOnly !== true) {
			throw new Error(`peekOnly must stay true for content-only peek updates, got ${after.peekOnly}`);
		}
		if (after.expanded !== true) {
			throw new Error('peek must stay expanded');
		}
		if (after.localMonitorInstalled === true) {
			throw new Error('content-only peek must remain non-interactive (no local monitor)');
		}
		assertContentOnlyStable(after, baseline, {
			expectedState: 'peek',
			expectedTarget: 'peek',
			lastApplied: storm,
		});
	} catch (err) {
		test13.ok = false;
		test13.error = err.message;
		results.failures.push(`content-only-in-peek: ${err.message}`);
	}
	results.tests.push(test13);

	// Test 14: content-only while Interactive must not replay entrance morph
	const test14 = { name: 'content-only-in-interactive', ok: true, details: {} };
	try {
		native.dispose();
		native.setSnapshot(contentSnapshot(3000));
		native.setPresentation({ visible: true, pinned: false, reducedMotion: false, display: 'builtin' });
		await sleep(100);
		if (!native.simulateAction('peek')) {
			throw new Error('peek failed');
		}
		await sleep(80);
		if (!native.simulateAction('click')) {
			throw new Error('click→interactive failed');
		}
		await sleep(180);
		await drainMain(native, 4);

		const baselineDiag = native.getDiagnostics();
		const baseline = captureStabilityBaseline(baselineDiag);
		test14.details.baseline = {
			state: baselineDiag.activePresentationState,
			animationCount: baseline.animationCount,
			localMonitorInstalled: baselineDiag.localMonitorInstalled,
			frame: baseline.frame,
		};
		if (baselineDiag.activePresentationState !== 'interactive') {
			throw new Error(`expected interactive before content storm, got ${baselineDiag.activePresentationState}`);
		}

		const storm = await applyContentStorm(native, {
			startRevision: 3001,
			count: 120,
			batchSize: 30,
			labelPrefix: 'InteractiveStorm',
		});
		await sleep(80);
		await drainMain(native, 4);
		const after = native.getDiagnostics();
		test14.details.after = {
			state: after.activePresentationState,
			animationCount: after.animationCount,
			transitionGeneration: after.transitionGeneration,
			frame: captureFrame(after),
			lastApplied: storm,
		};
		assertContentOnlyStable(after, baseline, {
			expectedState: 'interactive',
			expectedTarget: 'interactive',
			lastApplied: storm,
		});
	} catch (err) {
		test14.ok = false;
		test14.error = err.message;
		results.failures.push(`content-only-in-interactive: ${err.message}`);
	}
	results.tests.push(test14);

	// Test 15: content-only while pinned must not geometry-transition
	const test15 = { name: 'content-only-while-pinned', ok: true, details: {} };
	try {
		native.dispose();
		native.setSnapshot(contentSnapshot(4000));
		native.setPresentation({ visible: true, pinned: false, reducedMotion: false, display: 'builtin' });
		await sleep(80);
		native.simulateAction('peek');
		await sleep(60);
		native.simulateAction('click');
		await sleep(120);
		if (!native.simulateAction('pin')) {
			throw new Error('pin failed');
		}
		await sleep(150);
		await drainMain(native, 4);

		const baselineDiag = native.getDiagnostics();
		const baseline = captureStabilityBaseline(baselineDiag);
		test15.details.baseline = {
			state: baselineDiag.activePresentationState,
			pinned: baselineDiag.pinned,
			animationCount: baseline.animationCount,
			frame: baseline.frame,
		};
		if (baselineDiag.pinned !== true) {
			throw new Error('expected pinned=true before content storm');
		}
		if (!(baselineDiag.activePresentationState === 'pinned' || baselineDiag.activePresentationState === 'attentionInteractive')) {
			throw new Error(`expected pinned presentation, got ${baselineDiag.activePresentationState}`);
		}

		const expectedState = baselineDiag.activePresentationState;
		const storm = await applyContentStorm(native, {
			startRevision: 4001,
			count: 100,
			batchSize: 25,
			labelPrefix: 'PinnedStorm',
		});
		await sleep(80);
		await drainMain(native, 4);
		const after = native.getDiagnostics();
		test15.details.after = {
			state: after.activePresentationState,
			pinned: after.pinned,
			animationCount: after.animationCount,
			transitionGeneration: after.transitionGeneration,
			geometryTransitionCount: after.geometryTransitionCount,
			frame: captureFrame(after),
			lastApplied: storm,
		};
		if (after.pinned !== true) {
			throw new Error('content-only updates must keep pinned=true');
		}
		assertContentOnlyStable(after, baseline, {
			expectedState,
			expectedTarget: expectedState === 'pinned' ? 'pinned' : after.targetPresentationState,
			lastApplied: storm,
		});
		if (expectedState === 'pinned' && after.targetPresentationState !== 'pinned') {
			throw new Error(`target must remain pinned, got ${after.targetPresentationState}`);
		}
	} catch (err) {
		test15.ok = false;
		test15.error = err.message;
		results.failures.push(`content-only-while-pinned: ${err.message}`);
	}
	results.tests.push(test15);

	// Test 16: real presentation transitions must still animate (no global animation kill)
	const test16 = { name: 'presentation-transitions-still-animate', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: false, reducedMotion: false, display: 'builtin' });
		native.setSnapshot(contentSnapshot(5000, { status: 'working' }));
		await sleep(120);
		await drainMain(native, 3);

		let diag = native.getDiagnostics();
		const hasScreen = !!(diag.screenFrame && Number(diag.screenFrame.width) > 0);
		const anim0 = Number(diag.animationCount) || 0;
		const gen0 = Number(diag.transitionGeneration) || 0;
		test16.details.start = { animationCount: anim0, transitionGeneration: gen0, state: diag.activePresentationState, hasScreen };

		if (!native.simulateAction('peek')) {
			throw new Error('compact→peek failed');
		}
		await sleep(150);
		diag = native.getDiagnostics();
		const animAfterPeek = Number(diag.animationCount) || 0;
		const genAfterPeek = Number(diag.transitionGeneration) || 0;
		test16.details.afterPeek = { animationCount: animAfterPeek, transitionGeneration: genAfterPeek, state: diag.activePresentationState };
		if (diag.activePresentationState !== 'peek') {
			throw new Error(`expected peek, got ${diag.activePresentationState}`);
		}
		if (hasScreen && !(animAfterPeek > anim0 || genAfterPeek > gen0)) {
			throw new Error(`compact→peek must animate when screen geometry is available (anim ${anim0}→${animAfterPeek}, gen ${gen0}→${genAfterPeek})`);
		}

		if (!native.simulateAction('click')) {
			throw new Error('peek→interactive failed');
		}
		await sleep(180);
		diag = native.getDiagnostics();
		const animAfterInteractive = Number(diag.animationCount) || 0;
		const genAfterInteractive = Number(diag.transitionGeneration) || 0;
		test16.details.afterInteractive = {
			animationCount: animAfterInteractive,
			transitionGeneration: genAfterInteractive,
			state: diag.activePresentationState,
		};
		if (diag.activePresentationState !== 'interactive') {
			throw new Error(`expected interactive, got ${diag.activePresentationState}`);
		}
		if (hasScreen && !(animAfterInteractive > animAfterPeek || genAfterInteractive > genAfterPeek)) {
			throw new Error(`peek→interactive must animate when screen geometry is available (anim ${animAfterPeek}→${animAfterInteractive})`);
		}

		if (!native.simulateAction('escape')) {
			throw new Error('interactive→compact escape failed');
		}
		await sleep(180);
		diag = native.getDiagnostics();
		const animAfterCompact = Number(diag.animationCount) || 0;
		const genAfterCompact = Number(diag.transitionGeneration) || 0;
		test16.details.afterCompact = {
			animationCount: animAfterCompact,
			transitionGeneration: genAfterCompact,
			state: diag.activePresentationState,
		};
		if (diag.activePresentationState !== 'compact') {
			throw new Error(`expected compact after escape, got ${diag.activePresentationState}`);
		}
		if (hasScreen && !(animAfterCompact > animAfterInteractive || genAfterCompact > genAfterInteractive)) {
			throw new Error(`interactive→compact must animate when screen geometry is available (anim ${animAfterInteractive}→${animAfterCompact})`);
		}

		// Presentation-class attention arrival must still morph even when layoutForScreen
		// is a no-op (headless / missing NSScreen). This proves animation is not globally disabled.
		const animBeforeAttention = Number(diag.animationCount) || 0;
		native.setSnapshot(contentSnapshot(5100, {
			status: 'attention',
			presentationLabel: 'Needs approval',
			latestShortMessage: 'Please review',
			pendingInteraction: {
				kind: 'approval',
				interactionId: 'attn-anim-1',
				title: 'Allow edits?',
				message: 'Edit live_activity.mm?',
				destructive: false,
			},
		}));
		await sleep(200);
		await drainMain(native, 3);
		diag = native.getDiagnostics();
		const animAfterAttention = Number(diag.animationCount) || 0;
		test16.details.afterAttentionPeek = {
			animationCount: animAfterAttention,
			state: diag.activePresentationState,
		};
		if (diag.activePresentationState !== 'attentionPeek') {
			throw new Error(`expected attentionPeek, got ${diag.activePresentationState}`);
		}
		if (!(animAfterAttention > animBeforeAttention)) {
			throw new Error(`compact→attentionPeek must increase animationCount (${animBeforeAttention} → ${animAfterAttention}) — animation must remain enabled for real presentation changes`);
		}
	} catch (err) {
		test16.ok = false;
		test16.error = err.message;
		results.failures.push(`presentation-transitions-still-animate: ${err.message}`);
	}
	results.tests.push(test16);

	// Test 17: stale lower revisions must not rewind rendered content (TDD monotonic revision)
	const test17 = { name: 'snapshot-revision-ordering', ok: true, details: {} };
	try {
		native.dispose();
		native.setSnapshot(contentSnapshot(6000, {
			presentationLabel: 'rev-6000',
			latestShortMessage: 'base-6000',
		}));
		native.setPresentation({ visible: true, pinned: false, reducedMotion: false, display: 'builtin' });
		await sleep(100);

		const n = 40;
		for (let i = 1; i <= n; i++) {
			const rev = 6000 + i;
			native.setSnapshot(contentSnapshot(rev, {
				presentationLabel: `rev-${rev}`,
				currentActivity: `Activity ${rev}`,
				latestShortMessage: `msg-${rev}`,
			}));
			if (i % 10 === 0) {
				await drainMain(native, 1);
			}
		}
		// Out-of-order / stale lower revision after the high-water mark.
		native.setSnapshot(contentSnapshot(6010, {
			presentationLabel: 'STALE-6010',
			currentActivity: 'STALE activity',
			latestShortMessage: 'STALE message',
		}));
		await sleep(100);
		await drainMain(native, 4);

		const diag = native.getDiagnostics();
		const highWater = 6000 + n;
		const renderedRevision = typeof diag.lastRenderedRevision === 'number'
			? diag.lastRenderedRevision
			: (typeof diag.revision === 'number' ? diag.revision : undefined);
		test17.details = {
			highWater,
			renderedRevision,
			statusLabel: diag.statusLabel,
			latestShortMessage: diag.latestShortMessage,
			lastTransitionReason: diag.lastTransitionReason,
		};

		if (typeof renderedRevision === 'number') {
			if (renderedRevision < highWater) {
				throw new Error(`rendered revision went backwards (highWater=${highWater}, rendered=${renderedRevision})`);
			}
			if (renderedRevision === 6010) {
				throw new Error('stale revision 6010 must not become the rendered revision after higher revisions');
			}
		} else {
			// TODO(native): expose lastRenderedRevision in getDiagnostics.
			// Until then, assert via rendered labels that stale content did not win.
		}
		if (diag.statusLabel === 'STALE-6010' || diag.latestShortMessage === 'STALE message') {
			throw new Error('stale lower revision must not rewind rendered labels after higher revisions were applied');
		}
		if (diag.statusLabel !== `rev-${highWater}`) {
			throw new Error(`expected statusLabel rev-${highWater} after monotonic apply, got ${diag.statusLabel}`);
		}
		if (diag.latestShortMessage !== `msg-${highWater}`) {
			throw new Error(`expected latestShortMessage msg-${highWater}, got ${diag.latestShortMessage}`);
		}
	} catch (err) {
		test17.ok = false;
		test17.error = err.message;
		results.failures.push(`snapshot-revision-ordering: ${err.message}`);
	}
	results.tests.push(test17);

	// Test 18: question/approval text refresh must not replay attention entrance
	const test18 = { name: 'question-approval-content-updates', ok: true, details: {} };
	try {
		native.dispose();
		const interactionId = 'q-stable-1';
		// Presentation must be visible before attention snapshot so mayExpand can enter attentionPeek.
		native.setPresentation({ visible: true, pinned: false, reducedMotion: false, display: 'builtin' });
		await sleep(40);
		native.setSnapshot(contentSnapshot(7000, {
			status: 'attention',
			presentationLabel: 'Question from Magnus',
			latestShortMessage: 'Need a choice',
			pendingInteraction: {
				kind: 'question',
				interactionId,
				title: 'Choose lane',
				message: 'Initial pending message',
				options: [
					{ id: 'dev', label: 'Development' },
					{ id: 'staging', label: 'Staging' },
				],
			},
		}));
		await sleep(220);
		await drainMain(native, 4);

		const afterEntrance = native.getDiagnostics();
		const entranceBaseline = captureStabilityBaseline(afterEntrance);
		test18.details.afterEntrance = {
			state: afterEntrance.activePresentationState,
			interactionId: afterEntrance.interactionId,
			animationCount: entranceBaseline.animationCount,
			pendingMessage: afterEntrance.pendingMessage,
		};
		if (afterEntrance.activePresentationState !== 'attentionPeek') {
			throw new Error(`expected attentionPeek after seed, got ${afterEntrance.activePresentationState}`);
		}
		if (afterEntrance.interactionId !== interactionId) {
			throw new Error(`interactionId mismatch after seed: ${afterEntrance.interactionId}`);
		}

		for (let i = 0; i < 40; i++) {
			native.setSnapshot(contentSnapshot(7001 + i, {
				status: 'attention',
				presentationLabel: 'Question from Magnus',
				latestShortMessage: `Need a choice ${i}`,
				pendingInteraction: {
					kind: 'question',
					interactionId,
					title: 'Choose lane',
					message: `Updated pending message ${i}`,
					options: [
						{ id: 'dev', label: 'Development' },
						{ id: 'staging', label: 'Staging' },
					],
				},
			}));
			if ((i + 1) % 10 === 0) {
				await drainMain(native, 1);
			}
		}
		await sleep(100);
		await drainMain(native, 4);

		const after = native.getDiagnostics();
		test18.details.afterContent = {
			state: after.activePresentationState,
			interactionId: after.interactionId,
			animationCount: after.animationCount,
			pendingMessage: after.pendingMessage,
			renderedPendingMessage: after.renderedPendingMessage,
			renderedPeekBody: after.renderedPeekBody,
			transitionGeneration: after.transitionGeneration,
			frame: captureFrame(after),
		};
		if (after.interactionId !== interactionId) {
			throw new Error(`interactionId must stay stable across content-only attention updates (got ${after.interactionId})`);
		}
		if (after.activePresentationState !== 'attentionPeek') {
			throw new Error(`attention content refresh must not leave attentionPeek (got ${after.activePresentationState})`);
		}
		assertContentOnlyStable(after, entranceBaseline, {
			expectedState: 'attentionPeek',
			expectedTarget: 'attentionPeek',
		});
		const pendingText = String(after.pendingMessage || after.renderedPendingMessage || after.renderedPeekBody || '');
		if (!pendingText.includes('Updated pending message')) {
			throw new Error(`pending message text not refreshed: ${pendingText}`);
		}
	} catch (err) {
		test18.ok = false;
		test18.error = err.message;
		results.failures.push(`question-approval-content-updates: ${err.message}`);
	}
	results.tests.push(test18);

	// Test 19: reduced motion — content non-animated; state changes immediate
	const test19 = { name: 'reduced-motion-content-and-state', ok: true, details: {} };
	try {
		native.dispose();
		native.setSnapshot(contentSnapshot(8000));
		native.setPresentation({ visible: true, pinned: false, reducedMotion: true, display: 'builtin' });
		await sleep(100);
		await drainMain(native, 3);

		const baselineDiag = native.getDiagnostics();
		const baseline = captureStabilityBaseline(baselineDiag);
		test19.details.baseline = baseline;

		const storm = await applyContentStorm(native, {
			startRevision: 8001,
			count: 80,
			batchSize: 20,
			labelPrefix: 'RM',
		});
		await sleep(40);
		await drainMain(native, 3);
		const afterContent = native.getDiagnostics();
		test19.details.afterContent = {
			animationCount: afterContent.animationCount,
			transitionGeneration: afterContent.transitionGeneration,
			transitionInFlight: afterContent.transitionInFlight,
			state: afterContent.activePresentationState,
			lastApplied: storm,
		};
		assertContentOnlyStable(afterContent, baseline, {
			expectedState: 'compact',
			expectedTarget: 'compact',
			lastApplied: storm,
		});

		const beforePeekAnim = Number(afterContent.animationCount) || 0;
		if (!native.simulateAction('peek')) {
			throw new Error('reduced-motion peek failed');
		}
		await sleep(30);
		await drainMain(native, 2);
		const afterPeek = native.getDiagnostics();
		test19.details.afterPeek = {
			state: afterPeek.activePresentationState,
			animationCount: afterPeek.animationCount,
			transitionInFlight: afterPeek.transitionInFlight,
		};
		if (afterPeek.activePresentationState !== 'peek') {
			throw new Error(`reduced-motion peek must apply immediately, got ${afterPeek.activePresentationState}`);
		}
		if (afterPeek.transitionInFlight !== false) {
			throw new Error('reduced-motion state change must not leave transitionInFlight');
		}
		// Reduced motion: state change is immediate and must not schedule geometry morph animations.
		if ((Number(afterPeek.animationCount) || 0) !== beforePeekAnim) {
			throw new Error(`reduced-motion state change must not increase animationCount (${beforePeekAnim} → ${afterPeek.animationCount})`);
		}
	} catch (err) {
		test19.ok = false;
		test19.error = err.message;
		results.failures.push(`reduced-motion-content-and-state: ${err.message}`);
	}
	results.tests.push(test19);

	// Test 20: monitors must not leak across compact/peek/interactive/pinned/collapse cycles
	const test20 = { name: 'monitor-leaks-after-presentation-cycles', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: false, reducedMotion: false, display: 'builtin' });
		native.setSnapshot(contentSnapshot(9000));
		await sleep(80);

		let localLeaksOnGlanceable = 0;
		let localMissingInteractive = 0;
		let globalMissingAfterCollapse = 0;
		const observations = [];

		for (let i = 0; i < 12; i++) {
			native.setSnapshot(contentSnapshot(9001 + i * 5, {
				presentationLabel: `Cycle ${i}`,
				latestShortMessage: `cycle-${i}`,
			}));
			native.setPresentation({ visible: true, pinned: false, reducedMotion: false, display: 'builtin' });

			if (!native.simulateAction('peek')) {
				throw new Error(`cycle ${i}: peek failed`);
			}
			await sleep(25);
			let diag = native.getDiagnostics();
			// Peek intentionally removes the global hover monitor; local must stay off.
			if (diag.localMonitorInstalled) {
				localLeaksOnGlanceable++;
			}

			if (!native.simulateAction('click')) {
				throw new Error(`cycle ${i}: click failed`);
			}
			await sleep(35);
			diag = native.getDiagnostics();
			if (!diag.localMonitorInstalled) {
				localMissingInteractive++;
			}

			if (!native.simulateAction('pin')) {
				throw new Error(`cycle ${i}: pin failed`);
			}
			await sleep(30);
			diag = native.getDiagnostics();
			if (diag.pinned !== true) {
				throw new Error(`cycle ${i}: expected pinned`);
			}
			if (!diag.localMonitorInstalled) {
				localMissingInteractive++;
			}

			if (!native.simulateAction('escape')) {
				throw new Error(`cycle ${i}: escape failed`);
			}
			await sleep(40);
			diag = native.getDiagnostics();
			observations.push({
				i,
				state: diag.activePresentationState,
				local: diag.localMonitorInstalled,
				global: diag.globalMonitorInstalled,
				pinned: diag.pinned,
			});
			if (diag.localMonitorInstalled) {
				localLeaksOnGlanceable++;
			}
			if (!diag.globalMonitorInstalled) {
				globalMissingAfterCollapse++;
			}
			if (diag.pinned === true) {
				throw new Error(`cycle ${i}: escape must unpin`);
			}
			if (diag.activePresentationState !== 'compact' && diag.activePresentationState !== 'peek') {
				throw new Error(`cycle ${i}: expected compact/peek after escape, got ${diag.activePresentationState}`);
			}
		}

		await sleep(120);
		const finalDiag = native.getDiagnostics();
		test20.details = {
			localLeaksOnGlanceable,
			localMissingInteractive,
			globalMissingAfterCollapse,
			finalState: finalDiag.activePresentationState,
			finalLocal: finalDiag.localMonitorInstalled,
			finalGlobal: finalDiag.globalMonitorInstalled,
			sample: observations.slice(0, 3),
		};
		if (localLeaksOnGlanceable > 0) {
			throw new Error(`local key monitor leaked on ${localLeaksOnGlanceable} peek/compact observations`);
		}
		if (localMissingInteractive > 0) {
			throw new Error(`local key monitor missing on ${localMissingInteractive} interactive/pinned observations`);
		}
		if (globalMissingAfterCollapse > 0) {
			throw new Error(`global monitor not restored after collapse on ${globalMissingAfterCollapse} cycles`);
		}
		if (finalDiag.localMonitorInstalled === true
			&& (finalDiag.activePresentationState === 'compact' || finalDiag.activePresentationState === 'peek')) {
			throw new Error('final compact/peek must not retain local key monitor');
		}
		if (finalDiag.globalMonitorInstalled !== true) {
			throw new Error('global monitor must be restored after collapse while presentation remains visible');
		}
	} catch (err) {
		test20.ok = false;
		test20.error = err.message;
		results.failures.push(`monitor-leaks-after-presentation-cycles: ${err.message}`);
	}
	results.tests.push(test20);

	// Test 21: Hover-Only Haptic Policy — verify zero haptics from clicks, actions, content storms, and exactly 1 on hover dwell
	const test21 = { name: 'hover-only-haptic-policy', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: false, reducedMotion: false, display: 'builtin' });
		await sleep(40);
		await drainMain(native, 2);

		let diag = native.getDiagnostics();
		if (diag.hapticCount !== 0) {
			throw new Error(`baseline hapticCount must be 0, got ${diag.hapticCount}`);
		}

		// 1. Content storm while compact must NOT produce haptics
		for (let i = 0; i < 20; i++) {
			native.setSnapshot(contentSnapshot(9000 + i, { presentationLabel: `Compact ${i}` }));
		}
		await sleep(50);
		diag = native.getDiagnostics();
		if (diag.hapticCount !== 0) {
			throw new Error(`content storm while compact emitted haptic (count=${diag.hapticCount})`);
		}

		// 2. Click → interactive must NOT produce haptics
		native.simulateAction('click');
		await sleep(50);
		diag = native.getDiagnostics();
		if (diag.hapticCount !== 0) {
			throw new Error(`click->interactive emitted haptic (count=${diag.hapticCount})`);
		}

		// 3. Follow-up submission must NOT produce haptics
		native.simulateAction('followUp', 'hello magnus');
		await sleep(30);
		diag = native.getDiagnostics();
		if (diag.hapticCount !== 0) {
			throw new Error(`follow-up submission emitted haptic (count=${diag.hapticCount})`);
		}

		// 4. Question option answer must NOT produce haptics
		native.setSnapshot(contentSnapshot(9100, {
			status: 'attention',
			pendingInteraction: {
				kind: 'question',
				interactionId: 'haptic-q',
				title: 'Question',
				message: 'Pick one',
				options: [{ id: 'opt1', label: 'Option 1' }]
			}
		}));
		await sleep(50);
		diag = native.getDiagnostics();
		if (diag.hapticCount !== 0) {
			throw new Error(`attention arrival emitted haptic (count=${diag.hapticCount})`);
		}
		native.simulateAction('option', 0);
		await sleep(30);
		diag = native.getDiagnostics();
		if (diag.hapticCount !== 0) {
			throw new Error(`answering question option emitted haptic (count=${diag.hapticCount})`);
		}

		// 5. Pin and unpin must NOT produce haptics
		native.simulateAction('pin');
		await sleep(30);
		diag = native.getDiagnostics();
		if (diag.hapticCount !== 0) {
			throw new Error(`pin emitted haptic (count=${diag.hapticCount})`);
		}
		native.simulateAction('escape');
		await sleep(50);
		diag = native.getDiagnostics();
		if (diag.hapticCount !== 0) {
			throw new Error(`unpin/escape emitted haptic (count=${diag.hapticCount})`);
		}

		// Clear attention state so sticky Escape policy does not block hover acquisition
		native.setSnapshot(contentSnapshot(9150, { status: 'working' }));
		await sleep(40);
		await drainMain(native, 2);

		// 6. Genuine hover acquisition: pointer inside for >= 180ms produces exactly 1 haptic
		native.simulateAction('pointerInside', true);
		for (let i = 0; i < 6; i++) {
			await sleep(40);
			await drainMain(native, 1);
		}
		diag = native.getDiagnostics();
		if (diag.hapticCount !== 1 || diag.hoverHapticCount !== 1) {
			throw new Error(`hover acquisition expected exactly 1 haptic, got hapticCount=${diag.hapticCount}, hoverHapticCount=${diag.hoverHapticCount}`);
		}
		if (diag.lastHapticReason !== 'hover') {
			throw new Error(`expected lastHapticReason 'hover', got '${diag.lastHapticReason}'`);
		}

		// 7. Content update while hovering must NOT produce additional haptics
		for (let i = 0; i < 10; i++) {
			native.setSnapshot(contentSnapshot(9200 + i, { status: 'working', latestShortMessage: `msg-${i}` }));
		}
		await sleep(50);
		await drainMain(native, 2);
		diag = native.getDiagnostics();
		if (diag.hapticCount !== 1) {
			throw new Error(`content updates while hovering produced extra haptics (count=${diag.hapticCount})`);
		}

		// 8. Pointer exit before hover dwell must NOT produce haptic
		native.simulateAction('pointerInside', false);
		for (let i = 0; i < 8; i++) {
			await sleep(40); // 320ms > 250ms exit grace interval
			await drainMain(native, 1);
		}
		// Quick enter then exit before 180ms dwell
		native.simulateAction('pointerInside', true);
		await sleep(50); // only 50ms < 180ms
		await drainMain(native, 1);
		native.simulateAction('pointerInside', false);
		for (let i = 0; i < 8; i++) {
			await sleep(40); // 320ms > 250ms
			await drainMain(native, 1);
		}
		diag = native.getDiagnostics();
		if (diag.hapticCount !== 1) {
			throw new Error(`pointer exit before dwell threshold produced unexpected haptic (count=${diag.hapticCount})`);
		}

		const beforeStep9 = native.getDiagnostics();
		if (beforeStep9.activePresentationState !== 'compact') {
			throw new Error(`expected compact before step 9, got state=${beforeStep9.activePresentationState}, peekOnly=${beforeStep9.peekOnly}, expanded=${beforeStep9.expanded}, hovering=${beforeStep9.hovered}`);
		}

		// 9. Re-enter after exit produces a new hover acquisition haptic
		native.simulateAction('pointerInside', true);
		for (let i = 0; i < 6; i++) {
			await sleep(40);
			await drainMain(native, 1);
		}
		diag = native.getDiagnostics();
		if (diag.hapticCount !== 2 || diag.hoverHapticCount !== 2) {
			throw new Error(`re-enter hover acquisition expected 2 total haptics, got ${diag.hapticCount}`);
		}

		// 10. Pointer jitter does NOT produce a haptic storm
		for (let i = 0; i < 20; i++) {
			native.simulateAction('pointerInside', i % 2 === 0);
			await sleep(10);
			await drainMain(native, 1);
		}
		native.simulateAction('pointerInside', false);
		for (let i = 0; i < 5; i++) {
			await sleep(40);
			await drainMain(native, 1);
		}
		diag = native.getDiagnostics();
		if (diag.hapticCount > 3) {
			throw new Error(`pointer jitter created a haptic storm (count=${diag.hapticCount})`);
		}

		test21.details = {
			finalHapticCount: diag.hapticCount,
			finalHoverHapticCount: diag.hoverHapticCount,
			lastHapticReason: diag.lastHapticReason
		};
	} catch (err) {
		test21.ok = false;
		test21.error = err.message;
		results.failures.push(`hover-only-haptic-policy: ${err.message}`);
	}
	results.tests.push(test21);

	// Test 22: Mid-Morph Content Preservation & Interactive Content Growth
	const test22 = { name: 'mid-morph-content-and-interactive-growth', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: false, reducedMotion: false, display: 'builtin' });
		native.setSnapshot(contentSnapshot(9499, {
			status: 'working',
			presentationLabel: 'MorphContent Seed',
			latestShortMessage: 'msg-morph-seed'
		}));
		await sleep(40);

		// 1. Initiate expansion to interactive
		native.simulateAction('click');
		await sleep(20); // Mid-flight of 240ms morph
		let midMorphDiag = native.getDiagnostics();
		const midGen = midMorphDiag.transitionGeneration;

		// 2. Inject rapid content snapshots mid-morph
		for (let i = 0; i < 15; i++) {
			native.setSnapshot(contentSnapshot(9500 + i, {
				status: 'working',
				presentationLabel: `MorphContent ${i}`,
				latestShortMessage: `msg-morph-${i}`
			}));
		}
		await sleep(250); // Settle past transition duration
		await drainMain(native, 4);

		let settledDiag = native.getDiagnostics();
		if (settledDiag.activePresentationState !== 'interactive') {
			throw new Error(`expected interactive after settle, got ${settledDiag.activePresentationState}`);
		}
		// Content updates mid-morph must not bump geometry transition generation
		if (settledDiag.transitionGeneration !== midGen) {
			throw new Error(`transitionGeneration bumped during mid-morph content updates (expected ${midGen}, got ${settledDiag.transitionGeneration})`);
		}
		test22.details.midMorphSettled = {
			state: settledDiag.activePresentationState,
			frame: captureFrame(settledDiag),
			transitionGeneration: settledDiag.transitionGeneration
		};

		// 3. Interactive content growth: add pending question with 3 options to grow content height
		const preGrowthHeight = captureFrame(settledDiag).height;
		native.setSnapshot(contentSnapshot(9600, {
			status: 'working',
			pendingInteraction: {
				kind: 'question',
				interactionId: 'growth-q',
				title: 'Deploy to Production?',
				message: 'Select deployment environment',
				options: [
					{ id: 'dev', label: 'Development' },
					{ id: 'staging', label: 'Staging' },
					{ id: 'prod', label: 'Production' }
				]
			}
		}));
		await sleep(250);
		await drainMain(native, 4);

		let growthDiag = native.getDiagnostics();
		const postGrowthHeight = captureFrame(growthDiag).height;
		test22.details.contentGrowth = {
			preGrowthHeight,
			postGrowthHeight,
			questionButtonCount: growthDiag.questionButtonCount
		};
		if (postGrowthHeight <= preGrowthHeight) {
			throw new Error(`interactive panel height must grow when options are added (pre=${preGrowthHeight}, post=${postGrowthHeight})`);
		}
		if (growthDiag.questionButtonCount < 3) {
			throw new Error(`expected at least 3 question buttons visible, got ${growthDiag.questionButtonCount}`);
		}
	} catch (err) {
		test22.ok = false;
		test22.error = err.message;
		results.failures.push(`mid-morph-content-and-interactive-growth: ${err.message}`);
	}
	results.tests.push(test22);

	// Test 23: Exhaustive Action Haptic Immunity & Session Token Lifecycle
	const test23 = { name: 'exhaustive-action-haptic-immunity', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: false, reducedMotion: false, display: 'builtin' });
		await sleep(40);
		await drainMain(native, 2);

		let diag = native.getDiagnostics();
		const initialHaptics = diag.hapticCount;
		const initialSessionToken = diag.hoverSessionToken ?? 0;

		// 1. Enter and exit immediately — verify session token increments
		native.simulateAction('pointerInside', true);
		await sleep(20);
		await drainMain(native, 1);
		const enteredToken = (native.getDiagnostics().hoverSessionToken ?? 0);
		if (enteredToken <= initialSessionToken) {
			throw new Error(`hoverSessionToken did not increment on pointerInside: initial=${initialSessionToken}, entered=${enteredToken}`);
		}
		native.simulateAction('pointerInside', false);
		await sleep(20);
		await drainMain(native, 1);
		const exitedToken = (native.getDiagnostics().hoverSessionToken ?? 0);
		if (exitedToken <= enteredToken) {
			throw new Error(`hoverSessionToken did not increment on pointer exit: entered=${enteredToken}, exited=${exitedToken}`);
		}

		// 2. Set approval snapshot and simulate approve -> must produce ZERO haptics
		native.setSnapshot(contentSnapshot(9500, {
			status: 'attention',
			pendingKind: 'approval',
			pendingTitle: 'Approve file write?',
			interactionId: 'act-haptic-appr',
		}));
		await sleep(60);
		await drainMain(native, 2);

		native.simulateAction('click');
		await sleep(40);
		native.simulateAction('approve');
		await sleep(40);
		await drainMain(native, 2);
		diag = native.getDiagnostics();
		if (diag.hapticCount !== initialHaptics) {
			throw new Error(`approve action produced haptics: initial=${initialHaptics}, now=${diag.hapticCount}`);
		}

		// 3. Set deny snapshot and simulate deny -> must produce ZERO haptics
		native.setSnapshot(contentSnapshot(9501, {
			status: 'attention',
			pendingKind: 'approval',
			pendingTitle: 'Deny file deletion?',
			interactionId: 'act-haptic-deny',
		}));
		await sleep(60);
		await drainMain(native, 2);
		native.simulateAction('deny');
		await sleep(40);
		await drainMain(native, 2);
		diag = native.getDiagnostics();
		if (diag.hapticCount !== initialHaptics) {
			throw new Error(`deny action produced haptics: initial=${initialHaptics}, now=${diag.hapticCount}`);
		}

		// 4. Open in PreBase and Escape -> must produce ZERO haptics
		native.simulateAction('openInPrebase');
		await sleep(40);
		native.simulateAction('escape');
		await sleep(40);
		await drainMain(native, 2);
		diag = native.getDiagnostics();
		if (diag.hapticCount !== initialHaptics) {
			throw new Error(`openInPrebase or escape produced haptics: initial=${initialHaptics}, now=${diag.hapticCount}`);
		}

		test23.details = {
			initialHaptics,
			finalHaptics: diag.hapticCount,
			initialSessionToken,
			finalSessionToken: diag.hoverSessionToken ?? 0,
			actionHapticsEmitted: diag.hapticCount - initialHaptics
		};
	} catch (err) {
		test23.ok = false;
		test23.error = err.message;
		results.failures.push(`exhaustive-action-haptic-immunity: ${err.message}`);
	}
	results.tests.push(test23);

	// Test 24: Action In-Flight State and Duplicate Submission Prevention
	const test24 = { name: 'action-in-flight-lifecycle', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: false, reducedMotion: false, display: 'builtin' });
		native.setSnapshot(contentSnapshot(9600, {
			status: 'attention',
			pendingKind: 'approval',
			pendingTitle: 'Confirm deployment?',
			interactionId: 'in-flight-test-1',
		}));
		await sleep(60);
		await drainMain(native, 2);

		native.simulateAction('click');
		await sleep(40);
		let beforeAction = native.getDiagnostics();
		if (beforeAction.actionInFlight !== false) {
			throw new Error(`expected actionInFlight false before action, got ${beforeAction.actionInFlight}`);
		}

		// Click approve: actionInFlight should become true
		const approveResult = native.simulateAction('approve');
		if (approveResult !== true) {
			throw new Error('simulateAction approve must succeed');
		}
		let inFlightDiag = native.getDiagnostics();
		if (inFlightDiag.actionInFlight !== true) {
			throw new Error(`expected actionInFlight true after approve, got ${inFlightDiag.actionInFlight}`);
		}

		// Second approve while in-flight: should be ignored / return false or no-op
		const secondApprove = native.simulateAction('approve');
		// Confirm actionInFlight remains true
		inFlightDiag = native.getDiagnostics();
		if (inFlightDiag.actionInFlight !== true) {
			throw new Error('actionInFlight must remain true while awaiting session response');
		}

		// Acknowledging snapshot arrives: status transitions to working, clearing interaction
		native.setSnapshot(contentSnapshot(9601, {
			status: 'working',
			currentActivity: 'Deploying components…',
		}));
		await sleep(60);
		await drainMain(native, 2);

		let resolvedDiag = native.getDiagnostics();
		if (resolvedDiag.actionInFlight !== false) {
			throw new Error(`expected actionInFlight false after confirming snapshot, got ${resolvedDiag.actionInFlight}`);
		}

		test24.details = {
			beforeActionInFlight: beforeAction.actionInFlight,
			duringActionInFlight: inFlightDiag.actionInFlight,
			afterActionInFlight: resolvedDiag.actionInFlight,
			resolvedActivity: resolvedDiag.activityLabel
		};
	} catch (err) {
		test24.ok = false;
		test24.error = err.message;
		results.failures.push(`action-in-flight-lifecycle: ${err.message}`);
	}
	results.tests.push(test24);

	native.dispose();

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
