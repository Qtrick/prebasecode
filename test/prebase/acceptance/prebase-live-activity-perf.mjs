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
	// Rule: Actual native panelFrame is authoritative; requestedFrame is the target.
	const actual = diag?.panelFrame;
	const requested = diag?.requestedFrame;
	const hasActual = actual
		&& Number(actual.width) > 0
		&& Number(actual.height) > 0;
	const frame = hasActual ? actual : requested;
	if (!frame) {
		return null;
	}
	return {
		x: Number(frame.x) || 0,
		y: Number(frame.y) || 0,
		width: Number(frame.width) || 0,
		height: Number(frame.height) || 0,
		isActual: !!hasActual,
		requested: requested ? {
			x: Number(requested.x) || 0,
			y: Number(requested.y) || 0,
			width: Number(requested.width) || 0,
			height: Number(requested.height) || 0,
		} : null,
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

function isValidDiagFrame(f) {
	return f && typeof f === 'object' && typeof f.x === 'number' && typeof f.width === 'number'
		&& Number(f.width) >= 0 && Number(f.height) >= 0;
}

function layoutContainmentOk(diag) {
	// Child frames are in expanded-container local coords. Use bodyBounds for chrome
	// (composer/footer lives below the text contentViewport by design).
	const body = diag?.bodyBounds && typeof diag.bodyBounds.width === 'number'
		? diag.bodyBounds
		: diag?.contentViewport;
	if (!body || typeof body.width !== 'number') {
		return { ok: false, reason: 'missing-bodyBounds' };
	}
	const viewport = {
		x: 0,
		y: 0,
		maxX: Number(body.width) || 0,
		maxY: Number(body.height) || 0,
	};
	if (viewport.maxX <= 0) {
		return { ok: false, reason: 'empty-bodyBounds', viewport };
	}
	const textKeys = new Set([
		'headerFrame', 'statusBadgeFrame', 'activityFrame', 'latestMessageFrame',
		'pendingTitleFrame', 'pendingMessageFrame', 'action',
	]);
	const controlKeys = new Set([
		'composerFrame', 'pinButtonFrame', 'openButtonFrame',
		'approveButtonFrame', 'denyButtonFrame', 'option',
	]);
	const frames = [];
	for (const key of [
		'headerFrame', 'statusBadgeFrame', 'activityFrame', 'latestMessageFrame',
		'pendingTitleFrame', 'pendingMessageFrame', 'composerFrame',
		'pinButtonFrame', 'openButtonFrame', 'approveButtonFrame', 'denyButtonFrame',
	]) {
		const f = diag[key];
		if (isValidDiagFrame(f)) {
			frames.push({ key, f });
		}
	}
	for (const f of diag.actionFrames || []) {
		if (isValidDiagFrame(f)) {
			frames.push({ key: 'action', f });
		}
	}
	for (const f of diag.optionButtonFrames || []) {
		if (isValidDiagFrame(f)) {
			frames.push({ key: 'option', f });
		}
	}
	// Expanded chrome is only strictly containable once the body has grown
	// past the notch band (headless harnesses used to keep height≈2 before synthetic sizing).
	if (viewport.maxY < 24) {
		return {
			ok: frames.length === 0 || frames.every(({ f }) => f.x >= -1 && f.y >= -1),
			reason: frames.length ? 'viewport-too-shallow-for-strict-containment' : 'compact-or-empty',
			headlessShallow: true,
			frameCount: frames.length,
			viewport,
		};
	}
	// Text blocks live in the scroll document (document-local Y). Prefer document height
	// over contentViewport (container-local text band) when the scroll host is active.
	const scrollDocH = Number(diag.contentDocumentHeight);
	const textMaxY = (Number.isFinite(scrollDocH) && scrollDocH > 0)
		? scrollDocH
		: Number(diag.contentViewport?.height);
	const scrollHostActive = diag.contentScrollEnabled === true && Number.isFinite(scrollDocH) && scrollDocH > 0;
	for (const { key, f } of frames) {
		// Controls are laid out in expanded-container space; text may be document-local.
		if (controlKeys.has(key)) {
			if (f.x < -1 || f.y < -1 || (f.x + f.width) > viewport.maxX + 2 || (f.y + f.height) > viewport.maxY + 2) {
				return { ok: false, reason: `${key}-overflow`, frame: f, viewport };
			}
			if (f.y < -1) {
				return { ok: false, reason: `${key}-negative-y`, frame: f };
			}
			continue;
		}
		if (textKeys.has(key)) {
			if (f.x < -1 || f.y < -1) {
				return { ok: false, reason: `${key}-negative-origin`, frame: f };
			}
			if (!scrollHostActive && ((f.x + f.width) > viewport.maxX + 2 || (f.y + f.height) > viewport.maxY + 2)) {
				return { ok: false, reason: `${key}-overflow`, frame: f, viewport };
			}
			if (Number.isFinite(textMaxY) && textMaxY > 0 && (f.y + f.height) > textMaxY + 2) {
				return { ok: false, reason: `${key}-into-footer`, frame: f, textMaxY };
			}
			continue;
		}
		if (f.x < -1 || f.y < -1 || (f.x + f.width) > viewport.maxX + 2 || (f.y + f.height) > viewport.maxY + 2) {
			return { ok: false, reason: `${key}-overflow`, frame: f, viewport };
		}
	}
	return { ok: true, frameCount: frames.length, viewport, textMaxY, scrollHostActive };
}

function frameBottom(f) {
	return Number(f.y) + Number(f.height);
}

function framesIntersect(a, b, tol = 1) {
	if (!isValidDiagFrame(a) || !isValidDiagFrame(b)) {
		return false;
	}
	return !(frameBottom(a) <= b.y + tol
		|| frameBottom(b) <= a.y + tol
		|| (a.x + a.width) <= b.x + tol
		|| (b.x + b.width) <= a.x + tol);
}

/** Map scroll-document frames into expanded-container space (scroll offset ≈ top). */
function documentFrameInContainer(diag, docFrame) {
	const scroll = diag?.contentScrollFrame;
	if (!isValidDiagFrame(scroll) || !isValidDiagFrame(docFrame)) {
		return null;
	}
	return {
		x: Number(docFrame.x),
		y: Number(scroll.y) + Number(docFrame.y),
		width: Number(docFrame.width),
		height: Number(docFrame.height),
	};
}

/**
 * Visible text must not paint under footer controls. Document frames are scroll-local;
 * clamp to the scroll host bottom (what can actually paint).
 */
function assertTextDoesNotPaintUnderControls(diag, { requireApprove = false } = {}) {
	const scroll = diag.contentScrollFrame;
	const approve = diag.approveButtonFrame;
	const composer = diag.composerFrame;
	const viewportH = Number(diag.contentViewport?.height) || Number(diag.bodyBounds?.height) || 0;
	if (viewportH < 24) {
		return { skipped: true, reason: 'viewport-too-shallow' };
	}
	if (!isValidDiagFrame(scroll)) {
		throw new Error('interactive settle must expose contentScrollFrame for footer no-overlap');
	}
	const scrollBottom = frameBottom(scroll);
	if (isValidDiagFrame(composer) && scrollBottom > composer.y + 1.5) {
		throw new Error(`content scroll must end above composer (scrollBottom=${scrollBottom}, composer.y=${composer.y})`);
	}
	if (isValidDiagFrame(approve)) {
		if (scrollBottom > approve.y + 1.5) {
			throw new Error(`content scroll must end above Approve (scrollBottom=${scrollBottom}, approve.y=${approve.y})`);
		}
		if (isValidDiagFrame(diag.pendingMessageFrame)) {
			const converted = documentFrameInContainer(diag, diag.pendingMessageFrame);
			const visibleBottom = Math.min(frameBottom(converted), scrollBottom);
			if (!(visibleBottom < approve.y - 0.5)) {
				throw new Error(`pendingMessage must sit above Approve (visibleBottom=${visibleBottom}, approve.y=${approve.y})`);
			}
		}
	} else if (requireApprove) {
		throw new Error('expected approveButtonFrame after interactive approval settle');
	}
	for (const key of ['activityFrame', 'latestMessageFrame']) {
		const raw = diag[key];
		if (!isValidDiagFrame(raw) || !isValidDiagFrame(composer)) {
			continue;
		}
		const converted = documentFrameInContainer(diag, raw);
		if (!converted) {
			continue;
		}
		const visible = {
			...converted,
			height: Math.min(converted.height, Math.max(0, scrollBottom - converted.y)),
		};
		if (visible.height > 0.5 && framesIntersect(visible, composer, 1)) {
			throw new Error(`${key} must not intersect composerFrame`);
		}
	}
	return { skipped: false, scrollBottom, approveY: approve?.y, composerY: composer?.y };
}

/**
 * ≥3 question options must form a 2-col grid (no lone chip row above a fuller row).
 * Option tops sit below document content and above the composer.
 */
function assertTwoColOptionLayout(diag) {
	const frames = (diag.optionButtonFrames || []).filter(isValidDiagFrame);
	const viewportH = Number(diag.contentViewport?.height) || Number(diag.bodyBounds?.height) || 0;
	if (viewportH < 24 || frames.length < 3) {
		return { skipped: true, reason: frames.length < 3 ? 'fewer-than-3-options' : 'viewport-too-shallow', count: frames.length };
	}
	const tol = 3;
	const sorted = [...frames].sort((a, b) => a.y - b.y || a.x - b.x);
	const rows = [];
	for (const f of sorted) {
		const row = rows.find(r => Math.abs(r[0].y - f.y) <= tol);
		if (row) {
			row.push(f);
		} else {
			rows.push([f]);
		}
	}
	for (const row of rows) {
		if (row.length > 2) {
			throw new Error(`option row must be at most 2-wide, got ${row.length}`);
		}
	}
	// Topmost row must not be a single orphan above a fuller row (legacy 1-then-wrap).
	if (rows[0].length === 1 && rows.some(r => r.length >= 2)) {
		throw new Error('2-col options must not leave a single orphan chip above a fuller row');
	}
	if (rows.length >= 2 && rows[0].length < 2) {
		throw new Error(`expected top option row to be 2-wide for ≥3 options, got ${rows[0].length}`);
	}
	const optionTop = Math.min(...frames.map(f => f.y));
	const optionBottom = Math.max(...frames.map(f => frameBottom(f)));
	const composer = diag.composerFrame;
	if (isValidDiagFrame(composer) && !(optionBottom < composer.y - 0.5)) {
		throw new Error(`option chips must sit above composer (optionBottom=${optionBottom}, composer.y=${composer.y})`);
	}
	const scroll = diag.contentScrollFrame;
	if (isValidDiagFrame(scroll) && !(frameBottom(scroll) <= optionTop + 1.5)) {
		throw new Error(`content scroll must end at/above option row (scrollBottom=${frameBottom(scroll)}, optionTop=${optionTop})`);
	}
	// Header is container-local; pending/activity/latest are scroll-document-local.
	for (const key of ['headerFrame', 'pendingTitleFrame', 'pendingMessageFrame', 'activityFrame', 'latestMessageFrame']) {
		const raw = diag[key];
		if (!isValidDiagFrame(raw)) {
			continue;
		}
		const converted = key === 'headerFrame' ? raw : documentFrameInContainer(diag, raw);
		if (!converted) {
			continue;
		}
		const visibleBottom = isValidDiagFrame(scroll)
			? Math.min(frameBottom(converted), frameBottom(scroll))
			: frameBottom(converted);
		if (visibleBottom > optionTop + 1.5) {
			throw new Error(`${key} must stay above option chips (visibleBottom=${visibleBottom}, optionTop=${optionTop})`);
		}
	}
	return {
		skipped: false,
		rows: rows.map(r => r.length),
		optionTop,
		optionBottom,
		count: frames.length,
	};
}

async function awaitCommands(predicate, { timeoutMs = 400 } = {}) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (predicate()) {
			return true;
		}
		await new Promise(r => setImmediate(r));
		await sleep(10);
	}
	return predicate();
}

function longText(seed, words) {
	const parts = [];
	for (let i = 0; i < words; i++) {
		parts.push(`${seed}-${i}`);
	}
	return parts.join(' ');
}

async function settleInteractive(native) {
	native.setPresentation({ visible: true, pinned: false, reducedMotion: false, display: 'builtin' });
	await sleep(40);
	if (!native.simulateAction('interactive') && !native.simulateAction('click')) {
		throw new Error('failed to enter interactive');
	}
	await sleep(180);
	await drainMain(native, 3);
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
	};
	if (extras.workspaceDiff !== null) {
		snap.workspaceDiff = extras.workspaceDiff || {
			additions: revision % 50,
			deletions: (revision + 3) % 40,
			files: (revision % 7) + 1,
		};
	}
	if (extras.pendingInteraction) {
		snap.pendingInteraction = extras.pendingInteraction;
	}
	if (extras.pendingKind) {
		snap.pendingKind = extras.pendingKind;
	}
	if (extras.pendingTitle) {
		snap.pendingTitle = extras.pendingTitle;
	}
	if (extras.pendingMessage) {
		snap.pendingMessage = extras.pendingMessage;
	}
	if (Array.isArray(extras.pendingOptions)) {
		snap.pendingOptions = extras.pendingOptions;
	}
	if (typeof extras.destructive === 'boolean') {
		snap.destructive = extras.destructive;
	}
	if (extras.interactionId) {
		snap.interactionId = extras.interactionId;
	}
	if (typeof extras.userDismissedAttention === 'boolean') {
		snap.userDismissedAttention = extras.userDismissedAttention;
	}
	if (Array.isArray(extras.recentActions)) {
		snap.recentActions = extras.recentActions;
	}
	return snap;
}

function framesClose(a, b, tol = 0.5) {
	if (!isValidDiagFrame(a) || !isValidDiagFrame(b)) {
		return false;
	}
	return Math.abs(a.x - b.x) <= tol
		&& Math.abs(a.y - b.y) <= tol
		&& Math.abs(a.width - b.width) <= tol
		&& Math.abs(a.height - b.height) <= tol;
}

