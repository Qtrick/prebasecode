import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { classifyHosts, lsofSelectionArgs, privacyFailures } from './prebase-privacy-runtime.mjs';
import { nodesDrawnFromMetrics, coreIdeFailures, codeGraphFailures, GRAPH_RENDER_METRICS_NAME, themesA11yFailures } from './prebase-core-ide-live.mjs';
import { ACTIVE_SOAK_FINAL_MIN_DURATION_MS, activeSoakEvidenceTarget, activeSoakFailures } from './prebase-active-soak.mjs';
import { summarizeCpuProfile } from './prebase-renderer-cpu-diag.mjs';
import { loadQuitFailures } from './prebase-load-quit-live.mjs';
import { findGraphFrame, formatPhase3LockBlockMessage, recoverHungWorkbenchPage, waitForWorkbenchDriver, workbenchCommandWithTimeout, classifyProcessRole, redactCommandLine } from './workbenchHarness.mjs';
import { PHASE3_PRODUCERS, PHASE3_REQUIRED_EVIDENCE, activeSoakProducerTimeoutMs, classifyRequiredEvidence, hybridFirecrawlExternalSkip, producerForArtifact, scenarioOk } from './prebase-phase3-final-gate.mjs';
import { magnusStreamFailures } from './prebase-magnus-stream-live.mjs';
import { liveActivityLiveFailures } from './prebase-magnus-live-activity-live.mjs';
import { PHASE3_EVIDENCE_SCHEMA_VERSION, phase3EvidenceMetadata } from './phase3Evidence.mjs';
import { assuranceCommandLabel, assuranceEvidenceOk, PHASE3_ASSURANCE_COMMANDS, PHASE3_ASSURANCE_LEAF_COVERAGE, reportedTestCount } from './prebase-phase3-assurance.mjs';
import { lifecycleFailures } from './prebase-process-leak-diag.mjs';

const acceptanceDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(acceptanceDir, '../../..');

function exportedSource(source, name) {
	const match = source.match(new RegExp(`export (?:async )?function ${name}\\b`));
	assert.ok(match && match.index !== undefined, `${name} is missing`);
	const start = match.index;
	const rest = source.slice(start + 1);
	const next = rest.search(/\nexport (?:async )?function /);
	return source.slice(start, next === -1 ? source.length : start + 1 + next);
}

function hangingEvaluatePage() {
	const timeouts = [];
	return {
		timeouts,
		setDefaultTimeout(ms) {
			timeouts.push(ms);
		},
		waitForFunction: async () => undefined,
		reload: async () => undefined,
		evaluate: () => new Promise(() => { }),
	};
}

function recoveringEvaluatePage() {
	let hung = true;
	const timeouts = [];
	return {
		timeouts,
		setDefaultTimeout(ms) {
			timeouts.push(ms);
		},
		waitForFunction: async () => true,
		async reload() {
			hung = false;
		},
		evaluate: () => hung ? new Promise(() => { }) : Promise.resolve('ok'),
	};
}

function mockFrame(url, canvasCount) {
	return {
		url: () => url,
		locator: selector => ({
			count: async () => selector === '#netCanvas' ? canvasCount : 0,
		}),
	};
}

function appliedTheme(id, workbenchClass) {
	return { query: id, applied: true, workbenchClass };
}

function provenA11y() {
	return {
		keyboardFocus: true,
		focus: { ok: true, tag: 'TEXTAREA', role: 'textbox', outline: 'solid' },
		graphCanvasFocus: true,
		zoom200: true,
		beforeZoom: { zoom: 1, width: 1200, zoomLevel: 0, innerWidth: 1200 },
		afterZoom: { zoom: 2, width: 600, zoomLevel: 2, innerWidth: 600 },
		screenReaderAuto: 'auto',
		screenReaderOn: 'on',
		graphLiveRegion: true,
		mapsAriaExpanded: true,
		mapsLayoutGroup: true,
		settingsStatusRole: 'status',
		settingsStatusClaimsAvailable: false,
		graphCanvasRole: 'region',
		prebaseForcesAccessibilityOff: false,
	};
}

function passingCodeGraph(overrides = {}) {
	return {
		opened: true,
		metricName: GRAPH_RENDER_METRICS_NAME,
		metrics: { nodesDrawn: 12, receivedNodeCount: 12, labelCount: 6, projectedBounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 } },
		nodesDrawn: true,
		selection: true,
		layoutModes: true,
		legacyRadialNormalized: true,
		rotate: true,
		drag: true,
		idleRotateArmed: true,
		semanticZoom: true,
		pick: true,
		sphereVsClustered: true,
		labelDensity: true,
		selectionLock: true,
		...overrides,
	};
}

function passingCore(overrides = {}) {
	return {
		c3_folderOpen: true,
		c5_reload: true,
		e1_saveUndo: true,
		e2_search: true,
		e3_scm: true,
		e4_terminal: true,
		e5_debug: true,
		e6_typescript: true,
		p1_settings: true,
		p2_offline: true,
		p4_runtime: true,
		p5_magnus: true,
		codeGraph: passingCodeGraph(),
		themes: {
			dark: appliedTheme('dark', 'monaco-workbench vs-dark'),
			light: appliedTheme('light', 'monaco-workbench vs'),
			hcDark: appliedTheme('hcDark', 'monaco-workbench hc-black'),
			hcLight: appliedTheme('hcLight', 'monaco-workbench hc-light'),
		},
		a11y: provenA11y(),
		quit: { remaining: 'gone', terminationPath: 'workbench', usedSigkill: false, usedSigterm: false },
		...overrides,
	};
}

function privacyMethodology(overrides = {}) {
	return {
		andSemantics: true,
		processTree: true,
		hostnameIdentity: true,
		lsofArgs: lsofSelectionArgs(['12', '34']),
		...overrides,
	};
}

test('lsof selection uses AND semantics', () => {
	const args = lsofSelectionArgs(['12', '34']);
	assert.deepEqual(args, ['-a', '-P', '-iTCP', '-p', '12,34']);
	assert.ok(args.includes('-a'));
	assert.ok(args.indexOf('-a') < args.indexOf('-p'));
	assert.ok(args.indexOf('-a') < args.indexOf('-iTCP'));
	assert.notDeepEqual(args.filter(item => item !== '-a'), args, 'OR-only lsof (-p or -i without -a) is a false privacy observation');
});

test('numeric IPs are unresolved, not a telemetry-absent proof', () => {
	const classified = classifyHosts(['127.0.0.1', '13.107.42.14', 'vortex.data.microsoft.com']);
	assert.deepEqual(classified.expected, ['127.0.0.1']);
	assert.deepEqual(classified.unresolved, ['13.107.42.14']);
	assert.deepEqual(classified.forbidden, ['vortex.data.microsoft.com']);
});

test('private and CGNAT addresses are expected, not unresolved', () => {
	const classified = classifyHosts(['10.0.0.10', '100.64.1.2', '192.168.1.1', '::1', '13.107.42.14']);
	assert.deepEqual(classified.expected, ['10.0.0.10', '100.64.1.2', '192.168.1.1', '::1']);
	assert.deepEqual(classified.unresolved, ['13.107.42.14']);
});

test('socket-only numeric IPs do not fail when CDP hostnames exist', () => {
	assert.deepEqual(privacyFailures({
		methodology: privacyMethodology(),
		forbiddenHosts: [],
		unresolvedNumericHosts: [],
		socketUnresolvedHosts: ['13.107.42.14'],
		quit: { remaining: 'gone', terminationPath: 'workbench', usedSigkill: false },
	}), []);
});

test('privacy cannot pass on unresolved numeric destinations', () => {
	const failures = privacyFailures({
		methodology: privacyMethodology(),
		forbiddenHosts: [],
		unresolvedNumericHosts: ['13.107.42.14'],
		quit: { remaining: 'gone', terminationPath: 'workbench' },
	});
	assert.ok(failures.some(item => /unresolved/.test(item)));
});

test('privacy AND claim without -a in lsofArgs fails the gate', () => {
	const failures = privacyFailures({
		methodology: privacyMethodology({ andSemantics: true, lsofArgs: ['-P', '-iTCP', '-p', '12,34'] }),
		forbiddenHosts: [],
		quit: { remaining: 'gone', terminationPath: 'workbench' },
	});
	assert.ok(failures.some(item => /AND/.test(item)));
});

test('privacy fails when process-tree coverage is missing', () => {
	const failures = privacyFailures({
		methodology: privacyMethodology({ processTree: false }),
		forbiddenHosts: [],
		quit: { remaining: 'gone', terminationPath: 'workbench' },
	});
	assert.ok(failures.some(item => /process tree/.test(item)));
});

test('privacy process-tree + AND methodology can pass on a workbench quit', () => {
	assert.deepEqual(privacyFailures({
		methodology: privacyMethodology(),
		forbiddenHosts: [],
		quit: { remaining: 'gone', terminationPath: 'workbench', usedSigkill: false },
	}), []);
});