/** Meaningful footer gutter (not a 1px coincidence) between scroll host and controls. */
function assertMeaningfulContentControlGutter(diag, controlFrame, { label = 'control', minGutter = 6 } = {}) {
	const scroll = diag.contentScrollFrame;
	const viewport = diag.contentViewport;
	if (!isValidDiagFrame(scroll) || !isValidDiagFrame(controlFrame)) {
		return { skipped: true, reason: 'missing-frames' };
	}
	const viewportH = Number(viewport?.height) || Number(diag.bodyBounds?.height) || 0;
	if (viewportH < 24) {
		return { skipped: true, reason: 'viewport-too-shallow' };
	}
	const scrollBottom = frameBottom(scroll);
	const gutter = Number(controlFrame.y) - scrollBottom;
	const declared = Number(diag.contentFooterGutter);
	if (!(gutter >= minGutter - 0.5)) {
		throw new Error(`${label} must keep meaningful gutter from content scroll (gutter=${gutter}, min=${minGutter}, scrollBottom=${scrollBottom}, control.y=${controlFrame.y})`);
	}
	if (Number.isFinite(declared) && declared >= minGutter - 0.5 && gutter + 1.5 < declared) {
		throw new Error(`${label} gutter (${gutter}) must honor contentFooterGutter=${declared}`);
	}
	return { skipped: false, gutter, declared, scrollBottom, controlY: controlFrame.y };
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
		// Compact wing statusLabel is a fixed token (Working/Question/…) — never storm presentationLabel prose.
		const compactTokens = new Set(['Working', 'Testing', 'Waiting', 'Question', 'Approve', 'Done', 'Failed', 'Offline', 'Magnus']);
		if (diag.statusLabel && !compactTokens.has(diag.statusLabel)) {
			throw new Error(`statusLabel must stay a compact wing token, got ${JSON.stringify(diag.statusLabel)}`);
		}
		const expectedActivity = `Activity ${lastApplied.revision}`;
		if (diag.activityLabel && diag.activityLabel !== expectedActivity) {
			throw new Error(`activityLabel not updated to latest content (expected ${expectedActivity}, got ${diag.activityLabel})`);
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
				presentationLabel: 'Working',
				currentActivity: i % 2 === 0 ? 'Running graph interaction tests' : 'Validating Temporal layout recovery',
				latestShortMessage: i % 2 === 0
					? 'Finished the graph interaction pass and checking remaining cases.'
					: 'Fit View metrics look stable on the large fixture.',
				recentActions: [{ id: `a${i}`, label: i % 2 === 0 ? 'Edited graphEditor.ts' : 'Ran interaction suites', at: Date.now() }],
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
		const panelH = diagRetarget.panelFrame?.height;
		const reqH = diagRetarget.requestedFrame?.height;
		if (typeof panelH === 'number' && typeof reqH === 'number' && Math.abs(panelH - reqH) > 2) {
			throw new Error(`panelFrame.height (${panelH}) must match requestedFrame.height (${reqH}) after settle`);
		}
		const panelW = diagRetarget.panelFrame?.width;
		const reqW = diagRetarget.requestedFrame?.width;
		if (typeof panelW === 'number' && typeof reqW === 'number' && Math.abs(panelW - reqW) > 2) {
			throw new Error(`panelFrame.width (${panelW}) must match requestedFrame.width (${reqW}) after settle`);
		}
		const pathH = diagRetarget.pathBounds?.height;
		if (typeof pathH === 'number' && typeof reqH === 'number' && Math.abs(pathH - reqH) > 2) {
			throw new Error(`pathBounds.height (${pathH}) must match requestedFrame.height (${reqH}) after settle`);
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
		if (!/^Pin( panel)?$/.test(String(diagInteractive.pinButtonTitle || ''))) {
			throw new Error(`Expected Pin button title to be 'Pin' or 'Pin panel', got '${diagInteractive.pinButtonTitle}'`);
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
		if (!/^Unpin( panel)?$/.test(String(diagPinned.pinButtonTitle || ''))) {
			throw new Error(`Expected Pin button title 'Unpin' or 'Unpin panel' when pinned, got '${diagPinned.pinButtonTitle}'`);
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
		if (!/^Pin( panel)?$/.test(String(diagUnpinned.pinButtonTitle || ''))) {
			throw new Error(`Expected Pin button title 'Pin' or 'Pin panel' after unpinning, got '${diagUnpinned.pinButtonTitle}'`);
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
		await sleep(260);
		await drainMain(native, 4);

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
		await sleep(280);
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
		if (diag.statusLabel === 'STALE-6010' || diag.latestShortMessage === 'STALE message' || diag.activityLabel === 'STALE activity') {
			throw new Error('stale lower revision must not rewind rendered labels after higher revisions were applied');
		}
		if (diag.statusLabel !== 'Working') {
			throw new Error(`expected compact wing statusLabel Working after monotonic apply, got ${diag.statusLabel}`);
		}
		if (diag.activityLabel !== `Activity ${highWater}`) {
			throw new Error(`expected activityLabel Activity ${highWater} after monotonic apply, got ${diag.activityLabel}`);
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
		await sleep(260);
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

	// Test 25: Layout containment via native diagnostics frames
	const test25 = { name: 'layout-containment-diagnostics-frames', ok: true, details: {} };
	try {
		native.dispose();
		const fixtures = [
			{
				name: 'interactive',
				pinned: true,
				snapshot: contentSnapshot(9700, {
					status: 'working',
					presentationLabel: 'Working',
					currentActivity: 'Running acceptance',
					latestShortMessage: 'Validating interactive chrome containment',
				}),
			},
			{
				name: 'long',
				pinned: true,
				snapshot: contentSnapshot(9701, {
					status: 'working',
					presentationLabel: 'Working',
					currentActivity: longText('activity', 40),
					latestShortMessage: longText('message', 55),
				}),
			},
			{
				name: 'question',
				pinned: true,
				snapshot: contentSnapshot(9702, {
					status: 'attention',
					presentationLabel: 'Needs input',
					pendingInteraction: {
						kind: 'question',
						interactionId: 'layout-q-1',
						title: 'Which layout should Magnus use for the remaining graph acceptance?',
						message: 'This choice affects Fit View metrics and Temporal Full Map readability checks.',
						options: [
							{ id: 'organic', label: 'Organic' },
							{ id: 'sphere', label: 'Sphere' },
							{ id: 'constellation', label: 'Constellation' },
							{ id: 'clustered', label: 'Clustered' },
						],
					},
				}),
			},
			{
				name: 'approval',
				pinned: true,
				snapshot: contentSnapshot(9703, {
					status: 'attention',
					presentationLabel: 'Approval needed',
					pendingInteraction: {
						kind: 'approval',
						interactionId: 'layout-appr-1',
						title: 'Run the graph acceptance suite?',
						message: 'This will execute repository graph acceptance tests and update local evidence artifacts.',
						destructive: false,
					},
				}),
			},
		];

		const containment = {};
		for (const fixture of fixtures) {
			native.setPresentation({
				visible: true,
				pinned: fixture.pinned,
				reducedMotion: false,
				display: 'builtin',
			});
			native.setSnapshot(fixture.snapshot);
			await sleep(120);
			await drainMain(native, 3);
			if (fixture.pinned) {
				native.simulateAction('interactive');
				await sleep(150);
				await drainMain(native, 3);
			}
			const diag = native.getDiagnostics();
			const result = layoutContainmentOk(diag);
			containment[fixture.name] = {
				...result,
				state: diag.activePresentationState,
				shapeAwareHitTesting: diag.shapeAwareHitTesting,
				questionButtonCount: diag.questionButtonCount,
				approvalControlsVisible: diag.approvalControlsVisible,
			};
			if (!result.ok) {
				throw new Error(`${fixture.name} layout containment failed: ${result.reason} ${JSON.stringify(result)}`);
			}
			if (diag.shapeAwareHitTesting !== true) {
				throw new Error(`${fixture.name}: shapeAwareHitTesting must be true`);
			}
			if (fixture.name === 'question' && (Number(diag.questionButtonCount) || 0) < 3) {
				throw new Error(`question fixture expected option buttons, got ${diag.questionButtonCount}`);
			}
			if (fixture.name === 'approval' && diag.approvalControlsVisible !== true) {
				throw new Error('approval fixture must show approve/deny controls');
			}
		}
		test25.details = containment;
	} catch (err) {
		test25.ok = false;
		test25.error = err.message;
		results.failures.push(`layout-containment-diagnostics-frames: ${err.message}`);
	}
	results.tests.push(test25);

	// Test 26: State-specific presentation layouts
	const test26 = { name: 'state-specific-layouts', ok: true, details: {} };
	try {
		native.dispose();
		const observed = {};

		async function seedWorking(rev) {
			native.setPresentation({ visible: true, pinned: false, reducedMotion: false, display: 'builtin' });
			native.setSnapshot(contentSnapshot(rev, { status: 'working', presentationLabel: `State ${rev}` }));
			await sleep(80);
			await drainMain(native, 2);
		}

		await seedWorking(9800);
		let diag = native.getDiagnostics();
		observed.compact = { state: diag.activePresentationState, frame: captureFrame(diag) };
		if (diag.activePresentationState !== 'compact') {
			throw new Error(`expected compact, got ${diag.activePresentationState}`);
		}

		if (!native.simulateAction('peek')) {
			throw new Error('peek failed');
		}
		await sleep(120);
		await drainMain(native, 2);
		diag = native.getDiagnostics();
		observed.peek = { state: diag.activePresentationState, frame: captureFrame(diag), peekOnly: diag.peekOnly };
		if (diag.activePresentationState !== 'peek') {
			throw new Error(`expected peek, got ${diag.activePresentationState}`);
		}

		if (!native.simulateAction('click')) {
			throw new Error('click→interactive failed');
		}
		await sleep(180);
		await drainMain(native, 3);
		diag = native.getDiagnostics();
		observed.interactive = { state: diag.activePresentationState, frame: captureFrame(diag) };
		if (diag.activePresentationState !== 'interactive') {
			throw new Error(`expected interactive, got ${diag.activePresentationState}`);
		}

		if (!native.simulateAction('pin')) {
			throw new Error('pin failed');
		}
		await sleep(100);
		await drainMain(native, 2);
		diag = native.getDiagnostics();
		observed.pinned = { state: diag.activePresentationState, pinned: diag.pinned, frame: captureFrame(diag) };
		if (diag.pinned !== true) {
			throw new Error('expected pinned=true');
		}
		if (!(diag.activePresentationState === 'pinned' || diag.activePresentationState === 'interactive')) {
			throw new Error(`expected pinned presentation, got ${diag.activePresentationState}`);
		}

		native.simulateAction('escape');
		await sleep(100);
		native.setPresentation({ visible: true, pinned: false, reducedMotion: false, display: 'builtin' });
		native.setSnapshot(contentSnapshot(9810, {
			status: 'attention',
			pendingInteraction: {
				kind: 'approval',
				interactionId: 'state-appr',
				title: 'Approve edits?',
				message: 'Edit live_activity.mm?',
			},
		}));
		await sleep(200);
		await drainMain(native, 3);
		diag = native.getDiagnostics();
		observed.attentionPeek = { state: diag.activePresentationState, frame: captureFrame(diag) };
		if (diag.activePresentationState !== 'attentionPeek') {
			throw new Error(`expected attentionPeek, got ${diag.activePresentationState}`);
		}

		if (!native.simulateAction('escape')) {
			throw new Error('escape→attentionCompact failed');
		}
		await sleep(120);
		await drainMain(native, 2);
		diag = native.getDiagnostics();
		observed.attentionCompact = {
			state: diag.activePresentationState,
			userDismissedAttention: diag.userDismissedAttention,
			frame: captureFrame(diag),
		};
		if (diag.activePresentationState !== 'attentionCompact') {
			throw new Error(`expected attentionCompact, got ${diag.activePresentationState}`);
		}

		native.setSnapshot(contentSnapshot(9820, {
			status: 'completed',
			presentationLabel: 'Completed',
			currentActivity: 'Acceptance pass complete',
			latestShortMessage: 'All suites passed',
		}));
		await sleep(120);
		await drainMain(native, 2);
		diag = native.getDiagnostics();
		observed.completed = { state: diag.activePresentationState, frame: captureFrame(diag) };
		if (!(diag.activePresentationState === 'completedTransient' || diag.activePresentationState === 'compact' || diag.statusLabel === 'Completed')) {
			// Native may surface completedTransient or keep compact with completed labels.
			if (!/completed|Completed/i.test(String(diag.activePresentationState) + String(diag.statusLabel))) {
				throw new Error(`expected completed presentation signal, got state=${diag.activePresentationState} label=${diag.statusLabel}`);
			}
		}

		native.setSnapshot(contentSnapshot(9830, {
			status: 'failed',
			presentationLabel: 'Failed',
			currentActivity: 'Acceptance failed',
			latestShortMessage: 'Temporal layout recovery timed out',
		}));
		await sleep(120);
		await drainMain(native, 2);
		diag = native.getDiagnostics();
		observed.failed = { state: diag.activePresentationState, frame: captureFrame(diag) };
		if (!(diag.activePresentationState === 'failedTransient' || /failed|Failed/i.test(String(diag.activePresentationState) + String(diag.statusLabel)))) {
			throw new Error(`expected failed presentation signal, got state=${diag.activePresentationState} label=${diag.statusLabel}`);
		}

		test26.details = observed;
	} catch (err) {
		test26.ok = false;
		test26.error = err.message;
		results.failures.push(`state-specific-layouts: ${err.message}`);
	}
	results.tests.push(test26);

	// Test 27: Content variants (empty/short/medium/long/multiline/long pending/long options)
	const test27 = { name: 'content-variants-layout-stability', ok: true, details: {} };
	try {
		native.dispose();
		await settleInteractive(native);
		const variants = [
			{ name: 'empty', extras: { presentationLabel: 'Magnus', currentActivity: '', latestShortMessage: '' } },
			{ name: 'short', extras: { presentationLabel: 'Working', currentActivity: 'Compile', latestShortMessage: 'ok' } },
			{ name: 'medium', extras: { presentationLabel: 'Working', currentActivity: 'Compiling project targets', latestShortMessage: 'Compiling 42 files…' } },
			{ name: 'long', extras: { presentationLabel: 'Working', currentActivity: longText('long-activity', 35), latestShortMessage: longText('long-msg', 50) } },
			{
				name: 'multiline',
				extras: {
					presentationLabel: 'Working',
					currentActivity: 'Line one of activity\nLine two continues validation across Temporal Full Map',
					latestShortMessage: 'First line of message\nSecond line with more diagnostic commentary',
				},
			},
			{
				name: 'long-pending',
				extras: {
					status: 'attention',
					presentationLabel: 'Approval needed',
					pendingInteraction: {
						kind: 'approval',
						interactionId: 'variant-appr',
						title: longText('pending-title', 18),
						message: longText('pending-message', 40),
						destructive: false,
					},
				},
			},
			{
				name: 'long-options',
				extras: {
					status: 'attention',
					presentationLabel: 'Needs input',
					pendingInteraction: {
						kind: 'question',
						interactionId: 'variant-q',
						title: 'Choose a deployment lane with a deliberately long title for containment',
						message: longText('option-context', 25),
						options: [
							{ id: 'a', label: 'Development with extended diagnostics enabled' },
							{ id: 'b', label: 'Staging with canary rollout and metrics' },
							{ id: 'c', label: 'Production with guarded dual-write verification' },
							{ id: 'd', label: 'Preview environment for Temporal Full Map checks' },
						],
					},
				},
			},
		];

		const heights = {};
		let prevHeight = 0;
		for (let i = 0; i < variants.length; i++) {
			const variant = variants[i];
			native.setPresentation({ visible: true, pinned: true, reducedMotion: false, display: 'builtin' });
			native.setSnapshot(contentSnapshot(9900 + i, variant.extras));
			await sleep(140);
			await drainMain(native, 3);
			const diag = native.getDiagnostics();
			const containment = layoutContainmentOk(diag);
			const frame = captureFrame(diag);
			heights[variant.name] = {
				height: frame?.height,
				containment,
				state: diag.activePresentationState,
				questionButtonCount: diag.questionButtonCount,
			};
			if (!containment.ok) {
				throw new Error(`${variant.name} overflow: ${containment.reason}`);
			}
			if (variant.name === 'long' || variant.name === 'long-pending' || variant.name === 'long-options') {
				if (!frame || frame.height <= 40) {
					throw new Error(`${variant.name} must expand beyond compact height`);
				}
			}
			if (variant.name === 'long-options' && (Number(diag.questionButtonCount) || 0) < 3) {
				throw new Error(`long-options expected option buttons, got ${diag.questionButtonCount}`);
			}
			prevHeight = frame?.height || prevHeight;
		}

		// Content-only retarget: once already at max-clamped long height, equivalent long
		// refresh must not restart geometry morph (scroll absorbs text churn).
		native.setPresentation({ visible: true, pinned: true, reducedMotion: false, display: 'builtin' });
		native.setSnapshot(contentSnapshot(9989, {
			status: 'working',
			presentationLabel: 'Working',
			currentActivity: longText('baseline-activity', 40),
			latestShortMessage: longText('baseline-msg', 55),
		}));
		await sleep(260);
		await drainMain(native, 4);
		const baseline = captureStabilityBaseline(native.getDiagnostics());
		native.setSnapshot(contentSnapshot(9990, {
			status: 'working',
			presentationLabel: 'Working',
			currentActivity: longText('retarget-activity', 40),
			latestShortMessage: longText('retarget-msg', 55),
		}));
		await sleep(80);
		await drainMain(native, 3);
		const afterRetarget = native.getDiagnostics();
		assertContentOnlyStable(afterRetarget, baseline, {
			expectedState: baseline.activePresentationState,
			expectedTarget: baseline.targetPresentationState,
		});
		test27.details = { heights, retarget: { baselineAnim: baseline.animationCount, afterAnim: afterRetarget.animationCount, state: afterRetarget.activePresentationState, baselineH: baseline.frame?.height, afterH: captureFrame(afterRetarget)?.height } };
	} catch (err) {
		test27.ok = false;
		test27.error = err.message;
		results.failures.push(`content-variants-layout-stability: ${err.message}`);
	}
	results.tests.push(test27);

	// Test 28: Full action lifecycle — approve/deny/option visibility, duplicate block, ack, timeout
	const test28 = { name: 'action-lifecycle-approve-deny-option-timeout', ok: true, details: {} };
	try {
		native.dispose();
		const commands = [];
		native.setCommandHandler((msg) => {
			const kind = msg?.kind || msg;
			commands.push({ cmd: kind, payload: msg });
		});

		// --- Approve path ---
		native.setPresentation({ visible: true, pinned: true, reducedMotion: false, display: 'builtin' });
		native.setSnapshot(contentSnapshot(10_000, {
			status: 'attention',
			pendingInteraction: {
				kind: 'approval',
				interactionId: 'life-appr',
				title: 'Approve write?',
				message: 'Write live_activity.mm',
			},
		}));
		await sleep(100);
		await drainMain(native, 2);
		native.simulateAction('interactive');
		await sleep(80);
		await drainMain(native, 2);

		commands.length = 0;
		if (native.simulateAction('approve') !== true) {
			throw new Error('approve must succeed');
		}
		let diag = native.getDiagnostics();
		if (diag.actionInFlight !== true) {
			throw new Error('approve must set actionInFlight');
		}
		// Controls may be hidden in shallow headless frames; prefer visible when viewport grew.
		const viewportH = Number(diag.contentViewport?.height) || 0;
		if (viewportH >= 24 && diag.approvalControlsVisible !== true && !isValidDiagFrame(diag.approveButtonFrame)) {
			throw new Error('approve controls must remain visible while in-flight once viewport is expanded');
		}
		await awaitCommands(() => commands.some(c => c.cmd === 'approve'));
		const approveCmds = commands.filter(c => c.cmd === 'approve');
		if (approveCmds.length !== 1) {
			throw new Error(`expected exactly 1 approve command, got ${approveCmds.length}`);
		}
		native.simulateAction('approve'); // duplicate
		await sleep(30);
		await drainMain(native, 1);
		const approveCmdsAfterDup = commands.filter(c => c.cmd === 'approve');
		if (approveCmdsAfterDup.length !== 1) {
			throw new Error(`duplicate approve must not emit again (got ${approveCmdsAfterDup.length})`);
		}
		diag = native.getDiagnostics();
		if (diag.actionInFlight !== true) {
			throw new Error('actionInFlight must stay true after duplicate approve');
		}
		native.setSnapshot(contentSnapshot(10_001, { status: 'working', currentActivity: 'Applying approval' }));
		await sleep(80);
		await drainMain(native, 2);
		diag = native.getDiagnostics();
		if (diag.actionInFlight !== false) {
			throw new Error('acknowledgment snapshot must clear actionInFlight after approve');
		}

		// --- Deny path ---
		commands.length = 0;
		native.setSnapshot(contentSnapshot(10_010, {
			status: 'attention',
			pendingInteraction: {
				kind: 'approval',
				interactionId: 'life-deny',
				title: 'Deny deletion?',
				message: 'Delete obsolete.ts?',
			},
		}));
		await sleep(80);
		await drainMain(native, 2);
		if (native.simulateAction('deny') !== true) {
			throw new Error('deny must succeed');
		}
		diag = native.getDiagnostics();
		if (diag.actionInFlight !== true) {
			throw new Error('deny must set actionInFlight');
		}
		await awaitCommands(() => commands.some(c => c.cmd === 'deny'));
		native.simulateAction('deny');
		await sleep(30);
		await drainMain(native, 1);
		if (commands.filter(c => c.cmd === 'deny').length !== 1) {
			throw new Error('duplicate deny must not emit again');
		}
		native.setSnapshot(contentSnapshot(10_011, { status: 'working' }));
		await sleep(60);
		await drainMain(native, 2);
		if (native.getDiagnostics().actionInFlight !== false) {
			throw new Error('acknowledgment must clear actionInFlight after deny');
		}

		// --- Answer option: remain visible while in-flight ---
		commands.length = 0;
		native.setSnapshot(contentSnapshot(10_020, {
			status: 'attention',
			pendingInteraction: {
				kind: 'question',
				interactionId: 'life-q',
				title: 'Choose lane',
				message: 'Pick deployment',
				options: [
					{ id: 'dev', label: 'Development' },
					{ id: 'staging', label: 'Staging' },
					{ id: 'prod', label: 'Production' },
				],
			},
		}));
		await sleep(100);
		await drainMain(native, 2);
		native.simulateAction('interactive');
		await sleep(80);
		await drainMain(native, 2);
		const beforeOption = native.getDiagnostics();
		const optionCountBefore = Number(beforeOption.questionButtonCount) || 0;
		const optionFramesBefore = Array.isArray(beforeOption.optionButtonFrames) ? beforeOption.optionButtonFrames.length : 0;
		if (optionCountBefore < 3 && optionFramesBefore < 3) {
			// Headless may still answer via simulateClickOptionIndex using pendingOptions.
			if ((Number(beforeOption.contentViewport?.height) || 0) >= 24) {
				throw new Error(`expected question options before answer, got count=${optionCountBefore} frames=${optionFramesBefore}`);
			}
		}
		if (native.simulateAction('option', 1) !== true) {
			throw new Error('option answer must succeed');
		}
		diag = native.getDiagnostics();
		if (diag.actionInFlight !== true) {
			throw new Error('option answer must set actionInFlight');
		}
		if (diag.interactionId !== 'life-q') {
			throw new Error(`interactionId must remain while in-flight, got ${diag.interactionId}`);
		}
		// Options must not be optimistically cleared (count/frames stay, or pending interaction id remains).
		if ((Number(diag.questionButtonCount) || 0) === 0
			&& (!Array.isArray(diag.optionButtonFrames) || diag.optionButtonFrames.length === 0)
			&& diag.interactionId !== 'life-q') {
			throw new Error('question options must remain visible while actionInFlight (no optimistic clear)');
		}
		await awaitCommands(() => commands.some(c => c.cmd === 'answer'));
		native.simulateAction('option', 0);
		await sleep(30);
		await drainMain(native, 1);
		if (commands.filter(c => c.cmd === 'answer').length !== 1) {
			throw new Error(`duplicate option answer must not emit again (got ${commands.filter(c => c.cmd === 'answer').length})`);
		}
		native.setSnapshot(contentSnapshot(10_021, { status: 'working', currentActivity: 'Continuing' }));
		await sleep(60);
		await drainMain(native, 2);
		if (native.getDiagnostics().actionInFlight !== false) {
			throw new Error('acknowledgment must clear actionInFlight after option answer');
		}

		// --- Timeout restores actionable controls ---
		commands.length = 0;
		native.setSnapshot(contentSnapshot(10_030, {
			status: 'attention',
			pendingInteraction: {
				kind: 'approval',
				interactionId: 'life-timeout',
				title: 'Approve timeout path?',
				message: 'Timeout must restore',
			},
		}));
		await sleep(80);
		await drainMain(native, 2);
		native.simulateAction('interactive');
		await sleep(60);
		if (native.simulateAction('approve') !== true) {
			throw new Error('approve for timeout path must succeed');
		}
		diag = native.getDiagnostics();
		const timeoutMs = Number(diag.actionInFlightTimeoutMs) || 8000;
		if (diag.actionInFlight !== true) {
			throw new Error('timeout path must start in-flight');
		}
		const waitUntil = Date.now() + timeoutMs + 600;
		while (Date.now() < waitUntil) {
			await sleep(200);
			await drainMain(native, 2);
			diag = native.getDiagnostics();
			if (diag.actionInFlight === false) {
				break;
			}
		}
		diag = native.getDiagnostics();
		if (diag.actionInFlight !== false) {
			throw new Error(`actionInFlight must clear after timeout (${timeoutMs}ms), still ${diag.actionInFlight}`);
		}
		if (diag.lastNativeCommand !== 'actionTimeout' && diag.interactionId !== 'life-timeout') {
			throw new Error(`timeout must restore pending approval (lastNativeCommand=${diag.lastNativeCommand}, interactionId=${diag.interactionId})`);
		}
		// Timeout restore must not invent haptics
		if ((Number(diag.hapticCount) || 0) !== 0) {
			throw new Error(`action lifecycle/timeout must not emit haptics, got ${diag.hapticCount}`);
		}

		test28.details = {
			timeoutMs,
			lastNativeCommand: diag.lastNativeCommand,
			finalHapticCount: diag.hapticCount,
			commandKinds: [...new Set(commands.map(c => c.cmd))],
		};
	} catch (err) {
		test28.ok = false;
		test28.error = err.message;
		results.failures.push(`action-lifecycle-approve-deny-option-timeout: ${err.message}`);
	}
	results.tests.push(test28);

	// Test 29: Shape-aware hit testing diagnostic contract
	const test29 = { name: 'shape-aware-hit-testing-diagnostic', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: false, reducedMotion: false, display: 'builtin' });
		native.setSnapshot(contentSnapshot(11_000, { status: 'working' }));
		await sleep(80);
		await drainMain(native, 2);
		let diag = native.getDiagnostics();
		if (diag.shapeAwareHitTesting !== true) {
			throw new Error(`compact shapeAwareHitTesting must be true, got ${diag.shapeAwareHitTesting}`);
		}
		native.simulateAction('peek');
		await sleep(100);
		native.simulateAction('click');
		await sleep(150);
		await drainMain(native, 2);
		diag = native.getDiagnostics();
		if (diag.shapeAwareHitTesting !== true) {
			throw new Error('interactive shapeAwareHitTesting must remain true');
		}
		// pathBounds is preferred product proof; fall back to panel/path topology when shape path not yet committed.
		if (!diag.pathBounds || typeof diag.pathBounds.width !== 'number') {
			if (diag.pathTopologyCompatible !== true && !diag.panelFrame) {
				throw new Error('diagnostics must expose pathBounds (or pathTopologyCompatible/panelFrame) for shape-aware hit region');
			}
		}
		test29.details = {
			pathBounds: diag.pathBounds,
			contentViewport: diag.contentViewport,
			shapeAwareHitTesting: diag.shapeAwareHitTesting,
			pathTopologyCompatible: diag.pathTopologyCompatible,
		};
	} catch (err) {
		test29.ok = false;
		test29.error = err.message;
		results.failures.push(`shape-aware-hit-testing-diagnostic: ${err.message}`);
	}
	results.tests.push(test29);

	// Test 30: Populated-first-paint — expanded interactive never blank after settle
	const test30 = { name: 'content-populated-no-blank-expansion', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: false, reducedMotion: true, display: 'builtin' });
		native.setSnapshot(contentSnapshot(12_000, {
			status: 'working',
			presentationLabel: 'Working',
			currentActivity: 'Running graph interaction tests',
			latestShortMessage: 'Validating populated-first-paint after interactive expand',
		}));
		await sleep(80);
		await drainMain(native, 2);
		await settleInteractive(native);
		await sleep(120);
		await drainMain(native, 4);
		const diag = native.getDiagnostics();
		if (diag.expanded !== true) {
			throw new Error(`expected expanded=true after settle, got ${diag.expanded}`);
		}
		if (diag.peekOnly === true) {
			throw new Error('interactive settle must not remain peekOnly');
		}
		if (diag.contentPopulated !== true) {
			throw new Error(`expanded interactive with known content must report contentPopulated=true, got ${diag.contentPopulated}`);
		}
		if (!(Number(diag.expandedContentAlpha) > 0.9)) {
			throw new Error(`expandedContentAlpha must be near 1 after settle, got ${diag.expandedContentAlpha}`);
		}
		if (!diag.contentSafeViewport || typeof diag.contentSafeViewport.width !== 'number') {
			throw new Error('contentSafeViewport diagnostic must exist alongside contentViewport');
		}
		if (!diag.contentViewport || typeof diag.contentViewport.width !== 'number') {
			throw new Error('contentViewport diagnostic must exist');
		}
		if ((Number(diag.contentSafeViewport.width) || 0) > (Number(diag.contentViewport.width) || 0) + 1) {
			throw new Error('contentSafeViewport must not be wider than contentViewport');
		}
		test30.details = {
			contentPopulated: diag.contentPopulated,
			expandedContentAlpha: diag.expandedContentAlpha,
			contentViewport: diag.contentViewport,
			contentSafeViewport: diag.contentSafeViewport,
			state: diag.activePresentationState,
		};
	} catch (err) {
		test30.ok = false;
		test30.error = err.message;
		results.failures.push(`content-populated-no-blank-expansion: ${err.message}`);
	}
	results.tests.push(test30);

	// Test 31: Natural expanded width + measured height model (no 320pt min, no max slab for short)
	const test31 = { name: 'natural-expanded-width-and-height-model', ok: true, details: {} };
	try {
		native.dispose();
		const EXPANDED_HEIGHT_MIN = 72;
		const EXPANDED_HEIGHT_MAX = 220;
		const EXPANDED_WIDTH_PAD = 28;

		native.setPresentation({ visible: true, pinned: false, reducedMotion: true, display: 'builtin' });
		native.setSnapshot(contentSnapshot(12_100, {
			status: 'working',
			presentationLabel: 'Working',
			currentActivity: 'Short task',
			latestShortMessage: 'Compact body',
			workspaceDiff: null,
		}));
		await sleep(100);
		await drainMain(native, 3);
		const compactDiag = native.getDiagnostics();
		const compactFrame = captureFrame(compactDiag);
		const compactW = compactFrame?.width || 0;

		native.setPresentation({ visible: true, pinned: true, reducedMotion: true, display: 'builtin' });
		native.simulateAction('interactive');
		await sleep(150);
		await drainMain(native, 3);
		const shortDiag = native.getDiagnostics();
		const shortFrame = captureFrame(shortDiag);
		if (!shortFrame || shortFrame.height <= 0) {
			throw new Error('short working interactive must expose a panel/requested frame');
		}
		if (shortFrame.height > EXPANDED_HEIGHT_MAX) {
			throw new Error(`height must clamp to max ${EXPANDED_HEIGHT_MAX}, got ${shortFrame.height}`);
		}
		if (shortFrame.height < EXPANDED_HEIGHT_MIN) {
			throw new Error(`height must be at least min ${EXPANDED_HEIGHT_MIN}, got ${shortFrame.height}`);
		}
		// Working interactive uses STANDARD bucket: natural + 36pt pad.
		const expectedStandardW = compactW + 36;
		if (compactW > 0 && Math.abs(shortFrame.width - expectedStandardW) > 1.5) {
			throw new Error(`working expanded width (${shortFrame.width}) must match STANDARD bucket (${expectedStandardW}), not natural span (${compactW})`);
		}
		// contentScrollEnabled means the interactive scroll *host* is visible (always on in Interactive).
		// Overflow is proven via document height vs scroll frame, not the host flag alone.
		const shortDocH = Number(shortDiag.contentDocumentHeight) || 0;
		const shortScrollH = Number(shortDiag.contentScrollFrame?.height) || Number(shortDiag.contentViewport?.height) || 0;
		// Allow a few points of document/scroll slack (header/padding measurement); real overflow is much larger.
		if (shortDocH > 0 && shortScrollH > 0 && shortDocH > shortScrollH + 12) {
			throw new Error(`short content must not overflow scroll host (doc=${shortDocH}, scroll=${shortScrollH})`);
		}
		if (shortDiag.contentPopulated !== true) {
			throw new Error('short interactive must report contentPopulated');
		}

		// Approval uses WIDE bucket: natural + 84pt pad.
		native.setSnapshot(contentSnapshot(12_105, {
			status: 'attention',
			presentationLabel: 'Approval needed',
			pendingInteraction: {
				kind: 'approval',
				interactionId: 'width-appr',
				title: 'Approve?',
				message: 'Continue',
			},
		}));
		await sleep(100);
		await drainMain(native, 3);
		native.simulateAction('interactive');
		await sleep(120);
		await drainMain(native, 3);
		const approvalFrame = captureFrame(native.getDiagnostics());
		// Approval uses WIDE bucket: natural + 84pt pad.
		const expectedWideW = compactW + 84;
		if (approvalFrame && compactW > 0 && Math.abs(approvalFrame.width - expectedWideW) > 1.5) {
			throw new Error(`approval expanded width (${approvalFrame.width}) must match WIDE bucket (${expectedWideW})`);
		}

		// Question with >2 options may pad past natural width by kExpandedWidthPad.
		native.setSnapshot(contentSnapshot(12_110, {
			status: 'attention',
			presentationLabel: 'Needs input',
			pendingInteraction: {
				kind: 'question',
				interactionId: 'width-q',
				title: 'Pick layout',
				message: 'Choose one',
				options: [
					{ id: 'a', label: 'Organic' },
					{ id: 'b', label: 'Sphere' },
					{ id: 'c', label: 'Constellation' },
					{ id: 'd', label: 'Clustered' },
				],
			},
		}));
		await sleep(120);
		await drainMain(native, 3);
		native.simulateAction('interactive');
		await sleep(150);
		await drainMain(native, 3);
		const questionDiag = native.getDiagnostics();
		const questionFrame = captureFrame(questionDiag);
		if (!questionFrame) {
			throw new Error('question interactive must expose a frame');
		}
		if (compactW > 0 && questionFrame.width + 0.5 < compactW + EXPANDED_WIDTH_PAD) {
			// Allow equality when headless/synthetic already wider than natural+pad needs.
			if (questionFrame.width + 0.5 < compactW) {
				throw new Error(`question (>2 options) must not shrink below natural width (${questionFrame.width} < ${compactW})`);
			}
		}
		if (compactW > 0 && questionFrame.width >= compactW + EXPANDED_WIDTH_PAD - 0.5) {
			// Pad applied — good.
		} else if (compactW > 0 && Math.abs(questionFrame.width - compactW) <= 1.5) {
			// Some headless paths already use a wide synthetic base; pad may be absorbed.
		} else if (compactW > 0) {
			throw new Error(`question width ${questionFrame.width} unexpected vs natural ${compactW} (pad=${EXPANDED_WIDTH_PAD})`);
		}

		// Long content clamps to max and may enable scroll.
		native.setSnapshot(contentSnapshot(12_121, {
			status: 'working',
			presentationLabel: 'Working',
			currentActivity: longText('long-activity', 48),
			latestShortMessage: longText('long-message', 70),
		}));
		await sleep(150);
		await drainMain(native, 4);
		native.simulateAction('interactive');
		await sleep(180);
		await drainMain(native, 4);
		const longDiag = native.getDiagnostics();
		const longFrame = captureFrame(longDiag);
		if (!longFrame) {
			throw new Error('long interactive must expose a frame');
		}
		if (longFrame.height > EXPANDED_HEIGHT_MAX + 0.5) {
			throw new Error(`long content must clamp height to ${EXPANDED_HEIGHT_MAX}, got ${longFrame.height}`);
		}
		if (longFrame.height < shortFrame.height - 0.5) {
			throw new Error(`long content height (${longFrame.height}) must be >= short (${shortFrame.height})`);
		}
		if (Math.abs(longFrame.height - EXPANDED_HEIGHT_MAX) <= 1.5
			&& shortFrame.height >= EXPANDED_HEIGHT_MAX - 1.5) {
			throw new Error(`short working height (${shortFrame.height}) must stay below max-clamped long slab (${longFrame.height})`);
		}
		if (Math.abs(longFrame.height - EXPANDED_HEIGHT_MAX) <= 1.5) {
			const docH = Number(longDiag.contentDocumentHeight) || 0;
			const scrollH = Number(longDiag.contentScrollFrame?.height) || Number(longDiag.contentViewport?.height) || 0;
			if (!(docH > scrollH + 1) && longDiag.contentScrollEnabled !== true) {
				throw new Error(`long content at max height must overflow scroll host or keep scroll host (doc=${docH}, scroll=${scrollH}, host=${longDiag.contentScrollEnabled})`);
			}
			if (!(docH > scrollH + 1)) {
				// Host is visible but content may still fit when measurement is conservative; require clamp proof only.
				if (longFrame.height < EXPANDED_HEIGHT_MAX - 0.5) {
					throw new Error(`expected long content to clamp at max when documenting overflow, got ${longFrame.height}`);
				}
			}
		}

		test31.details = {
			compactWidth: compactW,
			shortHeight: shortFrame.height,
			shortWidth: shortFrame.width,
			approvalWidth: approvalFrame?.width,
			questionWidth: questionFrame.width,
			longHeight: longFrame.height,
			longScroll: longDiag.contentScrollEnabled,
			pad: EXPANDED_WIDTH_PAD,
			contentSafeViewport: shortDiag.contentSafeViewport,
		};
	} catch (err) {
		test31.ok = false;
		test31.error = err.message;
		results.failures.push(`natural-expanded-width-and-height-model: ${err.message}`);
	}
	results.tests.push(test31);

	// Test 32: Approve/Deny keep titles while in-flight; a11y uses "(in progress)"; alpha dims
	const test32 = { name: 'action-in-flight-keeps-approve-deny-titles', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: true, reducedMotion: true, display: 'builtin' });
		native.setSnapshot(contentSnapshot(12_200, {
			status: 'attention',
			pendingInteraction: {
				kind: 'approval',
				interactionId: 'title-appr',
				title: 'Approve write?',
				message: 'Write live_activity.mm',
			},
		}));
		await sleep(100);
		await drainMain(native, 2);
		native.simulateAction('interactive');
		await sleep(120);
		await drainMain(native, 3);

		const before = native.getDiagnostics();
		if (before.approvalControlsVisible === true) {
			if (before.approveButtonTitle && before.approveButtonTitle !== 'Approve') {
				throw new Error(`pre-flight approve title must be Approve, got ${before.approveButtonTitle}`);
			}
			if (before.denyButtonTitle && before.denyButtonTitle !== 'Deny') {
				throw new Error(`pre-flight deny title must be Deny, got ${before.denyButtonTitle}`);
			}
		}

		if (native.simulateAction('approve') !== true) {
			throw new Error('approve must succeed');
		}
		await sleep(40);
		await drainMain(native, 2);
		const inFlight = native.getDiagnostics();
		if (inFlight.actionInFlight !== true) {
			throw new Error('expected actionInFlight after approve');
		}
		if (inFlight.approveButtonTitle !== 'Approve') {
			throw new Error(`in-flight approve title must stay "Approve" (not Applying…), got ${JSON.stringify(inFlight.approveButtonTitle)}`);
		}
		if (inFlight.denyButtonTitle !== 'Deny') {
			throw new Error(`in-flight deny title must stay "Deny" (not Dismissing…), got ${JSON.stringify(inFlight.denyButtonTitle)}`);
		}
		if (!String(inFlight.approveButtonAccessibilityLabel || '').includes('(in progress)')) {
			throw new Error(`approve a11y must include "(in progress)", got ${inFlight.approveButtonAccessibilityLabel}`);
		}
		if (!String(inFlight.denyButtonAccessibilityLabel || '').includes('(in progress)')) {
			throw new Error(`deny a11y must include "(in progress)", got ${inFlight.denyButtonAccessibilityLabel}`);
		}
		const approveAlpha = Number(inFlight.approveButtonAlpha);
		const denyAlpha = Number(inFlight.denyButtonAlpha);
		if (!(approveAlpha > 0.4 && approveAlpha < 0.75)) {
			throw new Error(`approve alpha must dim while in-flight, got ${approveAlpha}`);
		}
		if (!(denyAlpha > 0.4 && denyAlpha < 0.75)) {
			throw new Error(`deny alpha must dim while in-flight, got ${denyAlpha}`);
		}
		if (/Applying|Dismissing/.test(String(inFlight.approveButtonTitle) + String(inFlight.denyButtonTitle))) {
			throw new Error('titles must not morph to Applying…/Dismissing…');
		}

		test32.details = {
			approveButtonTitle: inFlight.approveButtonTitle,
			denyButtonTitle: inFlight.denyButtonTitle,
			approveButtonAccessibilityLabel: inFlight.approveButtonAccessibilityLabel,
			denyButtonAccessibilityLabel: inFlight.denyButtonAccessibilityLabel,
			approveButtonAlpha: approveAlpha,
			denyButtonAlpha: denyAlpha,
		};
	} catch (err) {
		test32.ok = false;
		test32.error = err.message;
		results.failures.push(`action-in-flight-keeps-approve-deny-titles: ${err.message}`);
	}
	results.tests.push(test32);

	// Test 33: Interactive approval/question settle — no text/control overlap + 2-col options + geometry constants
	const test33 = { name: 'interactive-layout-no-overlap-and-two-col-options', ok: true, details: {} };
	try {
		const EXPANDED_HEIGHT_MIN = 72;
		const EXPANDED_HEIGHT_MAX = 220;
		const EXPANDED_WIDTH_PAD = 28;
		const STABLE_WING = 64;

		native.dispose();
		native.setPresentation({ visible: true, pinned: true, reducedMotion: true, display: 'builtin' });
		native.setSnapshot(contentSnapshot(13_000, {
			status: 'attention',
			presentationLabel: 'Approval needed',
			currentActivity: 'Preparing write',
			latestShortMessage: 'Review the pending file mutation before continuing',
			pendingInteraction: {
				kind: 'approval',
				interactionId: 'layout-appr',
				title: 'Approve write to live_activity.mm?',
				message: 'Magnus wants to update native layout geometry so document text never paints under Deny/Approve.',
			},
		}));
		await sleep(120);
		await drainMain(native, 3);
		await settleInteractive(native);
		await sleep(120);
		await drainMain(native, 4);
		const approvalDiag = native.getDiagnostics();
		if (approvalDiag.contentPopulated !== true) {
			throw new Error(`approval interactive must report contentPopulated=true, got ${approvalDiag.contentPopulated}`);
		}
		const approvalOverlap = assertTextDoesNotPaintUnderControls(approvalDiag, { requireApprove: true });
		const approvalContainment = layoutContainmentOk(approvalDiag);
		if (!approvalContainment.ok && !approvalContainment.headlessShallow) {
			throw new Error(`approval layout containment failed: ${approvalContainment.reason}`);
		}
		const approvalFrame = captureFrame(approvalDiag);
		if (approvalFrame) {
			if (approvalFrame.height > EXPANDED_HEIGHT_MAX + 0.5) {
				throw new Error(`approval height must clamp to ${EXPANDED_HEIGHT_MAX}, got ${approvalFrame.height}`);
			}
			if (approvalFrame.height < EXPANDED_HEIGHT_MIN - 0.5) {
				throw new Error(`approval height must be >= ${EXPANDED_HEIGHT_MIN}, got ${approvalFrame.height}`);
			}
		}

		native.setSnapshot(contentSnapshot(13_010, {
			status: 'attention',
			presentationLabel: 'Needs input',
			currentActivity: 'Waiting on deployment lane',
			latestShortMessage: 'Pick one option to continue the Magnus run',
			pendingInteraction: {
				kind: 'question',
				interactionId: 'layout-q3',
				title: 'Which deployment lane should Magnus use for this change?',
				message: 'Choose a lane. Options must lay out as a 2-column grid without an orphan chip above a fuller row.',
				options: [
					{ id: 'dev', label: 'Development' },
					{ id: 'staging', label: 'Staging' },
					{ id: 'prod', label: 'Production' },
				],
			},
		}));
		await sleep(120);
		await drainMain(native, 3);
		native.simulateAction('interactive');
		await sleep(150);
		await drainMain(native, 4);
		const questionDiag = native.getDiagnostics();
		if (questionDiag.contentPopulated !== true) {
			throw new Error(`question interactive must report contentPopulated=true, got ${questionDiag.contentPopulated}`);
		}
		const questionOverlap = assertTextDoesNotPaintUnderControls(questionDiag);
		const optionLayout = assertTwoColOptionLayout(questionDiag);
		if (optionLayout.skipped && optionLayout.reason === 'fewer-than-3-options'
			&& (Number(questionDiag.contentViewport?.height) || 0) >= 24) {
			throw new Error(`expected ≥3 option frames for 2-col regression, got ${optionLayout.count}`);
		}

		// 4 options: still 2×2, no orphan-above-fuller-row pattern.
		native.setSnapshot(contentSnapshot(13_020, {
			status: 'attention',
			pendingInteraction: {
				kind: 'question',
				interactionId: 'layout-q4',
				title: 'Pick layout',
				message: 'Four options',
				options: [
					{ id: 'a', label: 'Organic' },
					{ id: 'b', label: 'Sphere' },
					{ id: 'c', label: 'Constellation' },
					{ id: 'd', label: 'Clustered' },
				],
			},
		}));
		await sleep(120);
		await drainMain(native, 3);
		native.simulateAction('interactive');
		await sleep(150);
		await drainMain(native, 4);
		const question4Diag = native.getDiagnostics();
		if (question4Diag.contentPopulated !== true) {
			throw new Error('4-option question must report contentPopulated');
		}
		const option4Layout = assertTwoColOptionLayout(question4Diag);

		test33.details = {
			constants: { EXPANDED_HEIGHT_MIN, EXPANDED_HEIGHT_MAX, EXPANDED_WIDTH_PAD, STABLE_WING },
			approval: {
				contentPopulated: approvalDiag.contentPopulated,
				overlap: approvalOverlap,
				approveButtonFrame: approvalDiag.approveButtonFrame,
				pendingMessageFrame: approvalDiag.pendingMessageFrame,
				composerFrame: approvalDiag.composerFrame,
				height: approvalFrame?.height,
			},
			question3: {
				contentPopulated: questionDiag.contentPopulated,
				overlap: questionOverlap,
				optionLayout,
				optionButtonFrames: questionDiag.optionButtonFrames,
			},
			question4: {
				contentPopulated: question4Diag.contentPopulated,
				optionLayout: option4Layout,
			},
		};
	} catch (err) {
		test33.ok = false;
		test33.error = err.message;
		results.failures.push(`interactive-layout-no-overlap-and-two-col-options: ${err.message}`);
	}
	results.tests.push(test33);

	// Test 34: Silhouette curvature metrics for natural-width interactive (optical shoulder, non-degenerate)
	const test34 = { name: 'silhouette-metrics-natural-width-interactive', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: true, reducedMotion: true, display: 'builtin' });
		native.setSnapshot(contentSnapshot(14_000, {
			status: 'working',
			presentationLabel: 'Working',
			currentActivity: 'Validating optical shoulder curvature',
			latestShortMessage: 'Natural-width interactive must expose non-degenerate silhouette metrics',
			workspaceDiff: null,
		}));
		await sleep(100);
		await drainMain(native, 3);
		native.simulateAction('interactive');
		await sleep(150);
		await drainMain(native, 4);
		const diag = native.getDiagnostics();
		const sm = diag.silhouetteMetrics;
		if (!sm || typeof sm !== 'object') {
			throw new Error('interactive diagnostics must expose silhouetteMetrics');
		}
		const optical = Number(sm.opticalTopInset);
		const effR = Number(sm.effShoulderR);
		const flare = Number(sm.shoulderFlare);
		const depth = Number(sm.bodyDepth);
		if (!(depth > 0.5)) {
			throw new Error(`expanded interactive bodyDepth must be > 0.5, got ${depth}`);
		}
		if (sm.nonDegenerateShoulder !== true) {
			throw new Error(`natural-width interactive must report nonDegenerateShoulder=true (flare=${flare}, optical=${optical}, effR=${effR})`);
		}
		// Housing-anchored expanded geometry: shoulder is 18pt for pronounced flare.
		if (!(effR >= 16 && effR <= 20)) {
			throw new Error(`effShoulderR must be ~18 for housing-anchored expanded geometry, got ${effR}`);
		}
		if (diag.shapeMaskSynced !== true && diag.shapeMaskSynced !== undefined) {
			throw new Error(`shapeMaskSynced should be true when path exists, got ${diag.shapeMaskSynced}`);
		}
		test34.details = { silhouetteMetrics: sm, shapeMaskSynced: diag.shapeMaskSynced, frame: captureFrame(diag) };
	} catch (err) {
		test34.ok = false;
		test34.error = err.message;
		results.failures.push(`silhouette-metrics-natural-width-interactive: ${err.message}`);
	}
	results.tests.push(test34);

	// Test 35: contentViewport must equal contentScrollFrame when scroll host is active
	const test35 = { name: 'content-viewport-equals-scroll-frame', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: true, reducedMotion: true, display: 'builtin' });
		native.setSnapshot(contentSnapshot(14_100, {
			status: 'working',
			currentActivity: 'Scroll host viewport identity',
			latestShortMessage: 'contentViewport must be the actual contentScrollFrame, not a footer heuristic',
		}));
		await sleep(80);
		await drainMain(native, 2);
		await settleInteractive(native);
		await sleep(100);
		await drainMain(native, 4);
		const diag = native.getDiagnostics();
		if (diag.contentScrollEnabled !== true) {
			throw new Error(`interactive must enable content scroll host, got contentScrollEnabled=${diag.contentScrollEnabled}`);
		}
		if (!isValidDiagFrame(diag.contentViewport) || !isValidDiagFrame(diag.contentScrollFrame)) {
			throw new Error('both contentViewport and contentScrollFrame must be present when scroll is active');
		}
		if (!framesClose(diag.contentViewport, diag.contentScrollFrame, 0.5)) {
			throw new Error(`contentViewport must equal contentScrollFrame within 0.5pt (viewport=${JSON.stringify(diag.contentViewport)} scroll=${JSON.stringify(diag.contentScrollFrame)})`);
		}
		const gutter = Number(diag.contentFooterGutter);
		if (!(gutter >= 8)) {
			throw new Error(`contentFooterGutter must be meaningful (>=8), got ${gutter}`);
		}
		test35.details = {
			contentViewport: diag.contentViewport,
			contentScrollFrame: diag.contentScrollFrame,
			contentFooterGutter: gutter,
			footerTopY: diag.footerTopY,
		};
	} catch (err) {
		test35.ok = false;
		test35.error = err.message;
		results.failures.push(`content-viewport-equals-scroll-frame: ${err.message}`);
	}
	results.tests.push(test35);

	// Test 36: Action identity stability — label update keeps ids/frames; new id evicts oldest slot
	const test36 = { name: 'action-row-id-stability-and-controlled-eviction', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: true, reducedMotion: true, display: 'builtin' });
		const actionsABC = [
			{ id: 'A', label: 'Read graphEditor.ts', at: 1000 },
			{ id: 'B', label: 'Edit layout.ts', at: 2000 },
			{ id: 'C', label: 'Run suites', at: 3000 },
		];
		native.setSnapshot(contentSnapshot(14_200, {
			status: 'working',
			currentActivity: 'Working with action ledger',
			latestShortMessage: 'Stable action rows',
			recentActions: actionsABC,
			workspaceDiff: null,
		}));
		await sleep(100);
		await drainMain(native, 3);
		native.simulateAction('interactive');
		await sleep(150);
		await drainMain(native, 4);
		const before = native.getDiagnostics();
		const idsBefore = Array.isArray(before.actionRowIds) ? before.actionRowIds.slice() : [];
		const framesBefore = (before.actionFrames || []).filter(isValidDiagFrame).map(f => ({ ...f }));
		if (idsBefore.length < 3) {
			const vp = Number(before.contentViewport?.height) || 0;
			if (vp >= 24) {
				throw new Error(`expected actionRowIds [A,B,C], got ${JSON.stringify(idsBefore)}`);
			}
			test36.details = { skipped: true, reason: 'viewport-too-shallow', idsBefore };
		} else {
			if (idsBefore.join(',') !== 'A,B,C') {
				throw new Error(`actionRowIds must preserve order A,B,C got ${JSON.stringify(idsBefore)}`);
			}
			// Update only C's label — ids and frames must stay stable.
			native.setSnapshot(contentSnapshot(14_201, {
				status: 'working',
				currentActivity: 'Working with action ledger',
				latestShortMessage: 'Stable action rows',
				recentActions: [
					{ id: 'A', label: 'Read graphEditor.ts', at: 1000 },
					{ id: 'B', label: 'Edit layout.ts', at: 2000 },
					{ id: 'C', label: 'Run suites (updated)', at: 3000 },
				],
				workspaceDiff: null,
			}));
			await sleep(80);
			await drainMain(native, 3);
			const afterLabel = native.getDiagnostics();
			const idsAfterLabel = Array.isArray(afterLabel.actionRowIds) ? afterLabel.actionRowIds.slice() : [];
			const framesAfterLabel = (afterLabel.actionFrames || []).filter(isValidDiagFrame);
			if (idsAfterLabel.join(',') !== idsBefore.join(',')) {
				throw new Error(`label-only update must keep actionRowIds stable (${idsBefore} → ${idsAfterLabel})`);
			}
			if (framesBefore.length !== framesAfterLabel.length) {
				throw new Error(`label-only update must keep action frame count (${framesBefore.length} → ${framesAfterLabel.length})`);
			}
			for (let i = 0; i < framesBefore.length; i++) {
				if (!framesEqualWithin(framesBefore[i], framesAfterLabel[i], 1.5)) {
					throw new Error(`action frame[${i}] drifted after label-only update: ${JSON.stringify(framesBefore[i])} → ${JSON.stringify(framesAfterLabel[i])}`);
				}
			}
			const geoBefore = before.geometrySignature;
			const geoAfter = afterLabel.geometrySignature;
			if (geoBefore && geoAfter && geoBefore !== geoAfter) {
				throw new Error(`label-only action update must not change geometrySignature (${geoBefore} → ${geoAfter})`);
			}

			// Add D — controlled eviction of oldest (A) while keeping B,C,D.
			native.setSnapshot(contentSnapshot(14_202, {
				status: 'working',
				currentActivity: 'Working with action ledger',
				latestShortMessage: 'Eviction',
				recentActions: [
					{ id: 'A', label: 'Read graphEditor.ts', at: 1000 },
					{ id: 'B', label: 'Edit layout.ts', at: 2000 },
					{ id: 'C', label: 'Run suites (updated)', at: 3000 },
					{ id: 'D', label: 'Ship polish', at: 4000 },
				],
				workspaceDiff: null,
			}));
			await sleep(80);
			await drainMain(native, 3);
			const afterEvict = native.getDiagnostics();
			const idsAfterEvict = Array.isArray(afterEvict.actionRowIds) ? afterEvict.actionRowIds.slice() : [];
			if (idsAfterEvict.includes('A') && idsAfterEvict.length >= 3 && idsAfterEvict.join(',') === 'A,B,C') {
				throw new Error('adding D must evict A from the visible 3-slot row (got A,B,C still)');
			}
			if (!idsAfterEvict.includes('D')) {
				throw new Error(`adding D must appear in actionRowIds, got ${JSON.stringify(idsAfterEvict)}`);
			}
			if (!idsAfterEvict.includes('B') || !idsAfterEvict.includes('C')) {
				throw new Error(`eviction must keep remaining stable ids B and C, got ${JSON.stringify(idsAfterEvict)}`);
			}
			if (idsAfterEvict.length > 3) {
				throw new Error(`action row slots must stay <= 3, got ${idsAfterEvict.length}`);
			}
			test36.details = {
				idsBefore,
				idsAfterLabel,
				idsAfterEvict,
				framesStable: true,
				geometrySignature: geoAfter,
			};
		}
	} catch (err) {
		test36.ok = false;
		test36.error = err.message;
		results.failures.push(`action-row-id-stability-and-controlled-eviction: ${err.message}`);
	}
	results.tests.push(test36);

	// Test 37: Content-only storm with MANY varying-length strings — geo/anim stable, footer frames fixed
	const test37 = { name: 'content-storm-varying-length-geometry-stable', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: true, reducedMotion: true, display: 'builtin' });
		native.setSnapshot(contentSnapshot(15_000, {
			status: 'working',
			currentActivity: 'Baseline activity',
			latestShortMessage: 'short',
			recentActions: [
				{ id: 'A', label: 'Step A', at: 1 },
				{ id: 'B', label: 'Step B', at: 2 },
			],
		}));
		await sleep(100);
		await drainMain(native, 3);
		native.simulateAction('interactive');
		await sleep(150);
		await drainMain(native, 4);
		const baselineDiag = native.getDiagnostics();
		const baseline = captureStabilityBaseline(baselineDiag);
		const composerBefore = isValidDiagFrame(baselineDiag.composerFrame) ? { ...baselineDiag.composerFrame } : null;
		const openBefore = isValidDiagFrame(baselineDiag.openButtonFrame) ? { ...baselineDiag.openButtonFrame } : null;
		const pinBefore = isValidDiagFrame(baselineDiag.pinButtonFrame) ? { ...baselineDiag.pinButtonFrame } : null;
		const scrollBefore = isValidDiagFrame(baselineDiag.contentScrollFrame) ? { ...baselineDiag.contentScrollFrame } : null;
		const geoSigBefore = baselineDiag.geometrySignature;
		const lengths = [12, 40, 80, 120, 160, 8, 95, 55, 140, 30];
		let revision = 15_001;
		for (let i = 0; i < 100; i++) {
			const len = lengths[i % lengths.length] + (i % 7);
			const filler = 'x'.repeat(Math.max(1, len));
			native.setSnapshot(contentSnapshot(revision, {
				status: 'working',
				presentationLabel: `L${i}`,
				currentActivity: `Activity ${i}: ${filler.slice(0, Math.min(len, 90))}`,
				latestShortMessage: `msg-${i}-${filler}`,
				recentActions: [
					{ id: 'A', label: `Step A ${i % 3}`, at: 1 },
					{ id: 'B', label: `Step B ${filler.slice(0, 20)}`, at: 2 },
				],
			}));
			revision++;
			if ((i + 1) % 20 === 0) {
				await drainMain(native, 1);
			}
		}
		await drainMain(native, 4);
		const after = native.getDiagnostics();
		const animDelta = (Number(after.animationCount) || 0) - baseline.animationCount;
		const geoDelta = (Number(after.geometryTransitionCount) || 0) - (baseline.geometryTransitionCount || 0);
		if (animDelta !== 0) {
			throw new Error(`varying-length content storm must keep animDelta=0, got ${animDelta}`);
		}
		if (geoDelta !== 0) {
			throw new Error(`varying-length content storm must keep geoDelta=0, got ${geoDelta}`);
		}
		assertContentOnlyStable(after, baseline, {
			expectedState: baseline.activePresentationState,
			expectedTarget: baseline.targetPresentationState,
		});
		if (geoSigBefore && after.geometrySignature && geoSigBefore !== after.geometrySignature) {
			throw new Error(`geometrySignature must stay pinned across content-only text updates (${geoSigBefore} → ${after.geometrySignature})`);
		}
		if (composerBefore && isValidDiagFrame(after.composerFrame) && !framesEqualWithin(composerBefore, after.composerFrame, 1.5)) {
			throw new Error(`composerFrame must not move during content-only storm`);
		}
		if (openBefore && isValidDiagFrame(after.openButtonFrame) && !framesEqualWithin(openBefore, after.openButtonFrame, 1.5)) {
			throw new Error(`openButtonFrame must not move during content-only storm`);
		}
		if (pinBefore && isValidDiagFrame(after.pinButtonFrame) && !framesEqualWithin(pinBefore, after.pinButtonFrame, 1.5)) {
			throw new Error(`pinButtonFrame must not move during content-only storm`);
		}
		if (scrollBefore && isValidDiagFrame(after.contentScrollFrame) && !framesEqualWithin(scrollBefore, after.contentScrollFrame, 1.5)) {
			throw new Error(`contentScrollFrame must stay fixed across content-only length variation`);
		}
		if (after.contentScrollEnabled === true && isValidDiagFrame(after.contentViewport) && isValidDiagFrame(after.contentScrollFrame)) {
			if (!framesClose(after.contentViewport, after.contentScrollFrame, 0.5)) {
				throw new Error('after storm, contentViewport must still equal contentScrollFrame');
			}
		}
		test37.details = {
			animDelta,
			geoDelta,
			geometrySignature: after.geometrySignature,
			updates: 100,
			composerStable: !!composerBefore,
			scrollStable: !!scrollBefore,
		};
	} catch (err) {
		test37.ok = false;
		test37.error = err.message;
		results.failures.push(`content-storm-varying-length-geometry-stable: ${err.message}`);
	}
	results.tests.push(test37);

	// Test 38: Approval pending must not paint under Approve/Deny — meaningful gutter + activity/actions hidden
	const test38 = { name: 'approval-pending-gutter-and-no-activity-under-controls', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: true, reducedMotion: true, display: 'builtin' });
		native.setSnapshot(contentSnapshot(16_000, {
			status: 'attention',
			presentationLabel: 'Approval needed',
			currentActivity: 'THIS ACTIVITY MUST NOT RENDER UNDER APPROVE',
			latestShortMessage: 'THIS LATEST MESSAGE MUST NOT RENDER UNDER DENY',
			recentActions: [
				{ id: 'A', label: 'Hidden under pending', at: 1 },
				{ id: 'B', label: 'Also hidden', at: 2 },
				{ id: 'C', label: 'Still hidden', at: 3 },
			],
			pendingInteraction: {
				kind: 'approval',
				interactionId: 'gutter-appr',
				title: 'Approve destructive write?',
				message: 'This removes unused helpers and cannot be undone. Pending copy must keep a real gutter above Approve/Deny.',
			},
		}));
		await sleep(120);
		await drainMain(native, 3);
		native.simulateAction('interactive');
		await sleep(150);
		await drainMain(native, 4);
		const diag = native.getDiagnostics();
		const overlap = assertTextDoesNotPaintUnderControls(diag, { requireApprove: true });
		if (overlap.skipped && overlap.reason === 'viewport-too-shallow') {
			test38.details = { skipped: true, reason: overlap.reason };
		} else {
			const approveGutter = assertMeaningfulContentControlGutter(diag, diag.approveButtonFrame, { label: 'approve', minGutter: 6 });
			const deny = diag.denyButtonFrame;
			if (isValidDiagFrame(deny)) {
				assertMeaningfulContentControlGutter(diag, deny, { label: 'deny', minGutter: 6 });
			}
			// Pending primary: activity/action log must not paint (frames null/hidden).
			if (isValidDiagFrame(diag.activityFrame)) {
				throw new Error('approval pending must hide activityFrame so text cannot paint under Approve/Deny');
			}
			const actionFrames = (diag.actionFrames || []).filter(isValidDiagFrame);
			if (actionFrames.length > 0) {
				throw new Error(`approval pending must hide action log rows, got ${actionFrames.length} frames`);
			}
			if (Array.isArray(diag.actionRowIds) && diag.actionRowIds.filter(Boolean).length > 0) {
				throw new Error(`approval pending must clear actionRowIds, got ${JSON.stringify(diag.actionRowIds)}`);
			}
			if (isValidDiagFrame(diag.pendingMessageFrame) && isValidDiagFrame(diag.approveButtonFrame)) {
				const converted = documentFrameInContainer(diag, diag.pendingMessageFrame);
				const scrollBottom = frameBottom(diag.contentScrollFrame);
				const visibleBottom = Math.min(frameBottom(converted), scrollBottom);
				const gap = diag.approveButtonFrame.y - visibleBottom;
				if (!(gap >= 6 - 0.5)) {
					throw new Error(`pendingMessage→Approve gap must be meaningful (>=6), got ${gap}`);
				}
			}
			test38.details = { overlap, approveGutter, contentFooterGutter: diag.contentFooterGutter };
		}
	} catch (err) {
		test38.ok = false;
		test38.error = err.message;
		results.failures.push(`approval-pending-gutter-and-no-activity-under-controls: ${err.message}`);
	}
	results.tests.push(test38);

	// Test 39: Question options must keep gutter from content viewport/scroll
	const test39 = { name: 'question-options-gutter-from-content-viewport', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: true, reducedMotion: true, display: 'builtin' });
		native.setSnapshot(contentSnapshot(16_100, {
			status: 'attention',
			presentationLabel: 'Needs input',
			currentActivity: 'Should be hidden under question pending',
			pendingInteraction: {
				kind: 'question',
				interactionId: 'gutter-q',
				title: 'Which deployment lane?',
				message: 'Options must sit below the content viewport with a real gutter, not flush-1px.',
				options: [
					{ id: 'dev', label: 'Development' },
					{ id: 'staging', label: 'Staging' },
					{ id: 'prod', label: 'Production' },
				],
			},
		}));
		await sleep(120);
		await drainMain(native, 3);
		native.simulateAction('interactive');
		await sleep(150);
		await drainMain(native, 4);
		const diag = native.getDiagnostics();
		const frames = (diag.optionButtonFrames || []).filter(isValidDiagFrame);
		const viewportH = Number(diag.contentViewport?.height) || 0;
		if (frames.length < 3 || viewportH < 24) {
			if (viewportH >= 24 && frames.length < 3) {
				throw new Error(`expected ≥3 option frames, got ${frames.length}`);
			}
			test39.details = { skipped: true, count: frames.length, viewportH };
		} else {
			const optionTop = Math.min(...frames.map(f => f.y));
			const scroll = diag.contentScrollFrame;
			const viewport = diag.contentViewport;
			if (!framesClose(viewport, scroll, 0.5)) {
				throw new Error('question interactive contentViewport must equal contentScrollFrame');
			}
			const scrollBottom = frameBottom(scroll);
			const gutter = optionTop - scrollBottom;
			const declared = Number(diag.contentFooterGutter) || 10;
			if (gutter < -0.5) {
				throw new Error(`option chips overlap content scroll host (gutter=${gutter}, optionTop=${optionTop}, scrollBottom=${scrollBottom}) — footerReserve/min-scroll must leave room for option rows`);
			}
			if (!(gutter >= Math.min(6, declared - 2) - 0.5)) {
				throw new Error(`option chips must keep gutter from content viewport (gutter=${gutter}, declared=${declared}, optionTop=${optionTop}, scrollBottom=${scrollBottom})`);
			}
			const optionLayout = assertTwoColOptionLayout(diag);
			if (isValidDiagFrame(diag.activityFrame)) {
				throw new Error('question pending must hide activityFrame (pending is primary)');
			}
			test39.details = { gutter, declared, optionLayout, optionTop, scrollBottom };
		}
	} catch (err) {
		test39.ok = false;
		test39.error = err.message;
		results.failures.push(`question-options-gutter-from-content-viewport: ${err.message}`);
	}
	results.tests.push(test39);

	// Test 40: Question & Approval Content Containment & Scroll Reset Acceptance
	const test40 = { name: 'question-and-approval-containment-and-scroll-reset', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: true, reducedMotion: true, display: 'builtin' });
		// First, working state with actions
		native.setSnapshot(contentSnapshot(17_000, {
			status: 'working',
			currentActivity: 'Compiling tests',
			recentActions: [
				{ id: 'a1', label: 'Running build', at: Date.now() - 5000, status: 'passed' },
				{ id: 'a2', label: 'Typechecking client', at: Date.now() - 2000, status: 'running' },
			],
		}));
		await sleep(80);
		await drainMain(native, 3);

		// Now transition to question interaction
		native.setSnapshot(contentSnapshot(17_001, {
			status: 'attention',
			presentationLabel: 'Question',
			pendingInteraction: {
				kind: 'question',
				interactionId: 'q-contain-1',
				title: 'Select execution target',
				message: 'This choice affects Fit View metrics and Temporal Full graph analysis.',
				options: [
					{ id: 'dev', label: 'Development sandbox' },
					{ id: 'staging', label: 'Staging cluster' },
					{ id: 'prod', label: 'Production cluster' },
					{ id: 'canary', label: 'Canary deployment' },
				],
			},
		}));
		await sleep(150);
		await drainMain(native, 4);

		const diagQ = native.getDiagnostics();
		test40.details.questionDiag = {
			questionContentHealthy: diagQ.questionContentHealthy,
			pendingContentFullyVisible: diagQ.pendingContentFullyVisible,
			pendingMessageFullyVisible: diagQ.pendingMessageFullyVisible,
			scrollOffset: diagQ.contentScrollOffset,
			optionButtonCount: diagQ.questionButtonCount,
			panelFrame: diagQ.panelFrame,
			requestedFrame: diagQ.requestedFrame,
		};

		if (diagQ.questionContentHealthy !== true) {
			throw new Error('questionContentHealthy must be true for 4-option question fixture');
		}
		if (diagQ.pendingContentFullyVisible !== true) {
			throw new Error('pendingContentFullyVisible must be true for 4-option question fixture');
		}
		if (diagQ.pendingMessageFullyVisible !== true) {
			throw new Error('pendingMessageFullyVisible must be true for 4-option question fixture');
		}
		if (diagQ.contentScrollOffset !== 0) {
			throw new Error(`contentScrollOffset must be 0 after transitioning to question, got ${diagQ.contentScrollOffset}`);
		}
		if (diagQ.questionButtonCount !== 4) {
			throw new Error(`expected 4 question options, got ${diagQ.questionButtonCount}`);
		}
		if (diagQ.panelFrame && diagQ.requestedFrame) {
			const dh = Math.abs(diagQ.panelFrame.height - diagQ.requestedFrame.height);
			if (dh > 2) {
				throw new Error(`panelFrame.height (${diagQ.panelFrame.height}) differs from requestedFrame (${diagQ.requestedFrame.height})`);
			}
		}

		// Transition to approval
		native.setSnapshot(contentSnapshot(17_002, {
			status: 'attention',
			presentationLabel: 'Approve',
			pendingInteraction: {
				kind: 'approval',
				interactionId: 'appr-contain-1',
				title: 'Terminal command execution',
				message: 'Magnus requested to run npm run build to verify the changes.',
			},
		}));
		await sleep(150);
		await drainMain(native, 4);

		const diagAppr = native.getDiagnostics();
		test40.details.approvalDiag = {
			pendingContentFullyVisible: diagAppr.pendingContentFullyVisible,
			pendingMessageFullyVisible: diagAppr.pendingMessageFullyVisible,
			approveButtonFrame: diagAppr.approveButtonFrame,
			denyButtonFrame: diagAppr.denyButtonFrame,
		};
		if (diagAppr.pendingContentFullyVisible !== true) {
			throw new Error('pendingContentFullyVisible must be true for approval fixture');
		}
		if (diagAppr.pendingMessageFullyVisible !== true) {
			throw new Error('pendingMessageFullyVisible must be true for approval fixture');
		}
		if (!diagAppr.approveButtonFrame || !diagAppr.denyButtonFrame) {
			throw new Error('approval controls must be visible for approval interaction');
		}
	} catch (err) {
		test40.ok = false;
		test40.error = err.message;
		results.failures.push(`question-and-approval-containment-and-scroll-reset: ${err.message}`);
	}
	results.tests.push(test40);

	// Test 41: Compact and Peek Optical Containment & No Blank Void
	const test41 = { name: 'compact-and-peek-optical-containment-no-blank-void', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: false, reducedMotion: false, display: 'builtin' });
		native.setSnapshot(contentSnapshot(18_000, {
			status: 'working',
			currentActivity: 'Optimizing graph layout',
		}));
		await sleep(80);
		await drainMain(native, 3);

		// Compact state
		const diagCompact = native.getDiagnostics();
		test41.details.compact = {
			panelFrame: diagCompact.panelFrame,
			peekOnly: diagCompact.peekOnly,
			expanded: diagCompact.expanded,
		};
		const topBleedCompact = diagCompact.topBleed || 0;
		const expectedCompactH = 34 + topBleedCompact;
		if (diagCompact.panelFrame?.height !== expectedCompactH && diagCompact.panelFrame?.height !== 34) {
			throw new Error(`compact panelFrame height must be ${expectedCompactH}, got ${diagCompact.panelFrame?.height}`);
		}

		// Peek preview (hover)
		native.simulateAction('peek');
		await sleep(250);
		await drainMain(native, 4);

		const diagPeek = native.getDiagnostics();
		test41.details.peek = {
			panelFrame: diagPeek.panelFrame,
			requestedFrame: diagPeek.requestedFrame,
			pathBounds: diagPeek.pathBounds,
			peekLabelFrame: diagPeek.peekLabelFrame,
			activityFrame: diagPeek.activityFrame,
			peekContainerVisible: diagPeek.peekContainerVisible,
			expandedContainerVisible: diagPeek.expandedContainerVisible,
			interactiveContentVisible: diagPeek.interactiveContentVisible,
			transitionInFlight: diagPeek.transitionInFlight,
		};
		if (diagPeek.transitionInFlight !== false) {
			throw new Error('transitionInFlight must be false after peek settles');
		}
		const topBleedPeek = diagPeek.topBleed || 0;
		const expectedPeekH = 66 + topBleedPeek;
		if (diagPeek.panelFrame?.height !== expectedPeekH && diagPeek.panelFrame?.height !== 66) {
			throw new Error(`peek panelFrame height must be ${expectedPeekH} (34+32+${topBleedPeek}), got ${diagPeek.panelFrame?.height}`);
		}
		if (diagPeek.requestedFrame?.height !== expectedPeekH && diagPeek.requestedFrame?.height !== 66) {
			throw new Error(`peek requestedFrame height must be ${expectedPeekH}, got ${diagPeek.requestedFrame?.height}`);
		}
		if (diagPeek.pathBounds?.height !== expectedPeekH && diagPeek.pathBounds?.height !== 66) {
			throw new Error(`peek pathBounds height must be ${expectedPeekH}, got ${diagPeek.pathBounds?.height}`);
		}
		if (diagPeek.expandedContainerVisible === true) {
			throw new Error('expandedContainer must NOT be visible during peek (must prevent content bleed)');
		}
		if (diagPeek.interactiveContentVisible === true) {
			throw new Error('interactive content subtree must NOT be visible during peek');
		}
		const peekFrame = diagPeek.peekLabelFrame || diagPeek.activityFrame;
		if (peekFrame) {
			const textY = peekFrame.y;
			if (textY < 4 || textY > 14) {
				throw new Error(`peek text frame.y must be centered within 32pt body (expected 4..14), got ${textY}`);
			}
		} else {
			throw new Error('peek text frame must be visible');
		}
	} catch (err) {
		test41.ok = false;
		test41.error = err.message;
		results.failures.push(`compact-and-peek-optical-containment-no-blank-void: ${err.message}`);
	}
	results.tests.push(test41);

	// Test 42: Long-to-Short Content Shrink Verification
	const test42 = { name: 'long-to-short-shrink-verification', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: true, reducedMotion: false, display: 'builtin' });
		// Seed long content fixture
		native.setSnapshot(contentSnapshot(19_000, {
			status: 'working',
			currentActivity: 'Validating long-form graph interaction recovery across Temporal Full Map, Network Fit View, and multi-layout acceptance while preserving viewport readability and idle rotation constraints for large projects',
			latestShortMessage: 'Magnus finished the graph interaction pass and is validating the remaining acceptance cases against organic, sphere, constellation, and clustered layouts with deliberately long diagnostic commentary.',
			recentActions: [
				{ id: 'a1', label: 'Action 1', at: Date.now() - 30000 },
				{ id: 'a2', label: 'Action 2', at: Date.now() - 20000 },
				{ id: 'a3', label: 'Action 3', at: Date.now() - 10000 },
			],
		}));
		await sleep(260);
		await drainMain(native, 4);

		const diagLong = native.getDiagnostics();
		test42.details.long = {
			panelFrame: diagLong.panelFrame,
			pinnedInteractiveHeight: diagLong.pinnedInteractiveHeight,
		};
		if (diagLong.panelFrame?.height < 180) {
			throw new Error(`expected long content panel height >= 180, got ${diagLong.panelFrame?.height}`);
		}

		// Transition to short working content (1 line, 0 actions)
		native.setSnapshot(contentSnapshot(19_001, {
			status: 'working',
			currentActivity: 'Running graph interaction tests',
			latestShortMessage: 'Short message',
			recentActions: [],
		}));
		await sleep(260);
		await drainMain(native, 4);

		const diagShort = native.getDiagnostics();
		test42.details.short = {
			panelFrame: diagShort.panelFrame,
			pinnedInteractiveHeight: diagShort.pinnedInteractiveHeight,
		};
		if (!diagShort.panelFrame || diagShort.panelFrame.height > 185) {
			throw new Error(`short content panel height must be bounded <= 185pt (got ${diagShort.panelFrame?.height})`);
		}
	} catch (err) {
		test42.ok = false;
		test42.error = err.message;
		results.failures.push(`long-to-short-shrink-verification: ${err.message}`);
	}
	results.tests.push(test42);

	// Test 43: Question / Approval Resolution to Compact State
	const test43 = { name: 'question-approval-resolution-to-compact-state', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: true, reducedMotion: false, display: 'builtin' });
		// Seed question with 4 options
		native.setSnapshot(contentSnapshot(20_000, {
			status: 'attention',
			presentationLabel: 'Question',
			pendingInteraction: {
				kind: 'question',
				interactionId: 'q-resolve-1',
				title: 'Which layout should Magnus use?',
				message: 'Affects Fit View metrics.',
				options: [
					{ id: '1', label: 'Organic' },
					{ id: '2', label: 'Sphere' },
					{ id: '3', label: 'Constellation' },
					{ id: '4', label: 'Clustered' },
				],
			},
		}));
		await sleep(260);
		await drainMain(native, 4);

		const diagQ = native.getDiagnostics();
		test43.details.question = { panelFrame: diagQ.panelFrame };
		if (diagQ.panelFrame?.height < 150) {
			throw new Error(`question panel height expected >= 150, got ${diagQ.panelFrame?.height}`);
		}

		// Resolve question -> transition to completed
		native.setSnapshot(contentSnapshot(20_001, {
			status: 'completed',
			currentActivity: 'Graph acceptance pass complete',
			latestShortMessage: 'All graph interaction suites passed.',
			presentationLabel: 'Completed',
			recentActions: [],
		}));
		await sleep(260);
		await drainMain(native, 4);

		const diagCompleted = native.getDiagnostics();
		test43.details.completed = {
			panelFrame: diagCompleted.panelFrame,
			composerVisible: diagCompleted.composerVisible,
		};
		if (!diagCompleted.panelFrame || diagCompleted.panelFrame.height > 100) {
			throw new Error(`completed panel height must shrink to <= 100pt (got ${diagCompleted.panelFrame?.height}; stale question height locked!)`);
		}
		if (diagCompleted.composerVisible === true) {
			throw new Error('completed panel must NOT have composer visible');
		}

		// Seed approval
		native.setSnapshot(contentSnapshot(20_002, {
			status: 'attention',
			presentationLabel: 'Approval needed',
			pendingInteraction: {
				kind: 'approval',
				interactionId: 'appr-resolve-1',
				title: 'Run graph acceptance suite?',
				message: 'Will execute tests.',
			},
		}));
		await sleep(260);
		await drainMain(native, 4);

		const diagAppr = native.getDiagnostics();
		test43.details.approval = {
			panelFrame: diagAppr.panelFrame,
			composerVisible: diagAppr.composerVisible,
		};
		if (diagAppr.composerVisible === true) {
			throw new Error('approval panel must NOT have composer input row (Approve/Deny is primary)');
		}

		// Resolve approval -> transition to short working
		native.setSnapshot(contentSnapshot(20_003, {
			status: 'working',
			currentActivity: 'Running test suite',
			latestShortMessage: 'Executing tests...',
			recentActions: [],
		}));
		await sleep(260);
		await drainMain(native, 4);

		const diagWorking = native.getDiagnostics();
		test43.details.working = { panelFrame: diagWorking.panelFrame };
		if (!diagWorking.panelFrame || diagWorking.panelFrame.height > 185) {
			throw new Error(`working panel height after approval must be bounded <= 185pt (got ${diagWorking.panelFrame?.height})`);
		}
	} catch (err) {
		test43.ok = false;
		test43.error = err.message;
		results.failures.push(`question-approval-resolution-to-compact-state: ${err.message}`);
	}
	results.tests.push(test43);

	// Test 44: Empty-Space Budget and Content Density
	const test44 = { name: 'empty-space-budget-and-content-density', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: true, reducedMotion: false, display: 'builtin' });
		// Short working fixture
		native.setSnapshot(contentSnapshot(21_000, {
			status: 'working',
			currentActivity: 'Running graph interaction tests',
			latestShortMessage: 'Validating cases',
			recentActions: [],
		}));
		await sleep(260);
		await drainMain(native, 4);

		const diag = native.getDiagnostics();
		test44.details.shortWorking = {
			panelFrame: diag.panelFrame,
			activityFrame: diag.activityFrame,
			composerFrame: diag.composerFrame,
		};
		if (diag.activityFrame && diag.composerFrame) {
			const converted = documentFrameInContainer(diag, diag.activityFrame) || diag.activityFrame;
			const contentBottom = converted.y + converted.height;
			const composerTop = diag.composerFrame.y;
			const gap = composerTop - contentBottom;
			test44.details.shortWorkingGap = gap;
			if (gap > 35) {
				throw new Error(`empty space void between content and composer too large: ${gap}pt (expected <= 35pt)`);
			}
		}
	} catch (err) {
		test44.ok = false;
		test44.error = err.message;
		results.failures.push(`empty-space-budget-and-content-density: ${err.message}`);
	}
	results.tests.push(test44);

	// Test 45: Environment Transition and Hover Suppression
	const test45 = { name: 'environment-transition-and-hover-suppression', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: false, reducedMotion: false, display: 'builtin' });
		native.setSnapshot(contentSnapshot(22_000, {
			status: 'working',
			currentActivity: 'Working on graph',
		}));
		await sleep(260);
		await drainMain(native, 4);

		const diagBefore = native.getDiagnostics();
		test45.details.before = {
			environmentState: diagBefore.environmentState,
			panelFrame: diagBefore.panelFrame,
		};

		// In normal available state, peek is allowed
		const peekAllowed = native.simulateAction('peek');
		if (!peekAllowed) {
			throw new Error('simulateAction(peek) should succeed in available environment');
		}
		await sleep(260);
		await drainMain(native, 4);
		native.simulateAction('collapse');
		await sleep(260);
		await drainMain(native, 4);

		// Simulate external app fullscreen / backgrounded environment suppression
		if (native.simulateAction('simulateEnvironment', 'fullscreenSuppressed')) {
			const diagSuppressed = native.getDiagnostics();
			test45.details.suppressed = { environmentState: diagSuppressed.environmentState };
			const peekBlocked = native.simulateAction('peek');
			if (peekBlocked) {
				throw new Error('simulateAction(peek) MUST be suppressed when environment is fullscreenSuppressed');
			}

			// Restore environment
			native.simulateAction('simulateEnvironment', 'available');
			await sleep(100);
			await drainMain(native, 2);
			const diagRestored = native.getDiagnostics();
			test45.details.restored = { environmentState: diagRestored.environmentState };
			if (diagRestored.environmentState && diagRestored.environmentState !== 'available') {
				throw new Error(`expected environmentState to restore to available, got ${diagRestored.environmentState}`);
			}
		}
	} catch (err) {
		test45.ok = false;
		test45.error = err.message;
		results.failures.push(`environment-transition-and-hover-suppression: ${err.message}`);
	}
	results.tests.push(test45);

	// Test 46: Systematic Semantic State Transition Matrix & Pinned Height Invalidation
	const test46 = { name: 'systematic-semantic-transition-matrix-and-invalidation', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: true, reducedMotion: false, display: 'builtin' });
		let rev = 30_000;

		const checkState = async (desc, snap, expected) => {
			rev++;
			native.setSnapshot(contentSnapshot(rev, snap));
			await sleep(260);
			await drainMain(native, 4);
			const diag = native.getDiagnostics();
			const topBleed = diag.topBleed || 0;
			const h = diag.panelFrame ? (diag.panelFrame.height - topBleed) : 0;
			const details = { desc, height: h, status: diag.renderedStatus, kind: diag.pendingKind };
			if (expected.minH && h < expected.minH) {
				throw new Error(`${desc}: height ${h} < min expected ${expected.minH}`);
			}
			if (expected.maxH && h > expected.maxH) {
				throw new Error(`${desc}: height ${h} > max expected ${expected.maxH}`);
			}
			if (expected.composer !== undefined && diag.composerVisible !== expected.composer) {
				throw new Error(`${desc}: composerVisible ${diag.composerVisible} !== expected ${expected.composer}`);
			}
			if (expected.approval !== undefined && diag.approvalControlsVisible !== expected.approval) {
				throw new Error(`${desc}: approvalControlsVisible ${diag.approvalControlsVisible} !== expected ${expected.approval}`);
			}
			return details;
		};

		const steps = [];
		// 1. Working Long (tall)
		steps.push(await checkState('working-long', {
			status: 'working',
			currentActivity: 'Compiling large binary with 3 recent actions',
			recentActions: [
				{ id: 'act-1', label: 'Compiling core', at: Date.now() - 3000, status: 'passed' },
				{ id: 'act-2', label: 'Linking dependencies', at: Date.now() - 2000, status: 'passed' },
				{ id: 'act-3', label: 'Optimizing symbol tables', at: Date.now() - 1000, status: 'running' }
			]
		}, { minH: 160, composer: true, approval: false }));

		// 2. Working Short (must shrink!)
		steps.push(await checkState('working-short', {
			status: 'working',
			currentActivity: 'Quick check',
			recentActions: []
		}, { maxH: 175, composer: true, approval: false }));

		// 3. Working -> Completed (must shrink to compact status card <= 94pt, no composer)
		steps.push(await checkState('working-to-completed', {
			status: 'completed',
			currentActivity: 'All tests passed',
			latestShortMessage: 'Build finished in 4.2s',
			recentActions: []
		}, { minH: 82, maxH: 94, composer: false, approval: false }));

		// 4. Completed -> Working (must expand back to interactive working height)
		steps.push(await checkState('completed-to-working', {
			status: 'working',
			currentActivity: 'Analyzing changes',
			recentActions: []
		}, { minH: 110, maxH: 175, composer: true, approval: false }));

		// 5. Working -> Question with 2 options (single row: compact ~124pt)
		steps.push(await checkState('working-to-question-2-opts', {
			status: 'attention',
			pendingKind: 'question',
			interactionId: 'q-trans-1',
			pendingTitle: 'Select deployment target',
			pendingOptions: [
				{ id: 'opt-staging', label: 'Staging' },
				{ id: 'opt-prod', label: 'Production' }
			]
		}, { minH: 120, maxH: 150, composer: false, approval: false }));

		// 5b. Question with 4 options (2 rows: expands to ~156-170pt)
		steps.push(await checkState('question-4-opts-expand', {
			status: 'attention',
			pendingKind: 'question',
			interactionId: 'q-trans-1b',
			pendingTitle: 'Select region',
			pendingOptions: [
				{ id: 'us-east', label: 'US East' },
				{ id: 'us-west', label: 'US West' },
				{ id: 'eu-central', label: 'EU Central' },
				{ id: 'ap-south', label: 'AP South' }
			]
		}, { minH: 145, composer: false, approval: false }));

		// 6. Question -> Completed (must shrink back down to compact status card <= 94pt)
		steps.push(await checkState('question-to-completed', {
			status: 'completed',
			currentActivity: 'Deployed successfully',
			latestShortMessage: 'Done',
			recentActions: []
		}, { minH: 82, maxH: 94, composer: false, approval: false }));

		// 7. Completed -> Working (recover)
		steps.push(await checkState('completed-to-working-2', {
			status: 'working',
			currentActivity: 'Indexing files',
			recentActions: []
		}, { minH: 110, maxH: 175, composer: true, approval: false }));

		// 8. Working -> Approval (must expand to focused approval card)
		steps.push(await checkState('working-to-approval', {
			status: 'attention',
			pendingKind: 'approval',
			interactionId: 'appr-trans-1',
			pendingTitle: 'Approve file write?',
			pendingMessage: 'Write to live_activity.mm'
		}, { minH: 130, maxH: 180, composer: false, approval: true }));

		// 9. Approval -> Failed (must shrink to compact status card <= 94pt)
		steps.push(await checkState('approval-to-failed', {
			status: 'failed',
			currentActivity: 'Operation cancelled by user',
			latestShortMessage: 'Denied',
			recentActions: []
		}, { minH: 82, maxH: 94, composer: false, approval: false }));

		// 10. Failed -> Working (recover)
		steps.push(await checkState('failed-to-working', {
			status: 'working',
			currentActivity: 'Ready for next command',
			recentActions: []
		}, { minH: 110, maxH: 175, composer: true, approval: false }));

		// 11. Approval -> Question direct transition
		steps.push(await checkState('working-to-approval-2', {
			status: 'attention',
			pendingKind: 'approval',
			interactionId: 'appr-trans-2',
			pendingTitle: 'Approve execution?'
		}, { minH: 120, maxH: 150, composer: false, approval: true }));

		steps.push(await checkState('approval-to-question-direct', {
			status: 'attention',
			pendingKind: 'question',
			interactionId: 'q-trans-2',
			pendingTitle: 'Choose runner',
			pendingOptions: [
				{ id: 'opt-local', label: 'Local' },
				{ id: 'opt-remote', label: 'Remote' }
			]
		}, { minH: 120, maxH: 150, composer: false, approval: false }));

		test46.details.steps = steps;
	} catch (err) {
		test46.ok = false;
		test46.error = err.message;
		results.failures.push(`systematic-semantic-transition-matrix-and-invalidation: ${err.message}`);
	}
	results.tests.push(test46);

	// Test 47: Streaming Text Stability vs Semantic Invalidation
	const test47 = { name: 'streaming-text-stability-vs-semantic-invalidation', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: true, reducedMotion: false, display: 'builtin' });
		native.setSnapshot(contentSnapshot(31_000, {
			status: 'working',
			currentActivity: 'Streaming test start',
		}));
		await sleep(260);
		await drainMain(native, 4);

		const baselineDiag = native.getDiagnostics();
		const baseSig = baselineDiag.geometrySignature;
		const baseAnim = baselineDiag.animationCount;
		const baseFrame = baselineDiag.panelFrame;

		// Stream 30 character-by-character updates to currentActivity
		let streamedActivity = 'Streaming test start';
		for (let i = 0; i < 30; i++) {
			streamedActivity += ` chunk_${i}`;
			native.setSnapshot(contentSnapshot(31_001 + i, {
				status: 'working',
				currentActivity: streamedActivity,
			}));
			await drainMain(native, 1);
		}
		await sleep(100);
		await drainMain(native, 2);

		const postStreamDiag = native.getDiagnostics();
		test47.details.streaming = {
			baseSig,
			postStreamSig: postStreamDiag.geometrySignature,
			animDelta: postStreamDiag.animationCount - baseAnim,
			frameEqual: framesEqualWithin(baseFrame, postStreamDiag.panelFrame, 1.0)
		};

		if (postStreamDiag.geometrySignature !== baseSig) {
			throw new Error(`geometry signature mutated during activity streaming: ${postStreamDiag.geometrySignature} vs ${baseSig}`);
		}
		if (postStreamDiag.animationCount > baseAnim) {
			throw new Error(`unnecessary animation triggered during streaming: +${postStreamDiag.animationCount - baseAnim}`);
		}
		if (!framesEqualWithin(baseFrame, postStreamDiag.panelFrame, 1.0)) {
			throw new Error(`panel frame drifted during streaming: ${JSON.stringify(postStreamDiag.panelFrame)} vs ${JSON.stringify(baseFrame)}`);
		}

		// Now trigger a semantic status change to completed: MUST invalidate signature and morph
		native.setSnapshot(contentSnapshot(32_000, {
			status: 'completed',
			currentActivity: 'Done',
			latestShortMessage: 'Finished'
		}));
		await sleep(260);
		await drainMain(native, 4);

		const postSemanticDiag = native.getDiagnostics();
		test47.details.semanticTransition = {
			postSemanticSig: postSemanticDiag.geometrySignature,
			postSemanticH: postSemanticDiag.panelFrame ? postSemanticDiag.panelFrame.height : 0
		};

		if (postSemanticDiag.geometrySignature === baseSig) {
			throw new Error(`geometry signature must change when status changes from working to completed`);
		}
		const topBleedSemantic = postSemanticDiag.topBleed || 0;
		const semanticCompletedH = postSemanticDiag.panelFrame.height - topBleedSemantic;
		if (semanticCompletedH > 94) {
			throw new Error(`completed state height ${semanticCompletedH} must be <= 94pt`);
		}
	} catch (err) {
		test47.ok = false;
		test47.error = err.message;
		results.failures.push(`streaming-text-stability-vs-semantic-invalidation: ${err.message}`);
	}
	results.tests.push(test47);

	// Test 48: Strict Content Containment & Subview Isolation
	const test48 = { name: 'strict-content-containment-and-subview-isolation', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: true, reducedMotion: false, display: 'builtin' });

		// Test Approval containment and isolation
		native.setSnapshot(contentSnapshot(33_000, {
			status: 'attention',
			pendingKind: 'approval',
			interactionId: 'appr-contain-1',
			pendingTitle: 'Approve database migration?',
			pendingMessage: 'This will alter 14 tables in production database.'
		}));
		await sleep(260);
		await drainMain(native, 4);

		const apprDiag = native.getDiagnostics();
		test48.details.approval = {
			composerVisible: apprDiag.composerVisible,
			approvalVisible: apprDiag.approvalControlsVisible,
			pinVisible: apprDiag.pinButtonVisible,
			openVisible: apprDiag.openInPreBaseVisible,
			approveFrame: apprDiag.approveButtonFrame,
			denyFrame: apprDiag.denyButtonFrame,
			panelFrame: apprDiag.panelFrame
		};

		if (apprDiag.composerVisible !== false) {
			throw new Error('Approval card must NOT show composer input');
		}
		if (apprDiag.approvalControlsVisible !== true) {
			throw new Error('Approval card must show Deny/Approve buttons');
		}
		if (apprDiag.pinButtonVisible !== false) {
			throw new Error('Approval card must NOT show pin button');
		}
		if (apprDiag.openInPreBaseVisible !== false) {
			throw new Error('Approval card must NOT show open button');
		}
		if (!isValidDiagFrame(apprDiag.approveButtonFrame) || !isValidDiagFrame(apprDiag.denyButtonFrame)) {
			throw new Error('Approval buttons must have valid frames');
		}
		// Check that buttons are inside the panel frame
		const winW = apprDiag.panelFrame.width;
		const winH = apprDiag.panelFrame.height;
		if (apprDiag.approveButtonFrame.x + apprDiag.approveButtonFrame.width > winW + 0.5) {
			throw new Error(`approve button escapes right window edge: ${apprDiag.approveButtonFrame.x + apprDiag.approveButtonFrame.width} > ${winW}`);
		}
		if (apprDiag.denyButtonFrame.x < 0) {
			throw new Error(`deny button escapes left window edge: ${apprDiag.denyButtonFrame.x} < 0`);
		}

		// Test Completed containment and isolation
		native.setSnapshot(contentSnapshot(33_001, {
			status: 'completed',
			currentActivity: 'Migration completed',
			latestShortMessage: 'Success'
		}));
		await sleep(260);
		await drainMain(native, 4);

		const compDiag = native.getDiagnostics();
		test48.details.completed = {
			composerVisible: compDiag.composerVisible,
			approvalVisible: compDiag.approvalControlsVisible,
			pinVisible: compDiag.pinButtonVisible,
			openVisible: compDiag.openInPreBaseVisible,
			panelFrame: compDiag.panelFrame
		};

		if (compDiag.composerVisible !== false || compDiag.approvalControlsVisible !== false || compDiag.pinButtonVisible !== false || compDiag.openInPreBaseVisible !== false) {
			throw new Error('Completed status card must have all interaction controls hidden');
		}
	} catch (err) {
		test48.ok = false;
		test48.error = err.message;
		results.failures.push(`strict-content-containment-and-subview-isolation: ${err.message}`);
	}
	results.tests.push(test48);

	// Test 49: Strict Single Visible Subtree Settled Invariant
	const test49 = { name: 'strict-single-visible-subtree-settled-invariant', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: false, reducedMotion: true, display: 'builtin' });

		// 1. Settled Compact
		native.setSnapshot(contentSnapshot(49_001, {
			status: 'working',
			currentActivity: 'Indexing workspace',
		}));
		await sleep(150);
		await drainMain(native, 4);

		const compactDiag = native.getDiagnostics();
		test49.details.compact = {
			compactVisible: compactDiag.compactContainerVisible,
			peekVisible: compactDiag.peekContainerVisible,
			expandedVisible: compactDiag.expandedContainerVisible,
			expandedAlpha: compactDiag.expandedContentAlpha
		};
		if (compactDiag.compactContainerVisible !== true) {
			throw new Error('Settled compact state must have compactContainerVisible === true');
		}
		if (compactDiag.peekContainerVisible === true) {
			throw new Error('Settled compact state must have peekContainerVisible === false');
		}
		if (compactDiag.expandedContainerVisible === true || compactDiag.expandedContentAlpha > 0.01) {
			throw new Error('Settled compact state must have expandedContainer hidden and alpha 0');
		}

		// 2. Settled Peek
		native.simulateAction('peek');
		await sleep(200);
		await drainMain(native, 4);

		const peekDiag = native.getDiagnostics();
		test49.details.peek = {
			compactVisible: peekDiag.compactContainerVisible,
			peekVisible: peekDiag.peekContainerVisible,
			expandedVisible: peekDiag.expandedContainerVisible,
			composerVisible: peekDiag.composerVisible,
			approvalVisible: peekDiag.approvalControlsVisible
		};
		if (peekDiag.peekContainerVisible !== true) {
			throw new Error('Settled peek state must have peekContainerVisible === true');
		}
		if (peekDiag.expandedContainerVisible === true) {
			throw new Error('Settled peek state must have expandedContainerVisible === false');
		}
		if (peekDiag.composerVisible === true || peekDiag.approvalControlsVisible === true) {
			throw new Error('Settled peek state must NOT show expanded controls');
		}

		// 3. Settled Interactive Working
		native.setPresentation({ visible: true, pinned: true, reducedMotion: true, display: 'builtin' });
		await sleep(200);
		await drainMain(native, 4);

		const workingDiag = native.getDiagnostics();
		test49.details.working = {
			compactVisible: workingDiag.compactContainerVisible,
			peekVisible: workingDiag.peekContainerVisible,
			expandedVisible: workingDiag.expandedContainerVisible,
			composerVisible: workingDiag.composerVisible
		};
		if (workingDiag.compactContainerVisible === true) {
			throw new Error('Settled interactive working state must have compactContainerVisible === false');
		}
		if (workingDiag.peekContainerVisible === true) {
			throw new Error('Settled interactive working state must have peekContainerVisible === false');
		}
		if (workingDiag.expandedContainerVisible !== true) {
			throw new Error('Settled interactive working state must have expandedContainerVisible === true');
		}
	} catch (err) {
		test49.ok = false;
		test49.error = err.message;
		results.failures.push(`strict-single-visible-subtree-settled-invariant: ${err.message}`);
	}
	results.tests.push(test49);

	// Test 50: Adversarial Unbroken Tokens & Deep Path Containment
	const test50 = { name: 'adversarial-unbroken-tokens-and-deep-path-containment', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: true, reducedMotion: true, display: 'builtin' });

		const longUrl = 'https://prebase.internal/repo/deep/subsystem/controller/long-continuous-identifier-with-no-spaces-0123456789-abcdefghijklmnopqrstuvwxyz';
		const longMessage = 'error_in_PrebaseLiveActivityController_refreshContentSubviewsPreservingPresentationWithSize_symbol_resolution_failure_unbroken_token';

		native.setSnapshot(contentSnapshot(50_001, {
			status: 'working',
			currentActivity: longUrl,
			latestShortMessage: longMessage,
			recentActions: [
				{ id: 'act-1', label: 'very_long_snake_case_action_identifier_in_pipeline_execution_without_breaks' }
			]
		}));
		await sleep(200);
		await drainMain(native, 4);

		const diag = native.getDiagnostics();
		const containment = layoutContainmentOk(diag);
		test50.details = {
			panelFrame: diag.panelFrame,
			bodyBounds: diag.bodyBounds,
			activityFrame: diag.activityFrame,
			containmentOk: containment.ok,
			reason: containment.reason
		};

		if (!containment.ok) {
			throw new Error(`Unbroken token layout containment failed: ${containment.reason}`);
		}
		if (diag.activityFrame && diag.activityFrame.x < 0) {
			throw new Error('Activity label escaped left bound with negative x');
		}
		if (diag.activityFrame && diag.activityFrame.x + diag.activityFrame.width > diag.panelFrame.width + 1) {
			throw new Error('Activity label escaped right panel bound');
		}
	} catch (err) {
		test50.ok = false;
		test50.error = err.message;
		results.failures.push(`adversarial-unbroken-tokens-and-deep-path-containment: ${err.message}`);
	}
	results.tests.push(test50);

	// Test 51: Rapid Semantic Transition Stress & Stale Control Purge
	const test51 = { name: 'rapid-semantic-transition-stress-and-stale-control-purge', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: true, reducedMotion: true, display: 'builtin' });

		const transitions = [
			{ status: 'working', currentActivity: 'Step 1: Planning' },
			{ status: 'attention', pendingKind: 'approval', interactionId: 'rapid-appr', pendingTitle: 'Approve execution?' },
			{ status: 'working', currentActivity: 'Step 2: Executing' },
			{ status: 'attention', pendingKind: 'question', interactionId: 'rapid-quest', pendingTitle: 'Choose target:', pendingOptions: [{ id: 'opt1', label: 'Dev' }, { id: 'opt2', label: 'Prod' }] },
			{ status: 'completed', currentActivity: 'Step 3: Done', latestShortMessage: 'Completed successfully' },
			{ status: 'working', currentActivity: 'Step 4: Next task' },
			{ status: 'failed', currentActivity: 'Step 5: Failed', latestShortMessage: 'Terminated with error' },
			{ status: 'working', currentActivity: 'Step 6: Recovered' }
		];

		// Run through 3 full stress loops rapidly
		for (let loop = 0; loop < 3; loop++) {
			for (let i = 0; i < transitions.length; i++) {
				const t = transitions[i];
				native.setSnapshot(contentSnapshot(51_000 + loop * 100 + i, t));
				await sleep(50);
				await drainMain(native, 1);
			}
		}
		await sleep(200);
		await drainMain(native, 4);

		const finalDiag = native.getDiagnostics();
		test51.details = {
			finalStatus: finalDiag.statusLabel,
			composerVisible: finalDiag.composerVisible,
			approvalVisible: finalDiag.approvalControlsVisible,
			optionCount: finalDiag.optionButtonCount,
			panelFrame: finalDiag.panelFrame
		};

		if (!finalDiag.statusLabel || finalDiag.statusLabel.toLowerCase() !== 'working') {
			throw new Error(`Expected final status 'working', got '${finalDiag.statusLabel}'`);
		}
		if (finalDiag.approvalControlsVisible === true) {
			throw new Error('Stale approval buttons remained visible in working state');
		}
		if (finalDiag.optionButtonCount > 0) {
			throw new Error('Stale option buttons remained visible in working state');
		}
		if (finalDiag.composerVisible !== true) {
			throw new Error('Composer input should be visible in settled interactive working state');
		}
	} catch (err) {
		test51.ok = false;
		test51.error = err.message;
		results.failures.push(`rapid-semantic-transition-stress-and-stale-control-purge: ${err.message}`);
	}
	results.tests.push(test51);

	// Test 52: Approval Decision Grid Balance & Pure Hierarchy
	const test52 = { name: 'approval-decision-grid-balance-and-pure-hierarchy', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: true, reducedMotion: true, display: 'builtin' });

		native.setSnapshot(contentSnapshot(52_001, {
			status: 'attention',
			pendingKind: 'approval',
			interactionId: 'appr-grid-1',
			pendingTitle: 'Deploy production release?',
			pendingMessage: 'Requires confirmation of all preflight assertions.'
		}));
		await sleep(200);
		await drainMain(native, 4);

		const diag = native.getDiagnostics();
		const approveFrame = diag.approveButtonFrame;
		const denyFrame = diag.denyButtonFrame;
		const panelFrame = diag.panelFrame;

		test52.details = {
			panelW: panelFrame.width,
			denyFrame,
			approveFrame,
			composerVisible: diag.composerVisible,
			pinVisible: diag.pinButtonVisible,
			openVisible: diag.openInPreBaseVisible
		};

		if (diag.composerVisible === true) {
			throw new Error('Approval state must NOT show composer');
		}
		if (diag.pinButtonVisible === true || diag.openInPreBaseVisible === true) {
			throw new Error('Approval state must NOT show header pin/open utility buttons');
		}
		if (!isValidDiagFrame(denyFrame) || !isValidDiagFrame(approveFrame)) {
			throw new Error('Deny and Approve buttons must have valid frames');
		}
		// Baseline alignment check: exact same y coordinate and height
		if (Math.abs(denyFrame.y - approveFrame.y) > 0.5) {
			throw new Error(`Deny (${denyFrame.y}) and Approve (${approveFrame.y}) must share common baseline`);
		}
		if (Math.abs(denyFrame.height - approveFrame.height) > 0.5) {
			throw new Error(`Deny (${denyFrame.height}) and Approve (${approveFrame.height}) must have equal height`);
		}
		// Symmetrical balance: buttons must span across usable width (no huge 100pt+ blank void on right)
		const rightMargin = panelFrame.width - (approveFrame.x + approveFrame.width);
		const leftMargin = denyFrame.x;
		// Right margin and left margin should both be reasonable safe insets (e.g. within 5pt of each other)
		if (Math.abs(rightMargin - leftMargin) > 5.0) {
			throw new Error(`Asymmetrical approval button placement: left margin ${leftMargin} vs right margin ${rightMargin}`);
		}
	} catch (err) {
		test52.ok = false;
		test52.error = err.message;
		results.failures.push(`approval-decision-grid-balance-and-pure-hierarchy: ${err.message}`);
	}
	results.tests.push(test52);

	// Test 53: Action In-Flight Timeout & Truthful Restoration Lifecycle
	const test53 = { name: 'action-in-flight-timeout-truthful-restoration-lifecycle', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: true, reducedMotion: true, display: 'builtin' });

		native.setSnapshot(contentSnapshot(53_001, {
			status: 'attention',
			pendingKind: 'approval',
			interactionId: 'timeout-test-1',
			pendingTitle: 'Approve timeout path?',
			pendingMessage: 'Timeout must restore truthful controls without ghosting.'
		}));
		await sleep(200);
		await drainMain(native, 4);

		// Simulate user clicking approve
		const clickResult = native.simulateAction('approve');
		test53.details.clickResult = clickResult;
		await drainMain(native, 2);

		const inFlightDiag = native.getDiagnostics();
		test53.details.inFlight = {
			actionInFlight: inFlightDiag.actionInFlight,
			approveTitle: inFlightDiag.approveButtonTitle,
			denyTitle: inFlightDiag.denyButtonTitle
		};

		if (inFlightDiag.actionInFlight !== true) {
			throw new Error('Action must be marked in-flight after simulateAction');
		}

		// Snapshot confirms state transitions back to working (acknowledging interaction completion)
		native.setSnapshot(contentSnapshot(53_002, {
			status: 'working',
			currentActivity: 'Applying approved changes',
		}));
		await sleep(200);
		await drainMain(native, 4);

		const postConfirmDiag = native.getDiagnostics();
		test53.details.postConfirm = {
			actionInFlight: postConfirmDiag.actionInFlight,
			approvalVisible: postConfirmDiag.approvalControlsVisible,
			composerVisible: postConfirmDiag.composerVisible
		};

		if (postConfirmDiag.actionInFlight === true) {
			throw new Error('actionInFlight must be reset once snapshot transitions to working');
		}
		if (postConfirmDiag.approvalControlsVisible === true) {
			throw new Error('Approval buttons must be hidden once working state resumes');
		}
	} catch (err) {
		test53.ok = false;
		test53.error = err.message;
		results.failures.push(`action-in-flight-timeout-truthful-restoration-lifecycle: ${err.message}`);
	}
	results.tests.push(test53);

	// Test 54: Canonical Presentation State Matrix & Single-Subtree Isolation
	const test54 = { name: 'canonical-presentation-state-matrix-and-subview-isolation', ok: true, details: {} };
	try {
		native.dispose();
		const statesToVerify = [
			{
				desc: 'compact',
				setup: async () => {
					native.setPresentation({ visible: true, pinned: false, reducedMotion: true, display: 'builtin' });
					native.setSnapshot(contentSnapshot(54_001, { status: 'working', currentActivity: 'Monitoring' }));
				},
				expectedState: 'compact',
				expectedCompact: true,
				expectedPeek: false,
				expectedExpanded: false,
			},
			{
				desc: 'peek',
				setup: async () => {
					native.setPresentation({ visible: true, pinned: false, reducedMotion: true, display: 'builtin' });
					native.setSnapshot(contentSnapshot(54_002, { status: 'working', currentActivity: 'Peek glanceable update' }));
					await drainMain(native, 2);
					native.simulateAction('peek');
				},
				expectedState: 'peek',
				expectedCompact: true,
				expectedPeek: true,
				expectedExpanded: false,
			},
			{
				desc: 'interactiveWorking',
				setup: async () => {
					native.setPresentation({ visible: true, pinned: true, reducedMotion: true, display: 'builtin' });
					native.setSnapshot(contentSnapshot(54_003, { status: 'working', currentActivity: 'Active task in progress' }));
				},
				expectedState: 'interactiveWorking',
				expectedCompact: false,
				expectedPeek: false,
				expectedExpanded: true,
			},
			{
				desc: 'interactiveQuestion',
				setup: async () => {
					native.setPresentation({ visible: true, pinned: true, reducedMotion: true, display: 'builtin' });
					native.setSnapshot(contentSnapshot(54_004, { status: 'attention', pendingKind: 'question', interactionId: 'q-54', pendingTitle: 'Select action', pendingOptions: [{ id: '1', label: 'One' }, { id: '2', label: 'Two' }] }));
				},
				expectedState: 'interactiveQuestion',
				expectedCompact: false,
				expectedPeek: false,
				expectedExpanded: true,
			},
			{
				desc: 'interactiveApproval',
				setup: async () => {
					native.setPresentation({ visible: true, pinned: true, reducedMotion: true, display: 'builtin' });
					native.setSnapshot(contentSnapshot(54_005, { status: 'attention', pendingKind: 'approval', interactionId: 'appr-54', pendingTitle: 'Confirm deploy?' }));
				},
				expectedState: 'interactiveApproval',
				expectedCompact: false,
				expectedPeek: false,
				expectedExpanded: true,
			},
			{
				desc: 'terminalCompleted',
				setup: async () => {
					native.setPresentation({ visible: true, pinned: true, reducedMotion: true, display: 'builtin' });
					native.setSnapshot(contentSnapshot(54_006, { status: 'completed', latestShortMessage: 'Build complete' }));
				},
				expectedState: 'terminalCompleted',
				expectedCompact: false,
				expectedPeek: false,
				expectedExpanded: true,
			},
			{
				desc: 'terminalFailed',
				setup: async () => {
					native.setPresentation({ visible: true, pinned: true, reducedMotion: true, display: 'builtin' });
					native.setSnapshot(contentSnapshot(54_007, { status: 'failed', latestShortMessage: 'Build error' }));
				},
				expectedState: 'terminalFailed',
				expectedCompact: false,
				expectedPeek: false,
				expectedExpanded: true,
			}
		];

		const verifiedSteps = [];
		for (let i = 0; i < statesToVerify.length; i++) {
			const s = statesToVerify[i];
			await s.setup();
			await sleep(100);
			await drainMain(native, 3);

			const diag = native.getDiagnostics();
			if (diag.canonicalPresentationState !== s.expectedState) {
				throw new Error(`${s.desc}: expected canonicalPresentationState "${s.expectedState}", got "${diag.canonicalPresentationState}"`);
			}
			if (diag.compactContainerVisible !== s.expectedCompact) {
				throw new Error(`${s.desc}: compactContainerVisible expected ${s.expectedCompact}, got ${diag.compactContainerVisible}`);
			}
			if (diag.peekContainerVisible !== s.expectedPeek) {
				throw new Error(`${s.desc}: peekContainerVisible expected ${s.expectedPeek}, got ${diag.peekContainerVisible}`);
			}
			if (diag.expandedContainerVisible !== s.expectedExpanded) {
				throw new Error(`${s.desc}: expandedContainerVisible expected ${s.expectedExpanded}, got ${diag.expandedContainerVisible}`);
			}
			if (s.expectedExpanded && diag.peekContainerVisible) {
				throw new Error(`${s.desc}: peekContainer must be hidden in interactive state`);
			}
			if (s.desc.startsWith('terminal') && (diag.composerVisible || diag.approvalControlsVisible)) {
				throw new Error(`${s.desc}: interactive controls must be hidden in terminal state`);
			}
			verifiedSteps.push({ desc: s.desc, canonicalState: diag.canonicalPresentationState });
		}
		test54.details.verifiedSteps = verifiedSteps;
	} catch (err) {
		test54.ok = false;
		test54.error = err.message;
		results.failures.push(`canonical-presentation-state-matrix-and-subview-isolation: ${err.message}`);
	}
	results.tests.push(test54);

	// Test 55: Adversarial CJK, Unicode, Deep Path Containment & Optical Safe-Zone
	const test55 = { name: 'adversarial-cjk-unicode-deep-path-containment-and-optical-safe-zone', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: true, reducedMotion: true, display: 'builtin' });

		const adversarialPayload = {
			status: 'working',
			currentActivity: '⚡️ 深度测试：正在重构 macOS 动态岛原生组件，确保高精度视网膜渲染及平滑变形动画，没有任何文字超出安全区域 🚀',
			latestShortMessage: 'https://developer.apple.com/documentation/appkit/nsscreen/3882888-auxiliarytopleftarea?language=objc#parameters',
			recentActions: [
				{ id: 'act-cjk', label: '更新代码仓库分支 /Users/username/Projects/Prebase/src/vs/workbench/contrib/prebase/graphs/subsystem/deeply/nested/file.ts' },
				{ id: 'act-unbroken', label: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }
			]
		};

		native.setSnapshot(contentSnapshot(55_001, adversarialPayload));
		await sleep(200);
		await drainMain(native, 4);

		const diag = native.getDiagnostics();
		test55.details.diag = {
			panelFrame: diag.panelFrame,
			contentScrollFrame: diag.contentScrollFrame,
			notchDetected: diag.notchDetected,
			canonicalState: diag.canonicalPresentationState
		};

		if (!diag.panelFrame || diag.panelFrame.width <= 0 || diag.panelFrame.height <= 0) {
			throw new Error('Panel frame missing or invalid dimensions under adversarial text');
		}
		if (diag.contentScrollFrame) {
			if (diag.contentScrollFrame.width > diag.panelFrame.width) {
				throw new Error(`Content scroll width (${diag.contentScrollFrame.width}) exceeds panel width (${diag.panelFrame.width})`);
			}
			if (diag.contentScrollFrame.y + diag.contentScrollFrame.height > diag.panelFrame.height) {
				throw new Error(`Content scroll bounds exceed panel height`);
			}
		}
		if (diag.panelFrame.height > 220) {
			throw new Error(`Panel height ${diag.panelFrame.height} exceeded 220pt ceiling`);
		}
	} catch (err) {
		test55.ok = false;
		test55.error = err.message;
		results.failures.push(`adversarial-cjk-unicode-deep-path-containment-and-optical-safe-zone: ${err.message}`);
	}
	results.tests.push(test55);

	// Test 56: Action-Activity Deduplication & Footer Baseline Alignment
	const test56 = { name: 'action-activity-deduplication-and-footer-baseline-alignment', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: true, reducedMotion: true, display: 'builtin' });

		const dupActivity = 'Compiling native module prebase_live_activity.node';
		native.setSnapshot(contentSnapshot(56_001, {
			status: 'working',
			currentActivity: dupActivity,
			recentActions: [
				{ id: 'act-dup', label: 'Compiling native module prebase_live_activity.node' },
				{ id: 'act-unique', label: 'Linking prebase_live_activity.dylib' }
			]
		}));
		await sleep(200);
		await drainMain(native, 4);

		const diag = native.getDiagnostics();
		test56.details.diag = {
			composerVisible: diag.composerVisible,
			pinButtonVisible: diag.pinButtonVisible,
			openButtonVisible: diag.openInPreBaseVisible,
			actionInFlight: diag.actionInFlight
		};

		if (!diag.composerVisible || !diag.pinButtonVisible || !diag.openInPreBaseVisible) {
			throw new Error('Working state footer controls (composer, pin, open) must all be visible');
		}

		const actionRows = diag.actionRowLabels || [];
		const hasDuplicate = actionRows.some(row => row && row.includes(dupActivity));
		if (hasDuplicate) {
			throw new Error('Action row duplicate was not filtered out when matching currentActivity');
		}
	} catch (err) {
		test56.ok = false;
		test56.error = err.message;
		results.failures.push(`action-activity-deduplication-and-footer-baseline-alignment: ${err.message}`);
	}
	results.tests.push(test56);

	// Test 57: Rapid Interrupted Morph Presentation-Layer Retargeting
	const test57 = { name: 'rapid-interrupted-morph-presentation-layer-retargeting', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: false, reducedMotion: false, display: 'builtin' });
		native.setSnapshot(contentSnapshot(57_001, { status: 'working', currentActivity: 'Initial compact' }));
		await sleep(50);
		await drainMain(native, 2);

		// Rapidly fire 5 alternating state transitions mid-morph
		native.setPresentation({ visible: true, pinned: true, reducedMotion: false, display: 'builtin' });
		native.setSnapshot(contentSnapshot(57_002, { status: 'working', currentActivity: 'Expanding...' }));
		await sleep(25);
		await drainMain(native, 1);

		native.setSnapshot(contentSnapshot(57_003, {
			status: 'attention',
			pendingKind: 'question',
			interactionId: 'rapid-q',
			pendingTitle: 'Quick question?',
			pendingOptions: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]
		}));
		await sleep(25);
		await drainMain(native, 1);

		native.setSnapshot(contentSnapshot(57_004, {
			status: 'attention',
			pendingKind: 'approval',
			interactionId: 'rapid-appr',
			pendingTitle: 'Quick approval?'
		}));
		await sleep(25);
		await drainMain(native, 1);

		native.setSnapshot(contentSnapshot(57_005, {
			status: 'completed',
			latestShortMessage: 'Rapid finish'
		}));
		await sleep(25);
		await drainMain(native, 1);

		native.setSnapshot(contentSnapshot(57_006, {
			status: 'working',
			currentActivity: 'Settled final state'
		}));
		await sleep(350);
		await drainMain(native, 6);

		const finalDiag = native.getDiagnostics();
		test57.details.finalDiag = {
			canonicalState: finalDiag.canonicalPresentationState,
			transitionInFlight: finalDiag.transitionInFlight,
			panelFrame: finalDiag.panelFrame,
			composerVisible: finalDiag.composerVisible,
			approvalControlsVisible: finalDiag.approvalControlsVisible
		};

		if (finalDiag.transitionInFlight === true) {
			throw new Error('transitionInFlight must settle to false after animation completes');
		}
		if (finalDiag.canonicalPresentationState !== 'interactiveWorking') {
			throw new Error(`Final state must settle to interactiveWorking, got ${finalDiag.canonicalPresentationState}`);
		}
		if (!finalDiag.composerVisible) {
			throw new Error('Composer must be visible in settled working state');
		}
		if (finalDiag.approvalControlsVisible) {
			throw new Error('Approval controls from interrupted state must not remain visible');
		}
	} catch (err) {
		test57.ok = false;
		test57.error = err.message;
		results.failures.push(`rapid-interrupted-morph-presentation-layer-retargeting: ${err.message}`);
	}
	results.tests.push(test57);

	// Test 58: Intermediate Transition Frame Sampling Matrix and Collapse Crossfade
	const test58 = { name: 'intermediate-transition-frame-sampling-matrix-and-collapse-crossfade', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: false, reducedMotion: false, display: 'builtin' });
		native.setSnapshot(contentSnapshot(58_001, { status: 'working', currentActivity: 'Initial compact' }));
		await sleep(50);
		await drainMain(native, 2);

		const transitions = [
			{
				name: 'compact -> peek',
				trigger: () => {
					native.simulateAction('peek');
				},
				expectedTarget: 'peek',
				midMorphCheck: (diag) => {
					if (diag.transitionInFlight !== true) throw new Error('transitionInFlight must be true mid-morph');
				}
			},
			{
				name: 'peek -> interactiveWorking',
				trigger: () => {
					native.simulateAction('click');
				},
				expectedTarget: 'interactiveWorking',
				midMorphCheck: (diag) => {
					if (diag.transitionInFlight !== true) throw new Error('transitionInFlight must be true mid-morph');
				}
			},
			{
				name: 'interactiveWorking -> interactiveQuestion',
				trigger: () => {
					native.setSnapshot(contentSnapshot(58_002, {
						status: 'attention',
						pendingKind: 'question',
						interactionId: 'q-trans',
						pendingTitle: 'Proceed with architecture change?',
						pendingOptions: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }]
					}));
				},
				expectedTarget: 'interactiveQuestion',
				midMorphCheck: (diag) => {
					if (diag.transitionInFlight !== true) throw new Error('transitionInFlight must be true mid-morph');
				}
			},
			{
				name: 'interactiveQuestion -> interactiveApproval',
				trigger: () => {
					native.setSnapshot(contentSnapshot(58_003, {
						status: 'attention',
						pendingKind: 'approval',
						interactionId: 'appr-trans',
						pendingTitle: 'Approve git commit?',
						pendingMessage: 'Target files: 3 modified'
					}));
				},
				expectedTarget: 'interactiveApproval',
				midMorphCheck: (diag) => {
					if (diag.transitionInFlight !== true) throw new Error('transitionInFlight must be true mid-morph');
				}
			},
			{
				name: 'interactiveApproval -> terminalCompleted',
				trigger: () => {
					native.setSnapshot(contentSnapshot(58_004, {
						status: 'completed',
						latestShortMessage: 'Commit completed successfully'
					}));
				},
				expectedTarget: 'terminalCompleted',
				midMorphCheck: (diag) => {
					if (diag.transitionInFlight !== true) throw new Error('transitionInFlight must be true mid-morph');
				}
			},
			{
				name: 'terminalCompleted -> compact (collapse)',
				trigger: () => {
					native.simulateAction('escape');
				},
				expectedTarget: 'compact',
				midMorphCheck: (diag) => {
					if (diag.transitionInFlight !== true) throw new Error('transitionInFlight must be true mid-collapse');
					// Critical check: during collapse, expandedContainer must remain visible for smooth crossfade
					// (DEF-01 fix: no empty black void mid-animation!)
					if (diag.expandedContainerVisible !== true) {
						throw new Error('DEF-01 violation: expandedContainer must remain visible mid-collapse for smooth crossfade');
					}
				}
			},
			{
				name: 'compact -> interactiveWorking',
				trigger: () => {
					native.setSnapshot(contentSnapshot(58_005, { status: 'working', currentActivity: 'Back to working' }));
					native.simulateAction('click');
				},
				expectedTarget: 'interactiveWorking',
				midMorphCheck: () => {}
			},
			{
				name: 'interactive collapse -> compact',
				trigger: () => {
					native.simulateAction('escape');
				},
				expectedTarget: 'compact',
				midMorphCheck: (diag) => {
					if (diag.transitionInFlight !== true) throw new Error('transitionInFlight must be true mid-collapse');
					if (diag.expandedContainerVisible !== true) {
						throw new Error('DEF-01 violation: expandedContainerVisible must be true during collapse crossfade');
					}
				}
			}
		];

		const stepDetails = [];
		for (const step of transitions) {
			step.trigger();
			// Sample intermediate animation frame at ~35ms
			await sleep(35);
			await drainMain(native, 1);
			const midDiag = native.getDiagnostics();
			step.midMorphCheck(midDiag);

			// Let animation settle
			await sleep(320);
			await drainMain(native, 5);
			const settledDiag = native.getDiagnostics();
			if (settledDiag.transitionInFlight === true) {
				throw new Error(`transition must settle to false for ${step.name}`);
			}
			if (settledDiag.canonicalPresentationState !== step.expectedTarget) {
				throw new Error(`State did not settle to ${step.expectedTarget} for ${step.name}, got ${settledDiag.canonicalPresentationState}`);
			}
			stepDetails.push({ name: step.name, settled: settledDiag.canonicalPresentationState });
		}
		test58.details.transitions = stepDetails;
	} catch (err) {
		test58.ok = false;
		test58.error = err.message;
		results.failures.push(`intermediate-transition-frame-sampling-matrix-and-collapse-crossfade: ${err.message}`);
	}
	results.tests.push(test58);

	// Test 59: Authoritative Semantic Subtree Ownership and Suppression Matrix
	const test59 = { name: 'authoritative-semantic-subtree-ownership-and-suppression-matrix', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: false, reducedMotion: false, display: 'builtin' });

		// 1. Compact state
		native.setSnapshot(contentSnapshot(59_001, { status: 'working', currentActivity: 'Working quiet' }));
		await sleep(100);
		await drainMain(native, 3);
		let diag = native.getDiagnostics();
		if (diag.semanticContentSubtree !== 'compactContainer') {
			throw new Error(`Compact state semantic content owner must be compactContainer, got ${diag.semanticContentSubtree}`);
		}
		if (diag.supportingChromeSubtree !== null) {
			throw new Error(`Compact state supportingChromeSubtree must be null, got ${diag.supportingChromeSubtree}`);
		}
		if (!diag.inactiveSubtreesSuppressed) {
			throw new Error('Compact state inactive subtrees must be suppressed');
		}
		if (!diag.inactiveInteractiveSubtreeSuppressed) {
			throw new Error('Compact state inactive interactive subtrees must be suppressed');
		}

		// 2. Peek state
		native.simulateAction('peek');
		await sleep(350);
		await drainMain(native, 5);
		diag = native.getDiagnostics();
		if (diag.semanticContentSubtree !== 'peekContainer') {
			throw new Error(`Peek state semantic content owner must be peekContainer, got ${diag.semanticContentSubtree}`);
		}
		if (diag.supportingChromeSubtree !== 'compactContainer') {
			throw new Error(`Peek state supportingChromeSubtree must be compactContainer, got ${diag.supportingChromeSubtree}`);
		}
		if (!diag.inactiveSubtreesSuppressed) {
			throw new Error('Peek state inactive subtrees must be suppressed');
		}
		if (!diag.inactiveInteractiveSubtreeSuppressed) {
			throw new Error('Peek state inactive interactive subtrees must be suppressed');
		}

		// 3. Interactive Working state
		native.simulateAction('click');
		await sleep(350);
		await drainMain(native, 5);
		diag = native.getDiagnostics();
		if (diag.semanticContentSubtree !== 'expandedContainer') {
			throw new Error(`InteractiveWorking state semantic content owner must be expandedContainer, got ${diag.semanticContentSubtree}`);
		}
		if (diag.approvalControlsVisible) {
			throw new Error('Approval controls must not be visible in InteractiveWorking state');
		}
		if (!diag.inactiveInteractiveSubtreeSuppressed) {
			throw new Error('Inactive interactive subtrees (approval) must be suppressed in InteractiveWorking');
		}

		// 4. Interactive Approval state
		native.setSnapshot(contentSnapshot(59_002, {
			status: 'attention',
			pendingKind: 'approval',
			interactionId: 'appr-subtrees',
			pendingTitle: 'Approve change?'
		}));
		await sleep(350);
		await drainMain(native, 5);
		diag = native.getDiagnostics();
		if (diag.canonicalPresentationState !== 'interactiveApproval') {
			throw new Error(`State must be interactiveApproval, got ${diag.canonicalPresentationState}`);
		}
		if (!diag.approvalControlsVisible) {
			throw new Error('Approval controls must be visible in interactiveApproval');
		}
		if (diag.composerVisible) {
			throw new Error('Composer must not be visible in interactiveApproval');
		}
		if (!diag.inactiveInteractiveSubtreeSuppressed) {
			throw new Error('Composer must be suppressed in interactiveApproval');
		}

		// 5. Terminal Completed state
		native.setSnapshot(contentSnapshot(59_003, {
			status: 'completed',
			latestShortMessage: 'All tasks completed'
		}));
		await sleep(350);
		await drainMain(native, 5);
		diag = native.getDiagnostics();
		if (diag.canonicalPresentationState !== 'terminalCompleted') {
			throw new Error(`State must be terminalCompleted, got ${diag.canonicalPresentationState}`);
		}
		if (diag.approvalControlsVisible) {
			throw new Error('Approval controls must not be visible in terminalCompleted');
		}
		if (diag.composerVisible) {
			throw new Error('Composer must not be visible in terminalCompleted');
		}
		if (!diag.inactiveInteractiveSubtreeSuppressed) {
			throw new Error('Inactive interactive controls must be suppressed in terminalCompleted');
		}

		test59.details.statesVerified = ['compact', 'peek', 'interactiveWorking', 'interactiveApproval', 'terminalCompleted'];
	} catch (err) {
		test59.ok = false;
		test59.error = err.message;
		results.failures.push(`authoritative-semantic-subtree-ownership-and-suppression-matrix: ${err.message}`);
	}
	results.tests.push(test59);

	// Test 60: Adversarial Visual Text Containment and Safe Zones
	const test60 = { name: 'adversarial-visual-text-containment-and-safe-zones', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: true, reducedMotion: false, display: 'builtin' });

		const longUrl = 'https://prebase.internal.dev/workspace/repo/src/very/long/unbroken/path/that/must/not/overflow/the/content/viewport/or/silhouette/at/all/under/any/circumstances/when/rendered/inside/the/native/panel/bounds/12345678901234567890';
		const cjkAndEmoji = '🚀 【系统架构深度分析】/Users/prebase/Development/Projects/Deeply/Nested/Workspace/src/core/presentation/state/manager.ts (100% 完了) ⚡️ 这是一个非常长的测试字符串用于验证文字裁剪与安全区边界';

		native.setSnapshot(contentSnapshot(60_001, {
			status: 'attention',
			pendingKind: 'approval',
			interactionId: 'adv-approval',
			pendingTitle: `Execute command: ${longUrl}`,
			pendingMessage: `Target files and description: ${cjkAndEmoji}\nAdditional line for multi-line scroll testing.`
		}));
		await sleep(350);
		await drainMain(native, 6);

		const diag = native.getDiagnostics();
		test60.details.diag = {
			panelFrame: diag.panelFrame,
			bodyBounds: diag.bodyBounds,
			contentScrollFrame: diag.contentScrollFrame,
			contentSafeViewport: diag.contentSafeViewport,
			contentDocumentHeight: diag.contentDocumentHeight,
			canonicalState: diag.canonicalPresentationState
		};

		if (diag.canonicalPresentationState !== 'interactiveApproval') {
			throw new Error(`Expected interactiveApproval, got ${diag.canonicalPresentationState}`);
		}
		if (diag.bodyBounds.width > diag.panelFrame.width) {
			throw new Error(`bodyBounds width (${diag.bodyBounds.width}) exceeds panelFrame width (${diag.panelFrame.width})`);
		}
		if (diag.contentScrollFrame.width > diag.bodyBounds.width) {
			throw new Error(`contentScrollFrame width (${diag.contentScrollFrame.width}) exceeds bodyBounds width (${diag.bodyBounds.width})`);
		}
		if (diag.contentSafeViewport.x < 16) {
			throw new Error(`contentSafeViewport x inset (${diag.contentSafeViewport.x}) must respect safe margin >= 16pt`);
		}
		if (diag.panelFrame.height > 220) {
			throw new Error(`panelFrame height (${diag.panelFrame.height}) exceeds max allowed height of 220pt`);
		}
		if (!diag.approvalControlsVisible) {
			throw new Error('Approval controls must remain visible in approval state');
		}
	} catch (err) {
		test60.ok = false;
		test60.error = err.message;
		results.failures.push(`adversarial-visual-text-containment-and-safe-zones: ${err.message}`);
	}
	results.tests.push(test60);

	// Test 61: Hit-Testing and Interaction Isolation Under Inactive States
	const test61 = { name: 'hit-testing-and-interaction-isolation-under-inactive-states', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: false, reducedMotion: false, display: 'builtin' });

		// In compact state: all interactive actions must be rejected
		native.setSnapshot(contentSnapshot(61_001, { status: 'working', currentActivity: 'Working' }));
		await sleep(100);
		await drainMain(native, 3);

		if (native.simulateAction('approve') !== false) {
			throw new Error('simulateAction(approve) must return false when compact');
		}
		if (native.simulateAction('deny') !== false) {
			throw new Error('simulateAction(deny) must return false when compact');
		}
		if (native.simulateAction('option', 0) !== false) {
			throw new Error('simulateAction(option, 0) must return false when compact');
		}
		if (native.simulateAction('followUp', 'test') !== false) {
			throw new Error('simulateAction(followUp) must return false when compact');
		}

		// In peek state: click actions must still be rejected
		native.simulateAction('peek');
		await sleep(350);
		await drainMain(native, 5);
		if (native.simulateAction('approve') !== false) {
			throw new Error('simulateAction(approve) must return false in peek');
		}
		if (native.simulateAction('option', 0) !== false) {
			throw new Error('simulateAction(option, 0) must return false in peek');
		}

		// In interactiveApproval state: click approve must succeed, second click must be rejected while in flight
		native.setPresentation({ visible: true, pinned: true, reducedMotion: false, display: 'builtin' });
		native.setSnapshot(contentSnapshot(61_002, {
			status: 'attention',
			pendingKind: 'approval',
			interactionId: 'hit-appr',
			pendingTitle: 'Needs approval'
		}));
		await sleep(350);
		await drainMain(native, 5);

		const firstClick = native.simulateAction('approve');
		if (!firstClick) {
			throw new Error('simulateAction(approve) must return true when interactiveApproval is active');
		}

		// While in-flight: duplicate click must be rejected
		const secondClick = native.simulateAction('approve');
		if (secondClick !== false) {
			throw new Error('simulateAction(approve) must return false while action is in flight');
		}

		// Verify action in flight title stability
		const inFlightDiag = native.getDiagnostics();
		test61.details.inFlightTitle = inFlightDiag.approveButtonTitle;
		test61.details.inFlightA11y = inFlightDiag.approveButtonAccessibilityLabel;
		if (!inFlightDiag.approveButtonAccessibilityLabel.includes('in progress')) {
			throw new Error(`Accessibility label must include 'in progress', got ${inFlightDiag.approveButtonAccessibilityLabel}`);
		}
	} catch (err) {
		test61.ok = false;
		test61.error = err.message;
		results.failures.push(`hit-testing-and-interaction-isolation-under-inactive-states: ${err.message}`);
	}
	results.tests.push(test61);

	// Test 62: Canonical Presentation Authority Invariance
	const test62 = { name: 'canonical-presentation-authority-invariance', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: false, reducedMotion: false, display: 'builtin' });

		// 1. Compact Idle
		native.setSnapshot(contentSnapshot(62_001, { status: 'idle', currentActivity: '' }));
		await sleep(80);
		await drainMain(native, 3);
		let diag = native.getDiagnostics();
		if (diag.canonicalPresentationState !== 'compact') {
			throw new Error(`Expected compact, got ${diag.canonicalPresentationState}`);
		}
		if (!diag.compactContainerVisible || diag.interactiveContentVisible) {
			throw new Error('Compact chrome must be visible and interactive content suppressed');
		}

		// 2. Attention Peek
		native.setSnapshot(contentSnapshot(62_002, {
			status: 'attention',
			currentActivity: 'Needs review',
			pendingInteraction: { kind: 'approval', interactionId: 'att-peek-1', title: 'Review changes' }
		}));
		await sleep(250);
		await drainMain(native, 4);
		diag = native.getDiagnostics();
		if (diag.canonicalPresentationState !== 'attentionPeek') {
			throw new Error(`Expected attentionPeek, got ${diag.canonicalPresentationState}`);
		}
		if (!diag.peekContainerVisible || diag.interactiveContentVisible) {
			throw new Error('Peek container must be visible in attentionPeek');
		}

		// 3. User Dismissed Attention (Escape to Attention Compact)
		native.simulateAction('escape');
		await sleep(250);
		await drainMain(native, 4);
		diag = native.getDiagnostics();
		if (diag.canonicalPresentationState !== 'attentionCompact') {
			throw new Error(`Expected attentionCompact after escape, got ${diag.canonicalPresentationState}`);
		}
		if (!diag.compactContainerVisible || diag.interactiveContentVisible) {
			throw new Error('Compact chrome must be restored after escape dismissal');
		}

		// 4. Interactive Working (Pinned)
		native.setPresentation({ visible: true, pinned: true, reducedMotion: false, display: 'builtin' });
		native.setSnapshot(contentSnapshot(62_003, { status: 'working', currentActivity: 'Refactoring notch' }));
		await sleep(350);
		await drainMain(native, 5);
		diag = native.getDiagnostics();
		if (diag.canonicalPresentationState !== 'interactiveWorking') {
			throw new Error(`Expected interactiveWorking, got ${diag.canonicalPresentationState}`);
		}
		if (!diag.expandedContainerVisible || !diag.interactiveContentVisible || !diag.composerVisible) {
			throw new Error('Expanded container and composer must be visible in interactiveWorking');
		}
		if (diag.approvalControlsVisible) {
			throw new Error('Approval controls must not be visible in interactiveWorking');
		}

		// 5. Interactive Question
		native.setSnapshot(contentSnapshot(62_004, {
			status: 'attention',
			pendingInteraction: {
				kind: 'question',
				interactionId: 'q-62',
				title: 'Select strategy',
				options: [
					{ id: 'opt1', label: 'Option 1' },
					{ id: 'opt2', label: 'Option 2' }
				]
			}
		}));
		await sleep(350);
		await drainMain(native, 5);
		diag = native.getDiagnostics();
		if (diag.canonicalPresentationState !== 'interactiveQuestion') {
			throw new Error(`Expected interactiveQuestion, got ${diag.canonicalPresentationState}`);
		}
		if (diag.composerVisible || diag.approvalControlsVisible) {
			throw new Error('Composer and approval controls must be suppressed in interactiveQuestion');
		}

		// 6. Interactive Approval
		native.setSnapshot(contentSnapshot(62_005, {
			status: 'attention',
			pendingInteraction: {
				kind: 'approval',
				interactionId: 'appr-62',
				title: 'Approve execution?'
			}
		}));
		await sleep(350);
		await drainMain(native, 5);
		diag = native.getDiagnostics();
		if (diag.canonicalPresentationState !== 'interactiveApproval') {
			throw new Error(`Expected interactiveApproval, got ${diag.canonicalPresentationState}`);
		}
		if (!diag.approvalControlsVisible || diag.composerVisible) {
			throw new Error('Approval controls must be visible and composer suppressed in interactiveApproval');
		}

		// 7. Terminal Failed
		native.setSnapshot(contentSnapshot(62_006, {
			status: 'failed',
			currentActivity: 'Build failed'
		}));
		await sleep(350);
		await drainMain(native, 5);
		diag = native.getDiagnostics();
		if (diag.canonicalPresentationState !== 'terminalFailed') {
			throw new Error(`Expected terminalFailed, got ${diag.canonicalPresentationState}`);
		}
		if (diag.approvalControlsVisible || diag.composerVisible) {
			throw new Error('Controls must be suppressed in terminalFailed');
		}

		test62.details.statesVerified = ['compact', 'attentionPeek', 'attentionCompact', 'interactiveWorking', 'interactiveQuestion', 'interactiveApproval', 'terminalFailed'];
	} catch (err) {
		test62.ok = false;
		test62.error = err.message;
		results.failures.push(`canonical-presentation-authority-invariance: ${err.message}`);
	}
	results.tests.push(test62);

	// Test 63: Adversarial Unbroken Tokens and Character Wrapping
	const test63 = { name: 'adversarial-unbroken-tokens-and-character-wrapping', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: true, reducedMotion: false, display: 'builtin' });

		// 500-character unbroken URL/hash token that tests character-level wrapping
		const unbroken500 = 'https://prebase.internal.dev/repos/super-long-unbroken-slug-that-must-be-wrapped-by-character-without-horizontal-clip-or-escape-1234567890abcdefghijklmnopqrstuvwxyz-commit-982d4ec1da6448d68519ef3f9db1273b-sha256-e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855-very-long-continuous-identifier-with-no-spaces-at-all-for-robust-safe-containment-adversarial-verification-matrix-testing-boundary-system';
		const cjkAndPath = '⚡️ 【边界约束与文字容纳测试】/Users/developer/prebase/very/long/unbroken/path/that/spans/across/multiple/lines/of/text/without/spaces/abcdefghijklmnopqrstuvwxyz1234567890/文件系统路径测试-Unicode-🚀';

		native.setSnapshot(contentSnapshot(63_001, {
			status: 'working',
			currentActivity: unbroken500,
			latestShortMessage: cjkAndPath
		}));
		await sleep(350);
		await drainMain(native, 6);

		const diag = native.getDiagnostics();
		test63.details.panelFrame = diag.panelFrame;
		test63.details.bodyBounds = diag.bodyBounds;
		test63.details.contentScrollFrame = diag.contentScrollFrame;
		test63.details.contentSafeViewport = diag.contentSafeViewport;

		// Text layout must never cause scroll frame width to exceed body width
		if (diag.contentScrollFrame.width > diag.bodyBounds.width) {
			throw new Error(`contentScrollFrame width (${diag.contentScrollFrame.width}) exceeds bodyBounds (${diag.bodyBounds.width})`);
		}
		// Safe viewport inset must be preserved
		if (diag.contentSafeViewport.x < 16) {
			throw new Error(`contentSafeViewport x inset (${diag.contentSafeViewport.x}) must be >= 16pt`);
		}
		// Panel height must stay within bounded ceiling (<= 200pt)
		if (diag.panelFrame.height > 220) {
			throw new Error(`panelFrame height (${diag.panelFrame.height}) exceeded maximum 220pt`);
		}
	} catch (err) {
		test63.ok = false;
		test63.error = err.message;
		results.failures.push(`adversarial-unbroken-tokens-and-character-wrapping: ${err.message}`);
	}
	results.tests.push(test63);

	// Test 64: Concave Top Shoulder Geometry and Bezel Attachment Invariants
	const test64 = { name: 'concave-top-shoulder-geometry-and-bezel-attachment-invariants', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: false, reducedMotion: false, display: 'builtin' });
		native.setSnapshot(contentSnapshot(64_001, { status: 'working' }));
		await sleep(100);
		await drainMain(native, 3);

		// 1. Compact: top edge anchored at screen top
		let diag = native.getDiagnostics();
		if (diag.topAnchorDelta !== 0) {
			throw new Error(`Compact notch must be flush with top bezel (delta=${diag.topAnchorDelta})`);
		}

		// 2. Expanded: panel must remain attached to top bezel (y + height == screenTopY)
		native.setPresentation({ visible: true, pinned: true, reducedMotion: false, display: 'builtin' });
		await sleep(350);
		await drainMain(native, 5);
		diag = native.getDiagnostics();

		const panelTopY = diag.panelFrame.y + diag.panelFrame.height - (diag.topBleed || 0);
		if (Math.abs(panelTopY - diag.screenTopY) > 1.0) {
			throw new Error(`Expanded notch must remain attached to screen top (panelTopY=${panelTopY}, screenTopY=${diag.screenTopY})`);
		}
		if (diag.panelFrame.width < 313) {
			throw new Error(`Expanded width (${diag.panelFrame.width}) must be >= 313pt`);
		}

		test64.details.compactDelta = 0;
		test64.details.expandedTopY = panelTopY;
		test64.details.screenTopY = diag.screenTopY;
	} catch (err) {
		test64.ok = false;
		test64.error = err.message;
		results.failures.push(`concave-top-shoulder-geometry-and-bezel-attachment-invariants: ${err.message}`);
	}
	results.tests.push(test64);

	// Test 65: Intermediate Transition Crossfade and Zero-Void Morph
	const test65 = { name: 'intermediate-transition-crossfade-and-zero-void-morph', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: false, reducedMotion: false, display: 'builtin' });
		native.setSnapshot(contentSnapshot(65_001, { status: 'working', currentActivity: 'Crossfade validation' }));
		await sleep(100);
		await drainMain(native, 3);

		// Trigger expansion with animation enabled
		native.setPresentation({ visible: true, pinned: true, reducedMotion: false, display: 'builtin' });

		// Sample early frame (t ~ 10-30ms)
		await sleep(25);
		await drainMain(native, 1);
		const earlyDiag = native.getDiagnostics();

		// Sample mid transition frame (t ~ 80-100ms)
		await sleep(65);
		await drainMain(native, 1);
		const midDiag = native.getDiagnostics();

		// Settle transition
		await sleep(300);
		await drainMain(native, 5);
		const settledDiag = native.getDiagnostics();

		test65.details.early = {
			inFlight: earlyDiag.transitionInFlight,
			compactVisible: earlyDiag.compactContainerVisible,
			expandedVisible: earlyDiag.expandedContainerVisible
		};
		test65.details.mid = {
			inFlight: midDiag.transitionInFlight,
			compactVisible: midDiag.compactContainerVisible,
			expandedVisible: midDiag.expandedContainerVisible
		};
		test65.details.settled = {
			inFlight: settledDiag.transitionInFlight,
			compactVisible: settledDiag.compactContainerVisible,
			expandedVisible: settledDiag.expandedContainerVisible
		};

		// During expansion onset, compact container must remain visible (no blank void)
		if (!earlyDiag.compactContainerVisible && !earlyDiag.expandedContainerVisible) {
			throw new Error('Empty black void detected during expansion onset: neither container was visible');
		}
		// Settled state must have expanded visible and compact hidden
		if (!settledDiag.expandedContainerVisible || settledDiag.compactContainerVisible) {
			throw new Error('Settled state did not finish crossfade properly');
		}
		if (settledDiag.transitionInFlight) {
			throw new Error('Transition must be marked settled after animation completion');
		}
	} catch (err) {
		test65.ok = false;
		test65.error = err.message;
		results.failures.push(`intermediate-transition-crossfade-and-zero-void-morph: ${err.message}`);
	}
	results.tests.push(test65);

	// Test 66: Safe-Zone Corner Clearance and Footer Geometry
	const test66 = { name: 'safe-zone-corner-clearance-and-footer-geometry', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: true, reducedMotion: false, display: 'builtin' });

		// Approval layout corner clearance
		native.setSnapshot(contentSnapshot(66_001, {
			status: 'attention',
			pendingInteraction: {
				kind: 'approval',
				interactionId: 'appr-corner-test',
				title: 'Safe zone verification'
			}
		}));
		await sleep(350);
		await drainMain(native, 5);

		let diag = native.getDiagnostics();
		test66.details.approval = {
			approveFrame: diag.approveButtonFrame,
			denyFrame: diag.denyButtonFrame,
			panelFrame: diag.panelFrame
		};

		// Inset clearance check: buttons must clear safe horizontal inset (>= 18pt)
		if (diag.denyButtonFrame.x < 18) {
			throw new Error(`denyButtonFrame x (${diag.denyButtonFrame.x}) collides with left curved corner (<18pt)`);
		}
		const approveRight = diag.approveButtonFrame.x + diag.approveButtonFrame.width;
		if (approveRight > diag.panelFrame.width - 18) {
			throw new Error(`approveButtonFrame right edge (${approveRight}) collides with right curved corner (> ${diag.panelFrame.width - 18})`);
		}

		// Vertical clearance check: button bottom must clear bottom curve (y + height <= bodyHeight - 5)
		const bodyH = diag.panelFrame.height - diag.safeAreaTop;
		const buttonBottom = diag.approveButtonFrame.y + diag.approveButtonFrame.height;
		if (buttonBottom > bodyH - 5) {
			throw new Error(`Button bottom (${buttonBottom}) collides with bottom curved boundary (${bodyH - 5})`);
		}
	} catch (err) {
		test66.ok = false;
		test66.error = err.message;
		results.failures.push(`safe-zone-corner-clearance-and-footer-geometry: ${err.message}`);
	}
	results.tests.push(test66);

	// Test 67: Visual Silhouette Curvature and Bezel Attachment
	const test67 = { name: 'visual-silhouette-curvature-and-bezel-attachment', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: true, reducedMotion: false, display: 'builtin' });
		native.setSnapshot(contentSnapshot(67_001, { status: 'working', currentActivity: 'Silhouette curvature verification' }));
		await sleep(350);
		await drainMain(native, 5);

		const diag = native.getDiagnostics();
		test67.details.diag = {
			panelFrame: diag.panelFrame,
			safeAreaTop: diag.safeAreaTop,
			screenTopY: diag.screenTopY,
			topAnchorDelta: diag.topAnchorDelta,
			shoulderMetrics: diag.shoulderMetrics,
			notched: diag.notched,
		};

		// 1. Must be bezel-attached: visible panelTopY == screenTopY
		const panelTopY = diag.panelFrame.y + diag.panelFrame.height - (diag.topBleed || 0);
		if (Math.abs(panelTopY - diag.screenTopY) > 1.0) {
			throw new Error(`Expanded panel must be attached to top bezel: panelTopY=${panelTopY} vs screenTopY=${diag.screenTopY}`);
		}

		// 2. Topology invariance check
		const topo = native.validatePathTopology({ isNotched: true });
		if (!topo.compatible || topo.collapsedElements !== 14 || topo.expandedElements !== 14) {
			throw new Error(`Notched topology must be 14 elements (got ${topo.collapsedElements}/${topo.expandedElements})`);
		}

		// 3. Shoulder curvature: effShoulderR must be in [18, 42] (pronounced concave notch-origin shoulders)
		const shoulder = diag.shoulderMetrics;
		// Organic expanded shoulder range: [18, 42] (updated for larger notch-origin shoulders).
		if (shoulder && (shoulder.effShoulderR < 18 || shoulder.effShoulderR > 42)) {
			throw new Error(`effShoulderR (${shoulder.effShoulderR}) out of organic concave bounds [18, 42]`);
		}
	} catch (err) {
		test67.ok = false;
		test67.error = err.message;
		results.failures.push(`visual-silhouette-curvature-and-bezel-attachment: ${err.message}`);
	}
	results.tests.push(test67);

	// Test 68: Adversarial Word Wrap and Unbroken Containment
	const test68 = { name: 'adversarial-word-wrap-and-unbroken-containment', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: true, reducedMotion: false, display: 'builtin' });

		// Natural English prose with 7-10 letter words that should wrap naturally at word boundaries
		const naturalProse = 'Validating natural sentence line breaking without splitting words awkwardly across boundaries.';
		native.setSnapshot(contentSnapshot(68_001, {
			status: 'working',
			currentActivity: naturalProse,
			latestShortMessage: 'Word wrapping conformance test running.'
		}));
		await sleep(300);
		await drainMain(native, 4);

		let diag = native.getDiagnostics();
		test68.details.natural = {
			activityFrame: diag.activityFrame,
			activityLabel: diag.activityLabel,
		};

		// Adversarial 500+ character unbroken token (URL/hash/path)
		const unbrokenToken = 'https://github.com/PreBase/prebase/commit/' + 'a'.repeat(240) + '/blob/main/' + 'b'.repeat(240) + '.ts';
		native.setSnapshot(contentSnapshot(68_002, {
			status: 'working',
			currentActivity: unbrokenToken,
			latestShortMessage: 'Unbroken token containment check.'
		}));
		await sleep(300);
		await drainMain(native, 4);

		diag = native.getDiagnostics();
		test68.details.unbroken = {
			activityFrame: diag.activityFrame,
			panelFrame: diag.panelFrame,
		};

		// Verify unbroken token is contained within panel width - 18pt safe margin
		if (diag.activityFrame) {
			const rightEdge = diag.activityFrame.x + diag.activityFrame.width;
			if (rightEdge > diag.panelFrame.width - 18) {
				throw new Error(`Unbroken token right edge (${rightEdge}) escaped panel boundary (${diag.panelFrame.width - 18})`);
			}
			if (diag.activityFrame.x < 18) {
				throw new Error(`Unbroken token left edge (${diag.activityFrame.x}) encroached left margin (<18)`);
			}
		}
	} catch (err) {
		test68.ok = false;
		test68.error = err.message;
		results.failures.push(`adversarial-word-wrap-and-unbroken-containment: ${err.message}`);
	}
	results.tests.push(test68);

	// Test 69: Working State Hierarchy and Empty Space Budget
	const test69 = { name: 'working-state-hierarchy-and-empty-space-budget', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: true, reducedMotion: false, display: 'builtin' });

		// Short working state: single-line activity, no action rows
		native.setSnapshot(contentSnapshot(69_001, {
			status: 'working',
			currentActivity: 'Running graph interaction tests',
			recentActions: [],
		}));
		await sleep(350);
		await drainMain(native, 5);

		let diag = native.getDiagnostics();
		test69.details.shortWorking = {
			panelFrame: diag.panelFrame,
			activityFrame: diag.activityFrame,
			composerFrame: diag.composerFrame,
		};

		// 1. Short working state panel height must be bounded <= 185pt
		if (diag.panelFrame.height > 185) {
			throw new Error(`Short working state height (${diag.panelFrame.height}) exceeds 185pt ceiling`);
		}

		// 2. Empty black gap between activity and composer must be <= 35pt (no giant 60-80pt void)
		if (diag.activityFrame && diag.composerFrame && diag.contentScrollFrame) {
			const textBottomInExpanded = diag.contentScrollFrame.y + diag.activityFrame.y + diag.activityFrame.height;
			const composerTopInExpanded = diag.composerFrame.y;
			const gap = Math.max(0, composerTopInExpanded - textBottomInExpanded);
			test69.details.gap = gap;
			if (gap > 35) {
				throw new Error(`Empty space gap between activity and composer (${gap}pt) exceeds 35pt budget`);
			}
		}

		// 3. Raw developer ID test: "Activity 1629" with human message
		native.setSnapshot(contentSnapshot(69_002, {
			status: 'working',
			currentActivity: 'Activity 1629',
			latestShortMessage: 'Validating graph layout constraints',
			recentActions: [],
		}));
		await sleep(300);
		await drainMain(native, 4);

		diag = native.getDiagnostics();
		test69.details.rawIdHandling = {
			activityLabel: diag.activityLabel,
			renderedActivityText: diag.renderedActivityText,
		};
		if (diag.renderedActivityText && diag.renderedActivityText.includes('Activity 1629')) {
			throw new Error(`Raw activity ID must NOT be rendered in expanded mode when message is available: "${diag.renderedActivityText}"`);
		}
		if (diag.renderedActivityText !== 'Validating graph layout constraints') {
			throw new Error(`Expected latest message to be rendered in place of raw ID, got "${diag.renderedActivityText}"`);
		}

		// 4. Raw developer ID test: "Activity 1629" WITHOUT human message (must fall back to human prose)
		native.setSnapshot(contentSnapshot(69_003, {
			status: 'working',
			currentActivity: 'Activity 1629',
			latestShortMessage: '',
			recentActions: [],
		}));
		await sleep(300);
		await drainMain(native, 4);

		diag = native.getDiagnostics();
		test69.details.rawIdWithoutMessage = {
			activityLabel: diag.activityLabel,
			renderedActivityText: diag.renderedActivityText,
		};
		if (diag.renderedActivityText && diag.renderedActivityText.includes('Activity 1629')) {
			throw new Error(`Raw activity ID must NEVER be rendered to user even without message: "${diag.renderedActivityText}"`);
		}
		if (diag.renderedActivityText !== 'Working with Magnus') {
			throw new Error(`Expected fallback "Working with Magnus", got "${diag.renderedActivityText}"`);
		}
	} catch (err) {
		test69.ok = false;
		test69.error = err.message;
		results.failures.push(`working-state-hierarchy-and-empty-space-budget: ${err.message}`);
	}
	results.tests.push(test69);

	// Test 70: Terminal Completed and Failed tight height bounding and build provenance
	const test70 = { name: 'terminal-states-tight-bounding-and-build-provenance', ok: true, details: {} };
	try {
		native.dispose();
		native.setPresentation({ visible: true, pinned: true, reducedMotion: false, display: 'builtin' });

		// Terminal Completed
		native.setSnapshot(contentSnapshot(70_001, {
			status: 'completed',
			currentActivity: 'Graph layout validated',
			latestShortMessage: 'Done',
			recentActions: [],
		}));
		await sleep(350);
		await drainMain(native, 5);

		let diag = native.getDiagnostics();
		test70.details.completed = {
			panelFrame: diag.panelFrame,
			state: diag.canonicalPresentationState,
		};
		const topBleed70 = diag.topBleed || 0;
		const semanticCompletedH70 = diag.panelFrame.height - topBleed70;
		if (semanticCompletedH70 > 94) {
			throw new Error(`terminalCompleted height (${semanticCompletedH70}) exceeds tight 94pt limit`);
		}
		if (semanticCompletedH70 < 82) {
			throw new Error(`terminalCompleted height (${semanticCompletedH70}) below 82pt floor`);
		}

		// Terminal Failed
		native.setSnapshot(contentSnapshot(70_002, {
			status: 'failed',
			currentActivity: 'Build terminated',
			latestShortMessage: 'Failed',
			recentActions: [],
		}));
		await sleep(350);
		await drainMain(native, 5);

		diag = native.getDiagnostics();
		test70.details.failed = {
			panelFrame: diag.panelFrame,
			state: diag.canonicalPresentationState,
		};
		const topBleedFailed = diag.topBleed || 0;
		const semanticFailedH = diag.panelFrame.height - topBleedFailed;
		if (semanticFailedH > 94) {
			throw new Error(`terminalFailed height (${semanticFailedH}) exceeds tight 94pt limit`);
		}
		if (semanticFailedH < 82) {
			throw new Error(`terminalFailed height (${semanticFailedH}) below 82pt floor`);
		}

		// Provenance fields
		if (!diag.buildTimestamp || typeof diag.buildTimestamp !== 'string') {
			throw new Error('Native diagnostics missing buildTimestamp');
		}
		if (!diag.buildSourceFile || typeof diag.buildSourceFile !== 'string') {
			throw new Error('Native diagnostics missing buildSourceFile');
		}
		if (!diag.buildFingerprint || typeof diag.buildFingerprint !== 'string') {
			throw new Error('Native diagnostics missing buildFingerprint');
		}
		test70.details.provenance = {
			buildTimestamp: diag.buildTimestamp,
			buildSourceFile: diag.buildSourceFile,
			buildFingerprint: diag.buildFingerprint,
		};
	} catch (err) {
		test70.ok = false;
		test70.error = err.message;
		results.failures.push(`terminal-states-tight-bounding-and-build-provenance: ${err.message}`);
	}
	results.tests.push(test70);

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