test('process-tree socket sampler uses lsof AND semantics', () => {
	const source = readFileSync(join(acceptanceDir, 'workbenchHarness.mjs'), 'utf8');
	assert.match(source, /execFileSync\('lsof',\s*\['-a',\s*'-P',\s*'-iTCP',\s*'-p'/);
	assert.match(source, /terminationPath = 'workbench'/);
	assert.match(source, /terminationPath = 'sigterm'/);
	assert.match(source, /terminationPath = 'sigkill'/);
	assert.match(source, /usedSigkill: terminationPath === 'sigkill'/);
	assert.match(source, /remainingOwnedPids/);
	assert.match(source, /leftoverPids: leftover/);
	assert.match(source, /remaining: leftover.length === 0 \? 'gone' : 'tree'/);
	assert.match(source, /setDefaultTimeout\(12_000\)/);
	assert.match(source, /signalProcessTree\(info.pid, 'SIGTERM'/);
	assert.match(source, /if \(disposed\)/);
	assert.match(source, /requests.length >= 400/);
	assert.doesNotMatch(source, /setDefaultTimeout\(180_000\)/);
	assert.doesNotMatch(source, /frames\(\)\.find\s*\(\s*async/);
});

test('launchPreBase waits for the workbench page after CDP connect', () => {
	const source = readFileSync(join(acceptanceDir, 'workbenchHarness.mjs'), 'utf8');
	const body = exportedSource(source, 'launchPreBase');
	assert.match(body, /waitFor\(async \(\) =>/);
	assert.match(body, /candidate\.url\(\)\.includes\('workbench'\)/);
	assert.match(body, /45_000/);
});

test('workbenchCommandWithTimeout races evaluate against an explicit timer', () => {
	const source = readFileSync(join(acceptanceDir, 'workbenchHarness.mjs'), 'utf8');
	const body = exportedSource(source, 'workbenchCommandWithTimeout');
	assert.match(body, /Promise\.race\(/);
	assert.match(body, /workbench command timeout \(\$\{timeoutMs\}ms\): \$\{commandId\}/);
	assert.match(body, /page\.evaluate\(/);
	assert.match(body, /evaluateOptions = \{ timeout: timeoutMs \}/);
	assert.doesNotMatch(body, /recoverHungWorkbenchPage/);
	assert.doesNotMatch(body, /commandArgs: args \},\s*\{ timeout/);
	assert.doesNotMatch(body, /usedSigkill|latencyMs\s*>/);
});

test('recoverHungWorkbenchPage reloads after a hung evaluate so later commands can proceed', { timeout: 1_500 }, async () => {
	const page = recoveringEvaluatePage();
	await recoverHungWorkbenchPage(page, 60);
	assert.equal(await workbenchCommandWithTimeout(page, 60, 'prebase.graph.openNetwork'), 'ok');
});

test('hung page.evaluate cannot block workbenchCommandWithTimeout for minutes', { timeout: 1_500 }, async () => {
	const page = hangingEvaluatePage();
	const started = Date.now();
	await assert.rejects(
		() => workbenchCommandWithTimeout(page, 60, 'workbench.action.reloadWindow'),
		/workbench command timeout \(60ms\): workbench\.action\.reloadWindow/,
	);
	assert.ok(Date.now() - started < 1_000, 'Promise.race must reject the hung evaluate before Playwright default timeouts');
	assert.deepEqual(page.timeouts, [60, 12_000], 'default timeout must be restored after a hung evaluate');
});

test('waitForWorkbenchDriver races whenWorkbenchRestored against an explicit timer', () => {
	const source = readFileSync(join(acceptanceDir, 'workbenchHarness.mjs'), 'utf8');
	const body = exportedSource(source, 'waitForWorkbenchDriver');
	assert.match(body, /Promise\.race\(/);
	assert.match(body, /whenWorkbenchRestored timeout \(\$\{timeoutMs\}ms\)/);
	assert.match(body, /page\.evaluate\(\(\) => window\.driver\.whenWorkbenchRestored\(\)\)/);
	assert.match(body, /waitForFunction\([\s\S]*?\{ timeout: timeoutMs \}/);
});

test('hung whenWorkbenchRestored cannot block waitForWorkbenchDriver forever', { timeout: 1_500 }, async () => {
	const page = hangingEvaluatePage();
	const started = Date.now();
	await assert.rejects(
		() => waitForWorkbenchDriver(page, 60),
		/whenWorkbenchRestored timeout \(60ms\)/,
	);
	assert.ok(Date.now() - started < 1_000, 'whenWorkbenchRestored must be Promise.raced, not left to hang');
});

test('gracefulWorkbenchQuit records workbench|sigterm|sigkill and does not infer SIGKILL from elapsed time', () => {
	const source = readFileSync(join(acceptanceDir, 'workbenchHarness.mjs'), 'utf8');
	const body = exportedSource(source, 'gracefulWorkbenchQuit');
	assert.match(body, /terminationPath = 'workbench'/);
	assert.match(body, /terminationPath = 'sigterm'/);
	assert.match(body, /terminationPath = 'sigkill'/);
	assert.match(body, /usedSigkill: terminationPath === 'sigkill'/);
	assert.doesNotMatch(body, /usedSigkill:[^\n]*latencyMs/);
	assert.doesNotMatch(body, /latencyMs\s*[><=].*sigkill/i);
});

test('high quit latency on a workbench path does not fail SIGKILL gates', () => {
	const quit = { remaining: 'gone', terminationPath: 'workbench', usedSigkill: false, usedSigterm: false, latencyMs: 60_000 };
	assert.equal(coreIdeFailures(passingCore({ quit })).some(item => /SIGKILL/.test(item)), false);
	assert.equal(privacyFailures({ methodology: privacyMethodology(), forbiddenHosts: [], quit }).some(item => /SIGKILL/.test(item)), false);
	assert.equal(loadQuitFailures([
		{ scenario: 'parser-active-1', parserActiveRequests: 2, quit },
	]).some(item => /SIGKILL/.test(item)), false);
});

test('privacy runtime source observes the process tree, not only the root pid', () => {
	const source = readFileSync(join(acceptanceDir, 'prebase-privacy-runtime.mjs'), 'utf8');
	assert.match(source, /processTree\(launched\.info\.pid\)/);
	assert.match(source, /sampleProcessTreeSockets\(tree\.map\(row => row\.pid\)\)/);
});

test('workbench quit path does not fail SIGKILL gates', () => {
	const quit = { remaining: 'gone', terminationPath: 'workbench', usedSigkill: false, usedSigterm: false };
	assert.equal(coreIdeFailures(passingCore({ quit })).some(item => /SIGKILL/.test(item)), false);
	assert.equal(privacyFailures({ methodology: privacyMethodology(), forbiddenHosts: [], quit }).some(item => /SIGKILL/.test(item)), false);
	assert.equal(activeSoakFailures({
		samples: [
			{ phase: 'active', processCount: 8, cpuSum: 20 },
			{ phase: 'active', processCount: 8, cpuSum: 22 },
			{ phase: 'active', processCount: 8, cpuSum: 18 },
			{ phase: 'active', processCount: 8, cpuSum: 19 },
			{ phase: 'quiesce', processCount: 8, cpuSum: 4 },
			{ phase: 'quiesce', processCount: 8, cpuSum: 3 },
		],
		quit,
	}).some(item => /SIGKILL/.test(item)), false);
});

test('sigterm fallback does not fail SIGKILL gates', () => {
	const quit = { remaining: 'gone', terminationPath: 'sigterm', usedSigkill: false, usedSigterm: true };
	assert.equal(coreIdeFailures(passingCore({ quit })).some(item => /SIGKILL/.test(item)), false);
	assert.equal(loadQuitFailures([
		{ scenario: 'parser-active-1', parserActiveRequests: 2, quit },
	]).some(item => /SIGKILL/.test(item)), false);
});

test('Magnus stream live path installs smoke transport then asks the chat participant', () => {
	const source = readFileSync(join(acceptanceDir, 'prebase-magnus-stream-live.mjs'), 'utf8');
	assert.match(source, /workbenchCommand\(launched\.page, 'prebase\.test\.installMagnusSmokeTransport'\)/);
	assert.match(source, /workbenchCommand\(launched\.page, 'workbench\.action\.chat\.open'/);
	assert.match(source, /query: 'prebase-smoke-stream'/);
	assert.match(source, /prebase\.test\.getDiagnostics/);
	assert.match(source, /magnusSourceChunks/);
	assert.match(source, /sourceChunksMax/);
	assert.match(source, /completes > completesBeforeSecond/);
	assert.doesNotMatch(source, /magnusStreamActive > 0 \|\| \/Smoke stream chunk/);
	assert.doesNotMatch(source, /chunkCount = \(first\?\.text\.match/);
	assert.doesNotMatch(source, /streamGenerate\(/);
	assert.doesNotMatch(source, /new MagnusSmokeTransportAdapter/);
});

test('Magnus stream cannot pass without install, progressive chunks, cancel, and a second request', () => {
	const quit = { remaining: 'gone', terminationPath: 'workbench', usedSigkill: false };
	assert.ok(magnusStreamFailures({
		smokeInstalled: false,
		firstChunkAt: 10,
		uiTextAt: 20,
		chunkCount: 3,
		completed: true,
		cancelled: true,
		secondRequestOk: true,
		quit,
	}).some(item => /smoke transport was not installed/.test(item)));
	assert.ok(magnusStreamFailures({
		smokeInstalled: true,
		firstChunkAt: 10,
		uiTextAt: 20,
		chunkCount: 1,
		completed: true,
		cancelled: true,
		secondRequestOk: true,
		quit,
	}).some(item => /multiple progressive chunks/.test(item)));
	assert.ok(magnusStreamFailures({
		smokeInstalled: true,
		firstChunkAt: 10,
		uiTextAt: 20,
		chunkCount: 3,
		completed: true,
		cancelled: true,
		secondRequestOk: false,
		quit,
	}).some(item => /second prompt after cancel/.test(item)));
	assert.ok(magnusStreamFailures({
		smokeInstalled: true,
		firstChunkAt: 10,
		uiTextAt: 20,
		chunkCount: 3,
		completed: true,
		cancelled: false,
		secondRequestOk: true,
		quit,
	}).some(item => /cancellation was not observed/.test(item)));
	assert.ok(magnusStreamFailures({
		smokeInstalled: true,
		firstChunkAt: 10,
		uiTextAt: 20,
		chunkCount: 3,
		completed: true,
		cancelled: true,
		secondRequestOk: true,
		quit,
	}).some(item => /source chunk count did not increase/.test(item)));
});

test('SIGKILL fails gates even when usedSigkill is omitted', () => {
	const quit = { remaining: 'gone', terminationPath: 'sigkill' };
	assert.ok(coreIdeFailures(passingCore({ quit })).some(item => /SIGKILL/.test(item)));
	assert.ok(privacyFailures({ methodology: privacyMethodology(), forbiddenHosts: [], quit }).some(item => /SIGKILL/.test(item)));
	assert.ok(activeSoakFailures({
		samples: [
			{ phase: 'active', processCount: 8, cpuSum: 20 },
			{ phase: 'active', processCount: 8, cpuSum: 20 },
			{ phase: 'active', processCount: 8, cpuSum: 20 },
			{ phase: 'active', processCount: 8, cpuSum: 20 },
			{ phase: 'quiesce', processCount: 8, cpuSum: 4 },
			{ phase: 'quiesce', processCount: 8, cpuSum: 3 },
		],
		quit,
	}).some(item => /SIGKILL/.test(item)));
	assert.ok(magnusStreamFailures({
		smokeInstalled: true,
		firstChunkAt: 10,
		uiTextAt: 20,
		chunkCount: 3,
		completed: true,
		cancelled: true,
		secondRequestOk: true,
		quit,
	}).some(item => /SIGKILL/.test(item)));
});

test('product marketplace and update CDNs are expected, telemetry hosts remain forbidden', () => {
	const classified = classifyHosts(['marketplace.visualstudio.com', 'cdn.vsassets.io', 'open-vsx.org', 'vortex.data.microsoft.com']);
	assert.ok(classified.expected.includes('marketplace.visualstudio.com'));
	assert.ok(classified.expected.includes('open-vsx.org'));
	assert.ok(classified.expected.includes('cdn.vsassets.io'));
	assert.deepEqual(classified.forbidden, ['vortex.data.microsoft.com']);
});

test('privacy fails on forbidden hostnames even when CDP has other hostnames', () => {
	const failures = privacyFailures({
		methodology: privacyMethodology(),
		forbiddenHosts: ['vortex.data.microsoft.com'],
		unresolvedNumericHosts: [],
		socketUnresolvedHosts: [],
		quit: { remaining: 'gone', terminationPath: 'workbench', usedSigkill: false },
	});
	assert.ok(failures.some(item => /forbidden/.test(item)));
});

test('privacy fails when CDP hostname identity is missing', () => {
	const failures = privacyFailures({
		methodology: privacyMethodology({ hostnameIdentity: false }),
		forbiddenHosts: [],
		quit: { remaining: 'gone', terminationPath: 'workbench' },
	});
	assert.ok(failures.some(item => /hostname/.test(item)));
});

test('CDP Network.requestWillBeSent is the hostname identity source', () => {
	const source = readFileSync(join(acceptanceDir, 'workbenchHarness.mjs'), 'utf8');
	assert.match(source, /session\.on\('Network\.requestWillBeSent'/);
	assert.match(source, /async function attachCdpNetworkObserver/);
	assert.match(source, /Network\.disable/);
	assert.match(source, /if \(disposed\)/);
	assert.doesNotMatch(source, /Network\.responseReceived/);
	const privacy = readFileSync(join(acceptanceDir, 'prebase-privacy-runtime.mjs'), 'utf8');
	assert.match(privacy, /attachCdpNetworkObserver\(launched\.page\)/);
	assert.match(privacy, /unresolvedNumericHosts = classifiedCdp\.unresolved/);
	assert.match(privacy, /socketUnresolvedHosts = classifiedSockets\.unresolved/);
	assert.doesNotMatch(privacy, /unresolvedNumericHosts = classifiedSockets/);
});

test('privacy fails on unexpected CDP hostnames', () => {
	const failures = privacyFailures({
		methodology: privacyMethodology(),
		forbiddenHosts: [],
		unexpectedHosts: ['evil-telemetry.example'],
		unresolvedNumericHosts: [],
		quit: { remaining: 'gone', terminationPath: 'workbench', usedSigkill: false },
	});
	assert.ok(failures.some(item => /unexpected/.test(item)));
});

test('privacy cannot pass after SIGKILL', () => {
	const failures = privacyFailures({
		methodology: privacyMethodology(),
		forbiddenHosts: [],
		quit: { remaining: 'gone', usedSigkill: true, terminationPath: 'sigkill' },
	});
	assert.ok(failures.some(item => /SIGKILL/.test(item)));
});

test('Promise-returning Array.find would pick the wrong graph frame', async () => {
	const frames = [mockFrame('about:blank', 0), mockFrame('https://webview/graph-editor', 1)];
	const buggy = frames.find(async frame => (await frame.locator('#netCanvas').count()) > 0);
	assert.equal(buggy.url(), 'about:blank');
	const found = await findGraphFrame({ frames: () => frames });
	assert.equal(found.url(), 'https://webview/graph-editor');
});

test('findGraphFrame awaits canvas presence instead of treating a Promise as a hit', async () => {
	const frames = [mockFrame('vscode-webview://other', 0), mockFrame('vscode-webview://graph', 2)];
	const found = await findGraphFrame({ frames: () => frames });
	assert.equal(found.url(), 'vscode-webview://graph');
});

test('findGraphFrame matches graph-editor URLs even before canvas count is positive', async () => {
	const frames = [mockFrame('about:blank', 0), mockFrame('https://file/graph-editor/index.html', 0)];
	const found = await findGraphFrame({ frames: () => frames });
	assert.ok(found.url().includes('graph-editor'));
});

test('visible canvas is not nodesDrawn', () => {
	assert.equal(nodesDrawnFromMetrics({ canvasVisible: true }), false);
	assert.equal(nodesDrawnFromMetrics({ canvasVisible: true, width: 800, height: 600, nodesDrawn: 0, receivedNodeCount: 0 }), false);
	assert.equal(nodesDrawnFromMetrics({ nodesDrawn: true }), false);
	assert.equal(nodesDrawnFromMetrics({ nodesDrawn: 12 }), true);
	assert.equal(nodesDrawnFromMetrics({ receivedNodeCount: 3 }), false);
	assert.equal(nodesDrawnFromMetrics({ receivedNodeCount: 12, nodesDrawn: 0 }), false);
});

test('wrong graph metrics global cannot satisfy nodesDrawn', () => {
	const failures = coreIdeFailures(passingCore({
		codeGraph: {
			opened: true,
			metricName: '__prebaseGraphMetrics',
			metrics: { nodesDrawn: 12, receivedNodeCount: 12 },
			nodesDrawn: true,
			selection: true,
		},
	}));
	assert.ok(failures.some(item => /__prebaseGraphRenderMetrics/.test(item)));
});

test('blank canvas metrics cannot satisfy nodesDrawn', () => {
	const failures = coreIdeFailures(passingCore({
		codeGraph: {
			opened: true,
			metricName: GRAPH_RENDER_METRICS_NAME,
			metrics: { canvasVisible: true, nodesDrawn: 0, receivedNodeCount: 0 },
			nodesDrawn: true,
			selection: true,
		},
	}));
	assert.ok(failures.some(item => /did not draw nodes/.test(item)));
});

test('keyboard focus cannot pass merely because activeElement is not body', () => {
	const untagged = themesA11yFailures(passingCore({
		a11y: {
			keyboardFocus: true,
			focus: { ok: true },
			graphCanvasFocus: true,
			zoom200: true,
			beforeZoom: { zoom: 1, zoomLevel: 0, innerWidth: 1200 },
			afterZoom: { zoom: 2, zoomLevel: 2, innerWidth: 600 },
		},
	}));
	assert.ok(untagged.some(item => /Keyboard focus/.test(item)));
	const emptyTag = themesA11yFailures(passingCore({
		a11y: {
			keyboardFocus: true,
			focus: { ok: true, tag: '' },
			graphCanvasFocus: true,
			zoom200: true,
			beforeZoom: { zoom: 1, zoomLevel: 0, innerWidth: 1200 },
			afterZoom: { zoom: 2, zoomLevel: 2, innerWidth: 600 },
		},
	}));
	assert.ok(emptyTag.some(item => /Keyboard focus/.test(item)));
});

test('core IDE live records focus.tag from activeElement and rejects body-only focus', () => {
	const live = readFileSync(join(acceptanceDir, 'prebase-core-ide-live.mjs'), 'utf8');
	assert.match(live, /if \(!active \|\| active === document\.body\)/);
	assert.match(live, /tag: active\.tagName/);
	assert.match(live, /focus\.ok === true && focus\.tag/);
	assert.match(live, /window\.__prebaseGraphRenderMetrics/);
	assert.doesNotMatch(live, /__prebaseGraphMetrics/);
});

test('core IDE rejects hardcoded theme/a11y-only evidence', () => {
	const booleanThemes = coreIdeFailures(passingCore({
		themes: { dark: true, light: true, hcDark: true, hcLight: true },
		a11y: { keyboardFocus: true, zoom200: true, graphCanvasFocus: true },
	}));
	assert.ok(booleanThemes.some(item => /Theme/.test(item)));
	assert.ok(booleanThemes.some(item => /Keyboard focus/.test(item)));
	assert.ok(booleanThemes.some(item => /zoom/.test(item)));

	const missingLight = coreIdeFailures(passingCore({
		themes: {
			dark: appliedTheme('dark', 'monaco-workbench vs-dark'),
			light: appliedTheme('light', 'monaco-workbench vs-dark'),
			hcDark: appliedTheme('hcDark', 'monaco-workbench hc-black'),
			hcLight: appliedTheme('hcLight', 'monaco-workbench hc-light'),
		},
	}));
	assert.ok(missingLight.some(item => /Theme/.test(item)));
});

test('core IDE accepts real dark/light/hcDark/hcLight plus measured zoom and focus', () => {
	assert.deepEqual(coreIdeFailures(passingCore()), []);
});

test('200% zoom cannot pass on unchanged workbench zoomLevel', () => {
	const failures = themesA11yFailures(passingCore({
		a11y: {
			keyboardFocus: true,
			focus: { ok: true, tag: 'TEXTAREA', role: 'textbox', outline: 'solid' },
			graphCanvasFocus: true,
			zoom200: true,
			beforeZoom: { zoom: 2, zoomLevel: 0, innerWidth: 1440 },
			afterZoom: { zoom: 2, zoomLevel: 0, innerWidth: 1440 },
		},
	}));
	assert.ok(failures.some(item => /zoom/.test(item)));
});

test('200% zoom cannot pass on innerWidth change with unchanged zoomLevel', () => {
	const failures = themesA11yFailures(passingCore({
		a11y: {
			keyboardFocus: true,
			focus: { ok: true, tag: 'TEXTAREA', role: 'textbox', outline: 'solid' },
			graphCanvasFocus: true,
			zoom200: true,
			beforeZoom: { zoom: 1, zoomLevel: 0, innerWidth: 1440 },
			afterZoom: { zoom: 2, zoomLevel: 0, innerWidth: 720 },
		},
	}));
	assert.ok(failures.some(item => /zoom/.test(item)));
});

test('a11y cannot pass on accessibilitySupport auto/on without Maps, Settings, and graph semantics', () => {
	const settingOnly = themesA11yFailures(passingCore({
		a11y: {
			keyboardFocus: true,
			focus: { ok: true, tag: 'TEXTAREA', role: 'textbox', outline: 'solid' },
			graphCanvasFocus: true,
			zoom200: true,
			beforeZoom: { zoom: 1, zoomLevel: 0, innerWidth: 1200 },
			afterZoom: { zoom: 2, zoomLevel: 2, innerWidth: 600 },
			screenReaderAuto: 'auto',
			screenReaderOn: 'on',
			graphLiveRegion: true,
			prebaseForcesAccessibilityOff: false,
		},
	}));
	assert.ok(settingOnly.some(item => /Maps disclosures/.test(item)));
	assert.ok(settingOnly.some(item => /layout group/.test(item)));
	assert.ok(settingOnly.some(item => /web-search status live region/.test(item)));
	assert.ok(settingOnly.some(item => /canvas region role/.test(item)));
	assert.equal(settingOnly.some(item => /screen-reader/.test(item)), false, 'setting values must not be treated as sufficient a11y proof');
	const availableStatus = themesA11yFailures(passingCore({
		a11y: { ...provenA11y(), settingsStatusClaimsAvailable: true },
	}));
	assert.ok(availableStatus.some(item => /must not claim available/.test(item)));
});

test('core IDE live inspects Maps aria-expanded, Settings status, and Code Graph region rather than only accessibilitySupport', () => {
	const live = readFileSync(join(acceptanceDir, 'prebase-core-ide-live.mjs'), 'utf8');
	assert.match(live, /button\[aria-expanded\]/);
	assert.match(live, /\[role="group"\]\[aria-label\]/);
	assert.match(live, /ensureSidebar\(launched\.page\)/);
	assert.match(live, /workbench\.view\.prebase\.maps/);
	assert.match(live, /prebase\.settings\.open/);
	assert.match(live, /\[role="status"\]/);
	assert.match(live, /settingsStatusRole/);
	assert.match(live, /graphCanvasRole/);
	assert.match(live, /netCanvas.*getAttribute\('role'\)/);
	const mapsCollect = live.indexOf("locator('.prebase-maps-view [role=\"group\"][aria-label]')");
	const activityBar = live.indexOf('workbench.action.focusActivityBar');
	assert.ok(mapsCollect > 0 && activityBar > 0 && activityBar < mapsCollect, 'Maps semantics must be collected after reopening Maps, not from a leftover sidebar');
	assert.doesNotMatch(live, /screen reader was used|VoiceOver|NVDA|JAWS/i);
});

test('organic then organic cannot satisfy layoutModes or Sphere vs Clustered', () => {
	assert.deepEqual(codeGraphFailures({ codeGraph: passingCodeGraph() }), []);
	const failures = codeGraphFailures({
		codeGraph: passingCodeGraph({
			layoutModes: false,
			sphereVsClustered: false,
			metrics: { nodesDrawn: 12, receivedNodeCount: 12, networkLayoutMode: 'organic' },
		}),
	});
	assert.ok(failures.some(item => /N2 all 4 layout modes/.test(item)));
	assert.ok(failures.some(item => /N8 Sphere vs Clustered/.test(item)));
});

test('code graph fails when legacy radial normalization or semantic zoom or label density is missing', () => {
	const f1 = codeGraphFailures({ codeGraph: passingCodeGraph({ legacyRadialNormalized: false }) });
	assert.ok(f1.some(item => /N2 legacy radial layout was not normalized to organic/.test(item)));

	const f2 = codeGraphFailures({ codeGraph: passingCodeGraph({ semanticZoom: false }) });
	assert.ok(f2.some(item => /N6 semantic zoom/.test(item)));

	const f3 = codeGraphFailures({ codeGraph: passingCodeGraph({ labelDensity: false }) });
	assert.ok(f3.some(item => /N9 dynamic label density/.test(item)));
});

test('core IDE fails when e5_debug, e6_typescript, or p2_offline is missing', () => {
	assert.deepEqual(coreIdeFailures(passingCore()), []);
	const debugFail = coreIdeFailures(passingCore({ e5_debug: false }));
	assert.ok(debugFail.some(item => /E5 debug/.test(item)));

	const tsFail = coreIdeFailures(passingCore({ e6_typescript: false }));
	assert.ok(tsFail.some(item => /E6 TypeScript/.test(item)));

	const offlineFail = coreIdeFailures(passingCore({ p2_offline: false }));
	assert.ok(offlineFail.some(item => /P2 offline/.test(item)));
});

test('code graph screenshot is not a substitute for render metrics', () => {
	const failures = codeGraphFailures({
		codeGraph: passingCodeGraph({
			screenshot: true,
			screenshotPath: 'reports/graph-acceptance/phase-3-final/screenshots/code-graph-live.png',
			metrics: { canvasVisible: true, screenshotOk: true, nodesDrawn: 0, receivedNodeCount: 0 },
			nodesDrawn: true,
		}),
	});
	assert.ok(failures.some(item => /nodesDrawn/.test(item)));
	assert.equal(failures.some(item => /screenshot/.test(item)), false);
});

test('core-ide live proves layouts via Maps data-network-layout chips and metrics, not screenshots', () => {
	const live = readFileSync(join(acceptanceDir, 'prebase-core-ide-live.mjs'), 'utf8');
	const maps = readFileSync(join(acceptanceDir, '../../../graphs/src/host/workbench/prebaseMapsView.ts'), 'utf8');
	assert.match(maps, /dataset\['networkLayout'\] = m\.id/);
	assert.match(maps, /layoutCol\.style\.flexWrap = 'wrap'/);
	assert.match(maps, /localize\('prebase\.maps\.liveBadge', "Live"\)/);
	assert.doesNotMatch(maps, /textContent = ['"]●|localize\([^)]*●/);
	assert.match(live, /button\[data-network-layout="\$\{mode\}"\]/);
	assert.match(live, /layoutModes: Boolean\(organicMode === 'organic' && sphereMode === 'sphere' && constellationMode === 'constellation' && clusteredMode === 'clustered'\)/);
	assert.match(live, /legacyRadialNormalized: Boolean\(legacyRadialNormalized\)/);
	assert.match(live, /sphereVsClustered: sphereMode === 'sphere' && clusteredMode === 'clustered'/);
	assert.match(live, /screenshot\(\{ path: join\(screenshotDir, 'code-graph-live\.png'\), timeout: 5_000 \}\)\.catch\(\(\) => undefined\)/);
	assert.match(live, /nodesDrawnFromMetrics/);
	assert.match(live, /waitForTimeout\(1_800\)/);
	assert.match(live, /selectedNodeId === pickHit\.id/);
	assert.doesNotMatch(live, /codeGraph\.screenshot/);
	assert.doesNotMatch(live, /afterInner !== beforeInner|devicePixelRatio/);
	assert.doesNotMatch(live, /Math\.max\(8, hits\[0\]\.x\)/);
	assert.match(live, /after > before/);
});

test('Runtime Preview and Desktop Test Lab keep Detect accessible name and primary/secondary hierarchy', () => {
	const runtime = readFileSync(join(repoRoot, 'src/vs/workbench/contrib/prebase/browser/prebaseRuntimeView.ts'), 'utf8');
	assert.match(runtime, /localize\('prebase\.runtime\.detect', "Detect"\)/);
	assert.match(runtime, /localize\('prebase\.runtime\.detectAria', "Detect Configurations"\)/);
	assert.match(runtime, /setAttribute\('aria-label', localize\('prebase\.runtime\.detectAria'/);
	const start = runtime.indexOf("localize('prebase.runtime.start'");
	const detect = runtime.indexOf("localize('prebase.runtime.detect'");
	const startPrimary = runtime.slice(start, start + 280);
	const detectSlice = runtime.slice(detect, detect + 280);
	assert.match(startPrimary, /'primary'/);
	assert.match(detectSlice, /'secondary'/);
	assert.match(runtime, /localize\('prebase\.runtime\.desktopStart', "Start Desktop"\)[\s\S]{0,120}'primary'/);
	assert.match(runtime, /localize\('prebase\.runtime\.desktopStop', "Stop Desktop"\)[\s\S]{0,120}'secondary'/);
	assert.match(runtime, /--vscode-button-background/);
	assert.match(runtime, /--vscode-button-secondaryBackground/);
	assert.match(runtime, /--vscode-button-foreground/);
	assert.match(runtime, /--vscode-button-secondaryForeground/);
	assert.match(runtime, /btn\.style\.width = 'auto'/);
	assert.doesNotMatch(runtime, /btn\.style\.width = '100%'/);
});

test('Web Search settings put hosted hybrid first and hide local keys behind details', () => {
	const settings = readFileSync(join(repoRoot, 'src/vs/workbench/contrib/prebase/browser/prebaseSettingsEditor.ts'), 'utf8');
	assert.match(settings, /hostedStatus\.setAttribute\('role', 'status'\)/);
	assert.match(settings, /!cloudConfigured\s*\n\s*\? localize\('prebase\.settings\.ai\.webSearchUnconfigured'/);
	assert.match(settings, /: signedIn\s*\n\s*\? localize\('prebase\.settings\.ai\.webSearchSignedIn'/);
	assert.match(settings, /: localize\('prebase\.settings\.ai\.webSearchSignedOut'/);
	assert.match(settings, /hosted hybrid web context when you are signed in/);
	assert.match(settings, /Sign in to use hosted web context/);
	assert.match(settings, /Hosted web context will be used/);
	assert.match(settings, /Cloud sign-in is not configured/);
	assert.match(settings, /Configure local web search…/);
	assert.doesNotMatch(settings, /webSearchAvailable|Hosted Hybrid Web Context is available|Hosted web context is available/);
	assert.doesNotMatch(settings, /webSearchProvider|Firecrawl Interact|provider picker/i);
	const hostedIdx = settings.indexOf('webSearchSignedIn');
	const advancedIdx = settings.indexOf('webSearchAdvanced');
	const detailsIdx = settings.indexOf("document.createElement('details')");
	assert.ok(hostedIdx > 0 && advancedIdx > hostedIdx, 'hosted hybrid copy must appear before local-key advanced summary');
	assert.ok(detailsIdx > 0 && settings.indexOf('setLinkupKey') > detailsIdx, 'local discovery key controls must live inside details');
	assert.ok(settings.indexOf('setFirecrawlKey') > detailsIdx, 'local page-fetch key controls must live inside details');
	assert.match(settings, /resetBtn\.textContent = localize\('prebase\.settings\.resetAll', "Reset all"\)/);
	assert.doesNotMatch(settings, /⟳|Reset all ⟳|textContent = ['"]⟳/);
	assert.match(settings, /--vscode-button-background/);
	assert.match(settings, /--vscode-button-secondaryBackground/);
	const onboarding = readFileSync(join(repoRoot, 'src/vs/workbench/contrib/prebase/browser/prebaseOnboardingEditor.ts'), 'utf8');
	assert.match(onboarding, /--vscode-button-background/);
	assert.match(onboarding, /--vscode-button-secondaryBackground/);
	assert.match(onboarding, /--vscode-button-foreground/);
	assert.match(onboarding, /--vscode-button-secondaryForeground/);
	const home = readFileSync(join(repoRoot, 'src/vs/workbench/contrib/prebase/browser/prebaseHomeEditor.ts'), 'utf8');
	assert.match(home, /--vscode-button-background/);
	assert.match(home, /--vscode-button-secondaryBackground/);
	assert.match(home, /--vscode-button-foreground/);
	assert.match(home, /--vscode-button-secondaryForeground/);
	assert.doesNotMatch(home, /primary \? '#042f2e'/);
});

test('inert Settings sliders are hidden and Maps disclosures use Codicon twisties', () => {
	const settings = readFileSync(join(repoRoot, 'src/vs/workbench/contrib/prebase/browser/prebaseSettingsEditor.ts'), 'utf8');
	assert.doesNotMatch(settings, /Reserved —/);
	assert.doesNotMatch(settings, /sidebarMinWidth|collapseLongSections|ui\.density/);
	assert.doesNotMatch(settings, /Hosted Hybrid Web Context is the default for signed-in users/);
	assert.doesNotMatch(settings, /textContent = localize\('prebase\.settings\.save'/);
	assert.doesNotMatch(settings, /"Save"/);
	const graphSettings = readFileSync(join(repoRoot, 'graphs/src/host/workbench/settings/graphSettingsUi.ts'), 'utf8');
	assert.doesNotMatch(graphSettings, /sidebarMinWidth|sidebarMaxWidth|sidebarLeftWidth|sidebarCollapsedWidth|sidebarInspectorWidth/);
	assert.doesNotMatch(graphSettings, /localize\('prebase\.settings\.save'/);
	const config = readFileSync(join(repoRoot, 'src/vs/workbench/contrib/prebase/common/prebaseConfiguration.ts'), 'utf8');
	const reservedBlocks = [...config.matchAll(/\[PreBaseConfigKeys\.[^\]]+\]:\s*\{([\s\S]*?)\n\t\t\},/g)];
	const reserved = reservedBlocks.filter(block => /deprecationMessage:[\s\S]*Reserved/.test(block[1]));
	assert.ok(reserved.length >= 8, `expected reserved schema keys, got ${reserved.length}`);
	for (const block of reserved) {
		assert.match(block[1], /included:\s*false/, `reserved key ${block[0].slice(0, 80)} must set included:false`);
	}
	const maps = readFileSync(join(repoRoot, 'graphs/src/host/workbench/prebaseMapsView.ts'), 'utf8');
	assert.doesNotMatch(maps, /▸|▾/);
	assert.match(maps, /codicon-chevron-right/);
	assert.match(maps, /header\.type = 'button'/);
	assert.match(maps, /header\.setAttribute\('aria-expanded', String\(expanded\)\)/);
	assert.match(maps, /layoutCol\.setAttribute\('role', 'group'\)/);
	assert.match(maps, /addBadge\(`⇄\$\{renamed\}`/);
	const runtime = readFileSync(join(repoRoot, 'src/vs/workbench/contrib/prebase/browser/prebaseRuntimeView.ts'), 'utf8');
	assert.match(runtime, /DOM\.\$\('details'\)/);
	const runtimeEditor = readFileSync(join(repoRoot, 'src/vs/workbench/contrib/prebase/browser/runtimeEditor.ts'), 'utf8');
	assert.match(runtimeEditor, /font-family:\s*var\(--vscode-font-family/);
});

test('active soak rejects one blocked sample and SIGKILL', () => {
	const failures = activeSoakFailures({
		samples: [{ phase: 'active', processCount: 8, cpuSum: 20 }, { phase: 'quiesce', processCount: 8, cpuSum: 99 }, { phase: 'quiesce', processCount: 8, cpuSum: 100 }],
		quit: { remaining: 'gone', usedSigkill: true, terminationPath: 'sigkill' },
	});
	assert.ok(failures.some(item => /active samples/.test(item)));
	assert.ok(failures.some(item => /SIGKILL/.test(item)));
	assert.ok(failures.some(item => /CPU/.test(item)));
});

test('load-quit rejects CPU>5 parser proof and SIGKILL', () => {
	const failures = loadQuitFailures([
		{ scenario: 'parser-active-1', parserUtilitySeen: true, scanStarted: true, cpuSum: 99, parserActiveRequests: 0, quit: { remaining: 'gone' } },
		{ scenario: 'temporal-sqlite-write-1', temporalOpened: true, indexingSeen: true, temporalActiveWrites: 0, quit: { remaining: 'gone', terminationPath: 'sigkill', usedSigkill: true } },
	]);
	assert.ok(failures.some(item => /parserActiveRequests/.test(item)));
	assert.ok(failures.some(item => /temporalActiveWrites/.test(item)));
	assert.ok(failures.some(item => /SIGKILL/.test(item)));
});

test('parser-active cannot pass on CPU>5 without parserActiveRequests', () => {
	const failures = loadQuitFailures([
		{ scenario: 'parser-active-1', cpuSum: 42, parserUtilitySeen: true, scanStarted: true, parserActiveRequests: 0, quit: { remaining: 'gone', terminationPath: 'workbench' } },
	]);
	assert.ok(failures.some(item => /parserActiveRequests/.test(item)));
	assert.equal(failures.some(item => /SIGKILL/.test(item)), false);
});

test('parser-active passes when parserActiveRequests is positive even if CPU is idle', () => {
	const failures = loadQuitFailures([
		{ scenario: 'parser-active-1', cpuSum: 0.2, parserActiveRequests: 3, quit: { remaining: 'gone', terminationPath: 'workbench' } },
	]);
	assert.equal(failures.some(item => /parserActiveRequests/.test(item)), false);
});

test('SQLite active-write cannot pass on hasActiveWrite or indexingSeen without temporalActiveWrites', () => {
	const failures = loadQuitFailures([
		{ scenario: 'temporal-sqlite-write-1', temporalOpened: true, indexingSeen: true, hasActiveWrite: true, cpuSum: 80, temporalActiveWrites: 0, quit: { remaining: 'gone', terminationPath: 'workbench' } },
	]);
	assert.ok(failures.some(item => /temporalActiveWrites/.test(item)));
});

test('SQLite active-write passes when temporalActiveWrites is positive', () => {
	const failures = loadQuitFailures([
		{ scenario: 'temporal-sqlite-write-1', temporalActiveWrites: 2, quit: { remaining: 'gone', terminationPath: 'sigterm', usedSigkill: false } },
	]);
	assert.equal(failures.some(item => /temporalActiveWrites/.test(item)), false);
	assert.equal(failures.some(item => /SIGKILL/.test(item)), false);
});

test('load-quit live proves parser and temporal activity from diagnostics, not CPU or Indexing', () => {
	const source = readFileSync(join(acceptanceDir, 'prebase-load-quit-live.mjs'), 'utf8');
	assert.match(source, /evidence\.parserActiveRequests = Number\(diagnostics\?\.parserActiveRequests/);
	assert.match(source, /evidence\.temporalActiveWrites = Number\(diagnostics\?\.temporalActiveWrites/);
	assert.match(source, /parserActiveRequests was not > 0 before Quit/);
	assert.match(source, /temporalActiveWrites was not > 0 before Quit/);
	assert.doesNotMatch(source, /cpuSum\s*>\s*5/);
	assert.doesNotMatch(source, /Indexing/);
	assert.doesNotMatch(source, /parserUtilitySeen/);
	assert.doesNotMatch(source, /indexingSeen/);
});

test('load-quit never awaits an untimed workbenchCommand and does not scan the full repo', () => {
	const source = readFileSync(join(acceptanceDir, 'prebase-load-quit-live.mjs'), 'utf8');
	assert.match(source, /workbenchCommandWithTimeout/);
	assert.match(source, /void workbenchCommandWithTimeout\(page, 45_000, 'prebase.graph.rescanWorkspace'\)/);
	assert.match(source, /prebase.graph.openTemporal/);
	assert.doesNotMatch(source, /await workbenchCommand\(/);
	assert.doesNotMatch(source, /parser-active-\$\{iteration\}`, repo/);
	assert.doesNotMatch(source, /runtime-preview-active', join\(repo, 'test\/prebase\/fixtures\/desktop-electron'\)/);
});

test('smoke diagnostics and transport stay off the Command Palette and require the smoke-test driver', () => {
	const contribution = readFileSync(join(repoRoot, 'src/vs/workbench/contrib/prebase/browser/prebase.contribution.ts'), 'utf8');
	for (const id of ['prebase.test.getDiagnostics', 'prebase.test.installMagnusSmokeTransport', 'prebase.test.isSmokeDriver']) {
		const start = contribution.indexOf(`id: '${id}'`);
		assert.ok(start >= 0, `${id} is missing`);
		const line = contribution.slice(start, contribution.indexOf('\n', start));
		assert.match(line, /f1: false/, `${id} must be f1:false`);
	}
	assert.match(contribution, /requireSmokeTestDriver\([^,]+, 'prebase.test.getDiagnostics'\)/);
	assert.match(contribution, /requireSmokeTestDriver\([^,]+, 'prebase.test.installMagnusSmokeTransport'\)/);
	const extension = readFileSync(join(repoRoot, 'extensions/prebase-magnus/src/extension.ts'), 'utf8');
	assert.match(extension, /installSmokeTransport requires --enable-smoke-test-driver/);
	assert.match(extension, /getStreamDiagnostics requires --enable-smoke-test-driver/);
	const pkg = readFileSync(join(repoRoot, 'extensions/prebase-magnus/package.json'), 'utf8');
	assert.doesNotMatch(pkg, /installSmokeTransport|getStreamDiagnostics/);
});

test('final gate rejects stale ok:true evidence after a live rerun failure', () => {
	const gate = readFileSync(join(acceptanceDir, 'prebase-phase3-final-gate.mjs'), 'utf8');
	assert.match(gate, /stale evidence: live rerun exited/);
	assert.match(gate, /reruns/);
});

test('active-soak final evidence rejects diagnostic, short, and stale-HEAD records', () => {
	const activeSoak = PHASE3_REQUIRED_EVIDENCE.find(item => item.id === 'active-soak');
	assert.ok(activeSoak);
	const current = 'current-head';
	const valid = {
		ok: true,
		scenario: 'active-soak',
		evidenceKind: 'final',
		durationMs: activeSoak.minDurationMs,
		sourceHead: current,
		sourceFingerprint: 'fp-current',
	};
	assert.equal(scenarioOk({ ...activeSoak, sourceHead: current, sourceFingerprint: 'fp-current' }, valid).ok, true);
	assert.equal(scenarioOk({ ...activeSoak, sourceHead: current, sourceFingerprint: 'fp-current' }, { ...valid, evidenceKind: 'diagnostic' }).ok, false);
	assert.equal(scenarioOk({ ...activeSoak, sourceHead: current, sourceFingerprint: 'fp-current' }, { ...valid, durationMs: activeSoak.minDurationMs - 1 }).ok, false);
	assert.equal(scenarioOk({ ...activeSoak, sourceHead: current, sourceFingerprint: 'fp-current', expectedProducerFingerprint: 'pf-active' }, { ...valid, sourceHead: 'stale-head', sourceFingerprint: 'fp-current', producerFingerprint: 'pf-active' }).ok, true);
	assert.equal(scenarioOk({ ...activeSoak, sourceHead: current, sourceFingerprint: 'fp-current' }, { ...valid, sourceFingerprint: 'fp-stale' }).ok, false);
});

test('short soak writes diagnostic evidence and must not overwrite canonical final', () => {
	assert.equal(ACTIVE_SOAK_FINAL_MIN_DURATION_MS, 10 * 60 * 1000);
	assert.deepEqual(activeSoakEvidenceTarget(ACTIVE_SOAK_FINAL_MIN_DURATION_MS - 1), {
		evidenceKind: 'diagnostic',
		fileName: 'active-diagnostic.json',
	});
	assert.deepEqual(activeSoakEvidenceTarget(ACTIVE_SOAK_FINAL_MIN_DURATION_MS), {
		evidenceKind: 'final',
		fileName: 'active.json',
	});
	const active = readFileSync(join(acceptanceDir, 'prebase-active-soak.mjs'), 'utf8');
	assert.match(active, /activeSoakEvidenceTarget\(durationMs\)/);
	assert.match(active, /writeFileSync\(join\(evidenceDir, fileName\)/);
	assert.doesNotMatch(active, /writeFileSync\(join\(evidenceDir, 'active\.json'\)/);
	assert.match(active, /import \{ activePhaseResourceFailures, monotonicGrowth \} from '\.\/prebase-process-leak-diag\.mjs'/);
	assert.doesNotMatch(active, /function monotonicGrowth/);
	assert.match(active, /activePhaseResourceFailures/);
	const leak = readFileSync(join(acceptanceDir, 'prebase-process-leak-diag.mjs'), 'utf8');
	assert.match(leak, /export function monotonicGrowth/);
	assert.match(leak, /export function activePhaseResourceFailures/);
});

test('active soak protects canonical final evidence and final gate has explicit bounded modes', () => {
	const active = readFileSync(join(acceptanceDir, 'prebase-active-soak.mjs'), 'utf8');
	assert.match(active, /ACTIVE_SOAK_FINAL_MIN_DURATION_MS = 10 \* 60 \* 1000/);
	assert.match(active, /phase3EvidenceMetadata\(repo, 'active-soak'\)/);
	assert.doesNotMatch(active, /sourceHead:\s*execFileSync\('git'/);
	assert.doesNotMatch(active, /process count grew excessively during active soak/);

	const gate = readFileSync(join(acceptanceDir, 'prebase-phase3-final-gate.mjs'), 'utf8');
	assert.match(gate, /argv\.includes\('--validate-evidence'\)/);
	assert.match(gate, /argv\.includes\('--rerun-stale'\)/);
	assert.match(gate, /argv\.includes\('--rerun-all'\) \|\| argv\.includes\('--rerun-live'\)/);
	assert.match(gate, /evidence source fingerprint does not match current worktree/);
	assert.match(gate, /expected \$\{entry\.evidenceKind\} evidence/);
	assert.match(gate, /evidence duration is below \$\{entry\.minDurationMs\}ms/);
	assert.match(gate, /evidence producer fingerprint does not match current producer inputs/);
	assert.doesNotMatch(gate, /plan stale due to code change: sourceHead/);
});

test('every live final-gate producer has a deadline, log, and process-tree timeout path', () => {
	assert.ok(PHASE3_PRODUCERS.length > 0);
	assert.ok(PHASE3_PRODUCERS.every(item => Number.isFinite(item.timeoutMs) && item.timeoutMs > 0));
	assert.ok(PHASE3_REQUIRED_EVIDENCE.every(item => producerForArtifact(item.id)), 'every required artifact must have a producer');
	const coreIde = PHASE3_PRODUCERS.find(item => item.id === 'core-ide');
	assert.deepEqual(coreIde?.artifacts, ['core-ide', 'code-graph', 'themes-a11y']);
	assert.ok(activeSoakProducerTimeoutMs({ PREBASE_ACTIVE_SOAK_MS: String(20 * 60 * 1000) }) > 20 * 60 * 1000);
	const gate = readFileSync(join(acceptanceDir, 'prebase-phase3-final-gate.mjs'), 'utf8');
	assert.match(gate, /gate-logs/);
	assert.match(gate, /terminateOwnedProcessTree/);
	assert.match(gate, /live rerun timed out after/);
});

test('final gate requires current successful assurance evidence instead of a prose reminder', () => {
	const gate = readFileSync(join(acceptanceDir, 'prebase-phase3-final-gate.mjs'), 'utf8');
	assert.match(gate, /readJson\('assurance\.json'\)/);
	assert.match(gate, /assuranceEvidenceOk\(entry, evidence\)/);
	assert.match(gate, /failures\.push\(`assurance: \$\{assuranceVerdict\.reason\}`\)/);
	assert.match(gate, /assurance: \{ path: 'assurance\.json', ok: assuranceVerdict\.ok, reason: assuranceVerdict\.reason \}/);
	assert.doesNotMatch(gate, /assuranceSummary/);
});

test('active soak rejects quiescent renderer CPU runaway', () => {
	const failures = activeSoakFailures({
		samples: [
			{ phase: 'active', processCount: 8, cpuSum: 20 },
			{ phase: 'active', processCount: 8, cpuSum: 22 },
			{ phase: 'active', processCount: 8, cpuSum: 18 },
			{ phase: 'active', processCount: 8, cpuSum: 19 },
			{ phase: 'quiesce', processCount: 9, cpuSum: 50, topProcesses: [{ role: 'renderer', cpu: 48 }] },
			{ phase: 'quiesce', processCount: 9, cpuSum: 51, topProcesses: [{ role: 'renderer', cpu: 49 }] },
		],
		quit: { remaining: 'gone', terminationPath: 'workbench', usedSigkill: false },
	});
	assert.ok(failures.some(item => /renderer CPU/.test(item)));
});

test('active soak rejects active-phase process growth that plateaus in quiescence', () => {
	const failures = activeSoakFailures({
		samples: [
			{ phase: 'active', processCount: 7, cpuSum: 20, rssMb: 1500, webContentsLiveCount: 2 },
			{ phase: 'active', processCount: 20, cpuSum: 40, rssMb: 2800, webContentsLiveCount: 8 },
			{ phase: 'active', processCount: 40, cpuSum: 55, rssMb: 4200, webContentsLiveCount: 14 },
			{ phase: 'active', processCount: 54, cpuSum: 60, rssMb: 5000, webContentsLiveCount: 18 },
			{ phase: 'quiesce', processCount: 56, cpuSum: 8, rssMb: 5100, webContentsLiveCount: 18 },
			{ phase: 'quiesce', processCount: 56, cpuSum: 6, rssMb: 5050, webContentsLiveCount: 18 },
			{ phase: 'quiesce', processCount: 56, cpuSum: 5, rssMb: 5000, webContentsLiveCount: 18 },
		],
		quit: { remaining: 'gone', terminationPath: 'workbench', usedSigkill: false },
	});
	assert.ok(failures.some(item => /active-phase process growth unbounded/.test(item)), failures.join('; '));
	assert.ok(failures.some(item => /quiesce process count elevated/.test(item)), failures.join('; '));
});

test('active soak cannot pass when activity threw', () => {
	assert.ok(activeSoakFailures({
		activityError: 'TimeoutError',
		samples: [
			{ phase: 'active', processCount: 8, cpuSum: 20 },
			{ phase: 'active', processCount: 8, cpuSum: 20 },
			{ phase: 'active', processCount: 8, cpuSum: 20 },
			{ phase: 'active', processCount: 8, cpuSum: 20 },
			{ phase: 'quiesce', processCount: 8, cpuSum: 4 },
			{ phase: 'quiesce', processCount: 8, cpuSum: 3 },
		],
		quit: { remaining: 'gone', terminationPath: 'workbench', usedSigkill: false },
	}).some(item => /activity failed/.test(item)));
});

test('final manifest requires every Phase 3 scenario', () => {
	const ids = PHASE3_REQUIRED_EVIDENCE.map(item => item.id);
	for (const required of [
		'electron-product-path',
		'tauri-product-path',
		'runtime-preview',
		'temporal-small',
		'temporal-large',
		'magnus-streaming-smoke',
		'load-quit',
		'core-ide',
		'code-graph',
		'themes-a11y',
		'privacy',
		'active-soak',
		'lifecycle-cycles',
	]) {
		assert.ok(ids.includes(required), `manifest is missing ${required}`);
	}
	assert.ok(PHASE3_REQUIRED_EVIDENCE.length >= 18);
	assert.ok(PHASE3_REQUIRED_EVIDENCE.every(item => item.path && item.id));
});

test('scenarioOk rejects missing evidence, ok:false, and omitted ok', () => {
	assert.equal(scenarioOk({}, { missing: true }).ok, false);
	assert.equal(scenarioOk({}, { ok: false, failures: ['x'] }).ok, false);
	assert.equal(scenarioOk({}, {}).ok, false);
	const missingHead = scenarioOk({}, { ok: true });
	assert.equal(missingHead.ok, false, 'ok:true without sourceHead must not pass the final gate');
	assert.match(missingHead.reason, /source HEAD/);
	const missingFingerprint = scenarioOk({}, { ok: true, sourceHead: 'current-head' });
	assert.equal(missingFingerprint.ok, false, 'ok:true without sourceFingerprint must not pass the final gate');
	assert.match(missingFingerprint.reason, /fingerprint/);
	assert.equal(scenarioOk({}, { ok: true, sourceHead: 'current-head', sourceFingerprint: 'fp' }).ok, true);
});

test('final evidence requires the canonical sourceHead field, not the retired head alias', () => {
	const entry = { id: 'core-ide', sourceHead: 'current-head', sourceFingerprint: 'fp' };
	assert.equal(scenarioOk(entry, { ok: true, scenario: 'core-ide', sourceHead: 'current-head', sourceFingerprint: 'fp' }).ok, true);
	const missing = scenarioOk(entry, { ok: true, scenario: 'core-ide' });
	assert.equal(missing.ok, false, 'final evidence without sourceHead must fail the gate');
	assert.match(missing.reason, /source HEAD/);
	const legacy = scenarioOk(entry, { ok: true, scenario: 'core-ide', head: 'current-head' });
	assert.equal(legacy.ok, false, 'a legacy head field can otherwise conceal writers that never adopted the final evidence contract');
	assert.match(legacy.reason, /source HEAD/);
	const stale = scenarioOk({ ...entry, expectedProducerFingerprint: 'pf-core' }, { ok: true, scenario: 'core-ide', sourceHead: 'stale-head', sourceFingerprint: 'fp', producerFingerprint: 'pf-core' });
	assert.equal(stale.ok, true, 'sourceHead mismatch alone must not invalidate evidence when producer fingerprint matches');
	assert.equal(stale.provenanceHeadMismatch, true);
	const staleFp = scenarioOk(entry, { ok: true, scenario: 'core-ide', sourceHead: 'current-head', sourceFingerprint: 'other' });
	assert.equal(staleFp.ok, false);
	assert.match(staleFp.reason, /fingerprint does not match/);
});

test('final evidence rejects a missing or mismatched scenario label even when its source head is current', () => {
	const entry = { id: 'core-ide', sourceHead: 'current-head', sourceFingerprint: 'fp' };
	assert.equal(scenarioOk(entry, { ok: true, sourceHead: 'current-head', sourceFingerprint: 'fp' }).ok, false);
	assert.equal(scenarioOk(entry, { ok: true, scenario: 'privacy', sourceHead: 'current-head', sourceFingerprint: 'fp' }).ok, false);
	assert.equal(scenarioOk(entry, { ok: true, scenario: 'core-ide', sourceHead: 'current-head', sourceFingerprint: 'fp' }).ok, true);
});

test('shared Phase 3 metadata is bounded, current, and rejects an unlabelled scenario', () => {
	assert.throws(() => phase3EvidenceMetadata(repoRoot, ''), /scenario is required/);
	const metadata = phase3EvidenceMetadata(repoRoot, 'contract-test');
	assert.deepEqual(Object.keys(metadata).sort(), ['generatedAt', 'productFingerprint', 'scenario', 'schemaVersion', 'sourceFingerprint', 'sourceHead']);
	assert.equal(metadata.schemaVersion, PHASE3_EVIDENCE_SCHEMA_VERSION);
	assert.equal(metadata.scenario, 'contract-test');
	assert.match(metadata.sourceHead, /^[0-9a-f]{40}$/);
	assert.match(metadata.sourceFingerprint, /^[0-9a-f]{64}$/);
	assert.ok(Number.isFinite(Date.parse(metadata.generatedAt)));
});

test('final assurance has an authoritative, complete command matrix and records only bounded outcome data', () => {
	assert.deepEqual(PHASE3_ASSURANCE_COMMANDS, [
		['verify:icons'],
		['compile-magnus'],
		['transpile-client'],
		['typecheck-client'],
		['typecheck:graphs'],
		['test:graphs'],
		['test:prebase-pure:compiled'],
		['test:prebase-magnus'],
		['verify:graphs-boundary'],
		['verify:graphs-runtime-boundary'],
		['node', 'scripts/startup/verify-magnus-out.mjs'],
		['verify:privacy'],
		['verify:config-uniqueness'],
		['verify:startup'],
		['verify:dialog-routing'],
		['verify:typescript'],
		['verify:supabase-migrations'],
		['verify:supabase-rls-static'],
	]);
	assert.equal(reportedTestCount('63 passing'), 63);
	assert.equal(reportedTestCount('# pass 181'), 181);
	assert.equal(reportedTestCount('tests 42'), 42);
	assert.equal(reportedTestCount('no test runner summary'), undefined);
	const source = readFileSync(join(acceptanceDir, 'prebase-phase3-assurance.mjs'), 'utf8');
	assert.match(source, /phase3EvidenceMetadata\(repo, 'assurance'\)/);
	assert.match(source, /exitCode/);
	assert.match(source, /durationMs/);
	assert.match(source, /testCount: reportedTestCount/);
	assert.match(source, /commands\.every\(command => command\.passed\)/);
	assert.doesNotMatch(source, /process\.env\.FIRECRAWL_API_KEY|process\.env\.LINKUP_API_KEY/);
});

test('assurance leaf coverage replaces nested assurance:quick and assurance:static reruns', () => {
	assert.equal(PHASE3_ASSURANCE_COMMANDS.some(command => assuranceCommandLabel(command) === 'assurance:quick'), false);
	assert.equal(PHASE3_ASSURANCE_COMMANDS.some(command => assuranceCommandLabel(command) === 'assurance:static'), false);
	const covered = new Set(Object.values(PHASE3_ASSURANCE_LEAF_COVERAGE).flat());
	for (const leaf of covered) {
		assert.ok(PHASE3_ASSURANCE_COMMANDS.some(command => assuranceCommandLabel(command) === leaf), `leaf ${leaf} missing from PHASE3_ASSURANCE_COMMANDS`);
	}
	const source = readFileSync(join(acceptanceDir, 'prebase-phase3-assurance.mjs'), 'utf8');
	assert.match(source, /PHASE3_ASSURANCE_LEAF_COVERAGE/);
	assert.doesNotMatch(source, /\['assurance:quick'\]|\['assurance:static'\]|npm run assurance:quick|npm run assurance:static/);
});

test('final gate accepts only a complete current assurance matrix with passed bounded command records', () => {
	const entry = { id: 'assurance', sourceHead: 'current-head', sourceFingerprint: 'fp' };
	const commands = PHASE3_ASSURANCE_COMMANDS.map(command => ({
		command: assuranceCommandLabel(command),
		exitCode: 0,
		durationMs: 1,
		passed: true,
		log: 'reports/graph-acceptance/phase-3-final/assurance-logs/command.log',
	}));
	const passing = { ok: true, scenario: 'assurance', sourceHead: 'current-head', sourceFingerprint: 'fp', commands };
	assert.equal(assuranceEvidenceOk(entry.sourceHead, passing).ok, false, 'a sourceHead-only identity must not accept assurance evidence');
	assert.equal(assuranceEvidenceOk(entry, passing).ok, true);
	assert.equal(scenarioOk(entry, passing).ok, true);
	assert.equal(assuranceEvidenceOk(entry, { ...passing, sourceFingerprint: 'other' }).ok, false);
	assert.equal(assuranceEvidenceOk(entry, { ...passing, commands: [] }).ok, false);
	assert.equal(assuranceEvidenceOk(entry, { ...passing, commands: [...commands.slice(0, -1), { ...commands.at(-1), passed: false, exitCode: 1 }] }).ok, false);
	assert.equal(assuranceEvidenceOk(entry, { ...passing, commands: commands.map((command, index) => index === 0 ? { ...command, durationMs: undefined } : command) }).ok, false);
	assert.equal(assuranceEvidenceOk(entry, { ...passing, sourceHead: 'stale-head' }).ok, false);
	assert.equal(assuranceEvidenceOk(entry, { ...passing, scenario: 'core-ide' }).ok, false);
	const missingHead = scenarioOk(entry, { ok: true, scenario: 'assurance', commands });
	assert.equal(missingHead.ok, false, 'assurance.json without sourceHead must fail the final gate');
	assert.equal(assuranceEvidenceOk(entry, { ...passing, commands: commands.map((command, index) => index === 0 ? { ...command, command: 'not-the-matrix' } : command) }).ok, false);
});

test('every required Phase 3 evidence writer delegates current metadata to the shared contract', () => {
	const writers = [
		'test/prebase/acceptance/prebase-desktop-product-path.mjs',
		'test/prebase/acceptance/prebase-desktop-native-cases.mjs',
		'test/prebase/acceptance/runtime-preview-live.mjs',
		'graphs/scripts/acceptance/temporal-live.mjs',
		'test/prebase/acceptance/prebase-magnus-tools-live.mjs',
		'test/prebase/acceptance/prebase-magnus-stream-live.mjs',
		'test/prebase/acceptance/prebase-load-quit-live.mjs',
		'test/prebase/acceptance/prebase-idle-soak.mjs',
		'test/prebase/acceptance/prebase-active-soak.mjs',
		'test/prebase/acceptance/prebase-process-leak-diag.mjs',
		'test/prebase/acceptance/prebase-restart-soak.mjs',
		'test/prebase/acceptance/prebase-core-ide-live.mjs',
		'test/prebase/acceptance/prebase-privacy-runtime.mjs',
		'graphs/scripts/parser-batch-bench.ts',
		'test/prebase/acceptance/prebase-hybrid-web-smoke.mjs',
		'test/prebase/acceptance/prebase-phase3-assurance.mjs',
	];
	const helper = join(acceptanceDir, 'phase3Evidence.mjs');
	assert.match(readFileSync(helper, 'utf8'), /export function phase3EvidenceMetadata\b/);
	for (const relative of writers) {
		const source = readFileSync(join(repoRoot, relative), 'utf8');
		assert.match(source, /phase3EvidenceMetadata\(/, `${relative} must use the shared Phase 3 metadata contract`);
		assert.doesNotMatch(source, /sourceHead:\s*execFileSync\('git'/, `${relative} must not fork its own source-head metadata implementation`);
	}
});

test('individual harnesses must not overwrite phase-3-final/manifest.json', () => {
	const dirs = [
		acceptanceDir,
		join(repoRoot, 'graphs/scripts/acceptance'),
		join(repoRoot, 'graphs/scripts'),
	];
	const extra = [join(repoRoot, 'graphs/scripts/parser-batch-bench.ts')];
	const files = [
		...dirs.flatMap(dir => readdirSync(dir)
			.filter(name =>
				(name.endsWith('.mjs') || name.endsWith('.ts')) &&
				!name.endsWith('.test.mjs') &&
				!name.endsWith('.test.ts') &&
				name !== 'prebase-phase3-final-gate.mjs' &&
				name !== 'workbenchHarness.mjs'
			)
			.map(name => join(dir, name))),
		...extra,
	];
	for (const file of new Set(files)) {
		const source = readFileSync(file, 'utf8');
		assert.equal(
			/phase-3-final\/manifest\.json/.test(source) || /join\(evidenceRoot,\s*['"]manifest\.json['"]\)/.test(source),
			false,
			`${file} must not write the final Phase 3 manifest`,
		);
	}
	const gate = readFileSync(join(acceptanceDir, 'prebase-phase3-final-gate.mjs'), 'utf8');
	assert.match(gate, /join\(evidenceRoot,\s*['"]manifest\.json['"]\)/);
});

test('lifecycle cycles reject monotonic WebContents growth and accept a stable warm baseline', () => {
	const quit = { remaining: 'gone', terminationPath: 'workbench', usedSigkill: false };
	const surfaces = ['maps', 'code-graph', 'temporal', 'runtime', 'magnus'].map(id => ({ id, opened: true, closed: true }));
	const stable = () => ({ processCount: 14, webContents: { liveCount: 6 } });
	assert.deepEqual(lifecycleFailures({
		cold: { processCount: 7, webContents: { liveCount: 3 } },
		warm: { processCount: 14, webContents: { liveCount: 6 } },
		cycles: [1, 2, 3, 4, 5, 6].map(stable),
		closedPrimarySidebar: true,
		surfaces,
		quit,
	}), [], 'cold 7 → warm 14 that then stays at 14 is provisioning, not a leak');
	assert.ok(lifecycleFailures({
		cold: { processCount: 7, webContents: { liveCount: 3 } },
		warm: { processCount: 14, webContents: { liveCount: 6 } },
		cycles: [8, 10, 12, 14, 16, 18].map(count => ({ processCount: 14, webContents: { liveCount: count } })),
		classification: 'warm-provisioning',
		closedPrimarySidebar: true,
		surfaces,
		quit,
	}).some(item => /monotonically/.test(item)), 'monotonic live WebContents growth must fail even when classification is not leak');
	assert.ok(lifecycleFailures({
		cold: { processCount: 7, webContents: { liveCount: 3 } },
		warm: { processCount: 14, webContents: { liveCount: 6 } },
		cycles: [1, 2, 3, 4, 5, 6].map(() => ({ processCount: 14 })),
		closedPrimarySidebar: true,
		surfaces,
		quit,
	}).some(item => /live WebContents counts/.test(item)), 'missing WebContents samples must fail closed');
	assert.ok(lifecycleFailures({
		cold: { processCount: 7, webContents: { liveCount: 3 } },
		warm: { processCount: 14, webContents: { liveCount: 6 } },
		cycles: [1, 2, 3, 4, 5, 6].map(stable),
		closedPrimarySidebar: false,
		surfaces,
		quit,
	}).some(item => /Primary Sidebar/.test(item)), 'leaving the Primary Sidebar open must fail');
});

test('smoke diagnostics expose redacted WebContents inventory and never write accessibilitySupport off', () => {
	const contribution = readFileSync(join(repoRoot, 'src/vs/workbench/contrib/prebase/browser/prebase.contribution.ts'), 'utf8');
	assert.match(contribution, /getWebContentsInventory\(\)/);
	assert.match(contribution, /inventory\.filter\(item => !item\.destroyed\)/);
	assert.match(contribution, /liveCount: live\.length/);
	assert.match(contribution, /urlCategory/);
	assert.doesNotMatch(contribution, /contents\.getURL\(\)/);
	assert.doesNotMatch(contribution, /liveCount:\s*inventory\.length/);
	assert.match(contribution, /a11yMode === 'auto' \|\| a11yMode === 'on'/);
	assert.match(contribution, /await configurationService\.updateValue\('editor\.accessibilitySupport', a11yMode\)/);
	assert.ok(contribution.indexOf('getWebContentsInventory()') < contribution.indexOf('prebase.magnus.getStreamDiagnostics'));
	assert.doesNotMatch(contribution, /updateValue\('editor\.accessibilitySupport', 'off'\)/);
	const native = readFileSync(join(repoRoot, 'src/vs/platform/native/electron-main/nativeHostMainService.ts'), 'utf8');
	const inventoryStart = native.indexOf('async getWebContentsInventory');
	const inventory = native.slice(inventoryStart, native.indexOf('private webContentsUrlCategory'));
	assert.match(inventory, /contents\.isDestroyed\(\)/);
	assert.match(inventory, /inspectUrl \? contents\.getURL\(\)/);
	assert.match(inventory, /type === 'window' \|\| type === 'browserView'/);
	assert.match(inventory, /urlCategory: type === 'webview' \? 'webview' : this\.webContentsUrlCategory\(url\)/);
	assert.doesNotMatch(inventory, /\burl:/);
});

test('renderer CPU profile summary ranks leaf self-time and ignores idle', () => {
	const summary = summarizeCpuProfile({
		nodes: [
			{ id: 1, callFrame: { functionName: '(root)', url: '' }, children: [2, 3] },
			{ id: 2, callFrame: { functionName: '(idle)', url: '' }, children: [] },
			{ id: 3, callFrame: { functionName: '_refresh', url: 'vscode-file://vscode-app/Users/x/Prebasecode/out/vs/workbench/contrib/prebase/graphs/host/workbench/prebaseMapsView.js', lineNumber: 1188 }, children: [] },
		],
		samples: [2, 3, 3, 3],
		timeDeltas: [1000, 2000, 2000, 2000],
	});
	assert.equal(summary.topFunction?.function, '_refresh');
	assert.equal(summary.topFunction?.selfMs, 6);
	assert.match(summary.topFunction?.url ?? '', /prebaseMapsView\.js$/);
	assert.equal(summary.idleMs, 1);
});

test('phase 3 lock block message names pid, scenario, and age immediately', () => {
	const active = formatPhase3LockBlockMessage({
		pid: 4242,
		scenario: 'prebase-active-soak.mjs',
		ageMs: 45_000,
		lockDir: '/tmp/prebase-phase3-acceptance.lock',
	}, false);
	assert.match(active, /\[phase3-lock\] active owner pid=4242/);
	assert.match(active, /scenario=prebase-active-soak\.mjs/);
	assert.match(active, /age=45s/);
	const stale = formatPhase3LockBlockMessage({ pid: 7, scenario: 'dead', ageMs: 1000, lockDir: '/tmp/x' }, true);
	assert.match(stale, /\[phase3-lock\] stale owner pid=7/);
});

test('Magnus, Edge, and workbench URL policy share the same private-host and userinfo guards', () => {
	const files = [
		join(repoRoot, 'extensions/prebase-magnus/src/webContextCore.ts'),
		join(repoRoot, 'supabase/functions/web-search/web_context.ts'),
		join(repoRoot, 'src/vs/workbench/contrib/prebase/browser/prebaseWebSearchService.ts'),
	];
	const privateHost = String.raw`/^(localhost|127\.0\.0\.1|0\.0\.0\.0|::1|\[::1\])$/i`;
	const userinfo = 'url.username || url.password';
	for (const file of files) {
		const source = readFileSync(file, 'utf8');
		assert.ok(source.includes(privateHost), `${file} missing shared private-host pattern`);
		assert.ok(source.includes(userinfo), `${file} missing URL userinfo rejection`);
	}
	const fixture = JSON.parse(readFileSync(join(repoRoot, 'test/prebase/fixtures/web-url-policy.json'), 'utf8'));
	assert.ok(fixture.allow.length >= 2);
	assert.ok(fixture.reject.some(url => url.includes('user:password@')));
	const magnusTest = readFileSync(join(repoRoot, 'extensions/prebase-magnus/src/webContextCore.test.ts'), 'utf8');
	const edgeTest = readFileSync(join(repoRoot, 'supabase/functions/web-search/web_context.test.ts'), 'utf8');
	const workbenchTest = readFileSync(join(repoRoot, 'src/vs/workbench/contrib/prebase/test/browser/prebaseWebSearchService.test.ts'), 'utf8');
	assert.match(magnusTest, /web-url-policy\.json/);
	assert.match(edgeTest, /web-url-policy\.json/);
	assert.match(workbenchTest, /web-url-policy\.json/);
});

test('Firecrawl clients call v2 scrape/search only and never claim ZDR, Interact, or a web-search provider picker', () => {
	const firecrawl = readFileSync(join(repoRoot, 'extensions/prebase-magnus/src/localFirecrawlClient.ts'), 'utf8');
	assert.match(firecrawl, /const FIRECRAWL_SCRAPE = 'https:\/\/api\.firecrawl\.dev\/v2\/scrape'/);
	assert.match(firecrawl, /const FIRECRAWL_SEARCH = 'https:\/\/api\.firecrawl\.dev\/v2\/search'/);
	assert.doesNotMatch(firecrawl, /\/v1\/|\/agent|\/interact|zeroDataRetention|zero_data_retention|\bzdr\b/i);
	assert.match(firecrawl, /cache:\s*'no-store'/);
	assert.match(firecrawl, /'Cache-Control':\s*'no-cache'/);
	const hybrid = readFileSync(join(repoRoot, 'extensions/prebase-magnus/src/hybridWebContext.ts'), 'utf8');
	assert.match(hybrid, /storeInCache:\s*false/);
	assert.match(hybrid, /maxAge:\s*firecrawlMaxAgeMs\(freshness\)/);
	assert.doesNotMatch(hybrid, /zeroDataRetention|\/interact/i);
	const edge = readFileSync(join(repoRoot, 'supabase/functions/web-search/index.ts'), 'utf8');
	assert.match(edge, /api\.firecrawl\.dev\/v2\/scrape/);
	assert.match(edge, /api\.firecrawl\.dev\/v2\/search/);
	assert.match(edge, /cache:\s*"no-store"/);
	assert.doesNotMatch(edge, /\/v1\/interact|zeroDataRetention/i);
	const settings = readFileSync(join(repoRoot, 'src/vs/workbench/contrib/prebase/browser/prebaseSettingsEditor.ts'), 'utf8');
	assert.doesNotMatch(settings, /webSearchProvider|Firecrawl Interact|LinkUp vs Firecrawl/);
});

test('Firecrawl HTTP fetch on Magnus client, connection-test, and edge providerFetch sends no-store/no-cache', () => {
	const firecrawl = readFileSync(join(repoRoot, 'extensions/prebase-magnus/src/localFirecrawlClient.ts'), 'utf8');
	const fetchFn = firecrawl.slice(firecrawl.indexOf('async function firecrawlFetch'), firecrawl.indexOf('function retryable'));
	assert.match(fetchFn, /cache:\s*'no-store'/);
	assert.match(fetchFn, /'Cache-Control':\s*'no-cache'/);
	assert.doesNotMatch(fetchFn, /zeroDataRetention|zero_data_retention|\bzdr\b|\/interact/i);

	const extension = readFileSync(join(repoRoot, 'extensions/prebase-magnus/src/extension.ts'), 'utf8');
	const connection = extension.slice(extension.indexOf("registerCommand('prebase.magnus.testFirecrawlConnection'"), extension.indexOf("registerCommand('prebase.magnus.refreshModels'"));
	assert.match(connection, /api\.firecrawl\.dev\/v2\/scrape/);
	assert.match(connection, /'Cache-Control': 'no-cache'/);
	assert.match(connection, /cache: 'no-store'/);
	assert.doesNotMatch(connection, /zeroDataRetention|\/interact|\bzdr\b/i);

	const edge = readFileSync(join(repoRoot, 'supabase/functions/web-search/index.ts'), 'utf8');
	const providerFetch = edge.slice(edge.indexOf('async function providerFetch'), edge.indexOf('async function linkupSearch'));
	assert.match(providerFetch, /"Cache-Control": "no-cache"/);
	assert.match(providerFetch, /cache: "no-store"/);
	assert.doesNotMatch(providerFetch, /zeroDataRetention|\/interact|\bzdr\b/i);
});

test('final gate leftover PIDs after parent death SIGKILL only the owned tree', () => {
	const gate = readFileSync(join(acceptanceDir, 'prebase-phase3-final-gate.mjs'), 'utf8');
	const drain = gate.slice(gate.indexOf('async function drainOwnedTree'), gate.indexOf('async function runProcess'));
	assert.match(drain, /processTree\(pid\)\.map\(row => row\.pid\)/);
	assert.doesNotMatch(drain, /pgrep|pkill|PreBase\.app|Electron/);

	const runProcess = gate.slice(gate.indexOf('async function runProcess'), gate.indexOf('export function parseMode'));
	assert.match(runProcess, /leftoverPids = \[\.\.\.new Set\(\[/);
	assert.match(runProcess, /termination\?\.leftoverPids \?\? \[\]/);
	assert.match(runProcess, /await drainOwnedTree\(child\.pid\)/);

	const leftoverKill = gate.slice(gate.indexOf('if (result.leftoverPids.length)'), gate.indexOf('const scenarios = PHASE3_REQUIRED_EVIDENCE'));
	assert.match(leftoverKill, /await terminateOwnedProcessTree\(result\.harnessPid\)/);
	assert.match(leftoverKill, /killLeftoverPids\(result\.leftoverPids\)/);
	assert.match(gate, /function killLeftoverPids\(pids\)/);
	assert.match(gate, /process\.kill\(pid, 'SIGKILL'\)/);
	assert.doesNotMatch(leftoverKill, /pgrep|pkill|-u \$USER|PreBase\.app/);

	const harness = readFileSync(join(acceptanceDir, 'workbenchHarness.mjs'), 'utf8');
	const tree = harness.slice(harness.indexOf('export function processTree'), harness.indexOf('export async function waitForWorkbenchDriver'));
	assert.match(tree, /walk\(rootPid\)/);
	assert.match(tree, /children\.get\(pid\)/);
	assert.doesNotMatch(tree, /pgrep|pkill|comm === ['"]PreBase|killall/);
});

test('lifecycle producer timeout covers 5 warm sequences instead of dying at 6 minutes', () => {
	const lifecycle = PHASE3_PRODUCERS.find(item => item.id === 'lifecycle-cycles');
	assert.ok(lifecycle.timeoutMs >= 15 * 60 * 1000);
	const diag = readFileSync(join(acceptanceDir, 'prebase-process-leak-diag.mjs'), 'utf8');
	assert.match(diag, /const CYCLE_COUNT = 5;/);
});

test('Temporal canvas screenshots disable animations so idle RAF cannot flake stability', () => {
	const live = readFileSync(join(repoRoot, 'graphs/scripts/acceptance/temporal-live.mjs'), 'utf8');
	assert.match(live, /animations: 'disabled'/);
	assert.match(live, /evidence\.fullMap = fullMap/);
	assert.match(live, /evidence\.focusChanges = focusChanges/);
});

test('idle soak sleeps on the Node clock and surfaces CDP abort as a failure', () => {
	const idle = readFileSync(join(acceptanceDir, 'prebase-idle-soak.mjs'), 'utf8');
	assert.doesNotMatch(idle, /page\.waitForTimeout\(intervalMs\)/);
	assert.match(idle, /setTimeout\(resolveWait, waitMs\)/);
	assert.match(idle, /idle soak aborted/);
	assert.match(idle, /process\.exit\(result\.ok \? 0 : 1\)/);
});

test('gate keeps current ok evidence when a producer times out with no leftover PIDs', () => {
	const gate = readFileSync(join(acceptanceDir, 'prebase-phase3-final-gate.mjs'), 'utf8');
	assert.match(gate, /rerun\.timedOut && \(rerun\.leftoverPids\?\.length \?\? 0\) === 0/);
});

test('lifecycle opens Runtime explorer and retries layout/editor close', () => {
	const diag = readFileSync(join(acceptanceDir, 'prebase-process-leak-diag.mjs'), 'utf8');
	assert.match(diag, /async function lifecycleCommand/);
	assert.match(diag, /recoverHungWorkbenchPage/);
	assert.match(diag, /workbench\.view\.prebase\.runtime\.explorer/);
	assert.match(diag, /workbench\.action\.closeActiveEditor/);
	assert.match(diag, /attempt < 3 && !opened/);
});

test('missing Firecrawl key is an external hybrid skip, not a stale repo-controlled artifact', () => {
	const identity = { sourceHead: 'head', sourceFingerprint: 'fp' };
	const skipped = {
		ok: false,
		skipped: true,
		firecrawlConfigured: false,
		linkupConfigured: true,
		sourceHead: identity.sourceHead,
		sourceFingerprint: identity.sourceFingerprint,
		scenario: 'hybrid-web-smoke',
		failures: ['local hybrid skipped: both LINKUP_API_KEY and FIRECRAWL_API_KEY must resolve'],
	};
	assert.equal(hybridFirecrawlExternalSkip(skipped, identity), true);
	assert.equal(hybridFirecrawlExternalSkip({ ...skipped, sourceFingerprint: 'other' }, identity), false);
	assert.equal(hybridFirecrawlExternalSkip({ ...skipped, skipped: false, firecrawlConfigured: true }, identity), false);
	const passing = Object.fromEntries(PHASE3_REQUIRED_EVIDENCE.map(spec => [spec.id, {
		ok: true,
		scenario: spec.id,
		sourceHead: identity.sourceHead,
		sourceFingerprint: identity.sourceFingerprint,
		...(spec.evidenceKind ? { evidenceKind: spec.evidenceKind, durationMs: spec.minDurationMs } : {}),
	}]));
	passing['hybrid-web-smoke'] = skipped;
	const stale = classifyRequiredEvidence(identity, new Map(Object.entries(passing)));
	assert.equal(stale.some(item => item.id === 'hybrid-web-smoke'), false);
	assert.equal(scenarioOk({ id: 'hybrid-web-smoke', sourceHead: identity.sourceHead, sourceFingerprint: identity.sourceFingerprint, expectedProducerFingerprint: 'pf-hybrid' }, skipped).ok, false);
});

test('producer fingerprint controls freshness; sourceHead is provenance only', () => {
	const producerFp = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
	const entry = {
		id: 'core-ide',
		sourceHead: 'head-b-after-commit',
		sourceFingerprint: 'product-fp-unchanged',
		expectedProducerFingerprint: producerFp,
	};
	const evidence = {
		ok: true,
		scenario: 'core-ide',
		sourceHead: 'head-a-before-commit',
		sourceFingerprint: 'product-fp-unchanged',
		producerFingerprint: producerFp,
	};
	const verdict = scenarioOk(entry, evidence);
	assert.equal(verdict.ok, true);
	assert.equal(verdict.provenanceHeadMismatch, true);
	assert.equal(scenarioOk(entry, { ...evidence, producerFingerprint: 'changed-producer-fp' }).ok, false);
});

test('assertPlanIdentity accepts matching product fingerprint when HEAD changed', async () => {
	const { assertPlanIdentity, expectedProducerFingerprint } = await import('./prebase-phase3-final-gate.mjs');
	const identity = { sourceHead: 'new-head', sourceFingerprint: 'fp1', productFingerprint: 'fp1' };
	const plan = {
		productFingerprint: 'fp1',
		sourceHead: 'old-head',
		plannedAtHead: 'old-head',
		producers: [{ id: 'core-ide', expectedProducerFingerprint: expectedProducerFingerprint(repoRoot, 'core-ide') }],
		prerequisites: { firecrawlConfigured: false, linkupConfigured: false },
	};
	assert.doesNotThrow(() => assertPlanIdentity(plan, identity, repoRoot));
});

test('computePlanKey is stable for identical validation state', async () => {
	const { computePlanKey, probeEnvironmentPrerequisites } = await import('./prebase-phase3-final-gate.mjs');
	const identity = { productFingerprint: 'abc', sourceFingerprint: 'abc' };
	const a = computePlanKey(repoRoot, identity, { firecrawlConfigured: false, linkupConfigured: true, geminiConfigured: false });
	const b = computePlanKey(repoRoot, identity, { firecrawlConfigured: false, linkupConfigured: true, geminiConfigured: false });
	assert.equal(a, b);
	assert.notEqual(a, computePlanKey(repoRoot, { productFingerprint: 'other', sourceFingerprint: 'other' }, probeEnvironmentPrerequisites()));
});

test('classifyProcessRole and redactCommandLine correctly categorize processes and redact secrets', () => {
	assert.equal(classifyProcessRole('Code Helper (Renderer)', '/path/to/PreBase --type=renderer --site-per-process'), 'renderer');
	assert.equal(classifyProcessRole('Code Helper (GPU)', '/path/to/PreBase --type=gpu-process'), 'gpu');
	assert.equal(classifyProcessRole('Code Helper (Plugin)', '/path/to/PreBase --type=utility --utility-sub-type=node.mojom.NodeService --extensionHost'), 'extensionHost');
	assert.equal(classifyProcessRole('Code Helper (Network)', '/path/to/PreBase --type=utility --utility-sub-type=network.mojom.NetworkService'), 'networkService');
	assert.equal(classifyProcessRole('node', 'node /path/to/node_modules/typescript/lib/tsserver.js'), 'tsserver');
	assert.equal(classifyProcessRole('node', '/path/to/node_modules/node-pty/build/Release/ptyHost'), 'ptyHost');
	assert.equal(classifyProcessRole('git', '/usr/bin/git status'), 'git');
	assert.equal(classifyProcessRole('PreBase', '/path/to/PreBase /workspace'), 'main');

	const redacted = redactCommandLine('tool --token=sk-1234567890abcdef --key=AIzaSyD-1234567890 --password=secretPass');
	assert.match(redacted, /token=\[redacted\]/);
	assert.match(redacted, /key=\[redacted\]/);
	assert.match(redacted, /password=\[redacted\]/);
	assert.doesNotMatch(redacted, /secretPass/);
	assert.doesNotMatch(redacted, /sk-1234567890abcdef/);
});

test('liveActivityLiveFailures validates factual native diagnostics and handles non-mac', () => {
	const nonMac = { platform: 'linux', nativePresent: false };
	assert.deepEqual(liveActivityLiveFailures(nonMac), []);

	const missingNative = { platform: 'darwin', nativePresent: false };
	assert.ok(liveActivityLiveFailures(missingNative).some(f => /native AppKit module missing/.test(f)));

	const validDarwin = {
		platform: 'darwin',
		nativePresent: true,
		diagnosticsAfterOpen: { backend: 'native-appkit', sessionId: 'sess-1', status: 'working' },
		smokeTransportInstalled: true,
		nativeDiagnostics: {
			panelCreated: true,
			panelVisible: true,
			panelFrame: { x: 100, y: 1000, width: 300, height: 34 },
		},
		followUpSimulation: { ok: true },
		nativeScreenshot: { captured: true },
		quit: { remaining: 'gone' },
	};
	assert.deepEqual(liveActivityLiveFailures(validDarwin), []);

	const invalidFrame = {
		...validDarwin,
		nativeDiagnostics: { panelCreated: true, panelVisible: true, panelFrame: { x: 0, y: 0, width: 0, height: 0 } },
	};
	assert.ok(liveActivityLiveFailures(invalidFrame).some(f => /frame invalid/.test(f)));
});
