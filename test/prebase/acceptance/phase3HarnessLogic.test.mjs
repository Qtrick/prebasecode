import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { classifyHosts, lsofSelectionArgs, privacyFailures } from './prebase-privacy-runtime.mjs';
import { nodesDrawnFromMetrics, coreIdeFailures, codeGraphFailures, GRAPH_RENDER_METRICS_NAME, themesA11yFailures } from './prebase-core-ide-live.mjs';
import { activeSoakFailures } from './prebase-active-soak.mjs';
import { summarizeCpuProfile } from './prebase-renderer-cpu-diag.mjs';
import { loadQuitFailures } from './prebase-load-quit-live.mjs';
import { findGraphFrame, formatPhase3LockBlockMessage, waitForWorkbenchDriver, workbenchCommandWithTimeout } from './workbenchHarness.mjs';
import { PHASE3_REQUIRED_EVIDENCE, scenarioOk } from './prebase-phase3-final-gate.mjs';
import { magnusStreamFailures } from './prebase-magnus-stream-live.mjs';

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
		evaluate: () => new Promise(() => { }),
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
	};
}

function passingCodeGraph(overrides = {}) {
	return {
		opened: true,
		metricName: GRAPH_RENDER_METRICS_NAME,
		metrics: { nodesDrawn: 12, receivedNodeCount: 12 },
		nodesDrawn: true,
		selection: true,
		layoutModes: true,
		rotate: true,
		drag: true,
		idleRotateArmed: true,
		pick: true,
		sphereVsRadial: true,
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
		p1_settings: true,
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

test('workbenchCommandWithTimeout races evaluate against an explicit timer', () => {
	const source = readFileSync(join(acceptanceDir, 'workbenchHarness.mjs'), 'utf8');
	const body = exportedSource(source, 'workbenchCommandWithTimeout');
	assert.match(body, /Promise\.race\(/);
	assert.match(body, /workbench command timeout \(\$\{timeoutMs\}ms\): \$\{commandId\}/);
	assert.match(body, /page\.evaluate\(/);
	assert.match(body, /evaluateOptions = \{ timeout: timeoutMs \}/);
	assert.doesNotMatch(body, /commandArgs: args \},\s*\{ timeout/);
	assert.doesNotMatch(body, /usedSigkill|latencyMs\s*>/);
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

test('organic then organic cannot satisfy layoutModes or Sphere vs Radial', () => {
	assert.deepEqual(codeGraphFailures({ codeGraph: passingCodeGraph() }), []);
	const failures = codeGraphFailures({
		codeGraph: passingCodeGraph({
			layoutModes: Boolean('organic' && 'organic' && 'organic' !== 'organic'),
			sphereVsRadial: 'organic' === 'sphere' && 'organic' === 'radial',
			metrics: { nodesDrawn: 12, receivedNodeCount: 12, networkLayoutMode: 'organic' },
		}),
	});
	assert.ok(failures.some(item => /N2 layout modes/.test(item)));
	assert.ok(failures.some(item => /N8 Sphere vs Radial/.test(item)));
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
	assert.match(live, /button\[data-network-layout="\$\{mode\}"\]/);
	assert.match(live, /layoutModes: Boolean\(sphereMode && radialMode && sphereMode !== radialMode\)/);
	assert.match(live, /sphereVsRadial: sphereMode === 'sphere' && radialMode === 'radial'/);
	assert.match(live, /screenshot\(\{ path: join\(screenshotDir, 'code-graph-live\.png'\), timeout: 5_000 \}\)\.catch\(\(\) => undefined\)/);
	assert.match(live, /nodesDrawnFromMetrics/);
	assert.match(live, /waitForTimeout\(1_800\)/);
	assert.match(live, /selectedNodeId === pickHit\.id/);
	assert.doesNotMatch(live, /codeGraph\.screenshot/);
	assert.doesNotMatch(live, /afterInner !== beforeInner|devicePixelRatio/);
	assert.doesNotMatch(live, /Math\.max\(8, hits\[0\]\.x\)/);
	assert.match(live, /after > before/);
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
		evidenceKind: 'final',
		durationMs: activeSoak.minDurationMs,
		sourceHead: current,
	};
	assert.equal(scenarioOk({ ...activeSoak, sourceHead: current }, valid).ok, true);
	assert.equal(scenarioOk({ ...activeSoak, sourceHead: current }, { ...valid, evidenceKind: 'diagnostic' }).ok, false);
	assert.equal(scenarioOk({ ...activeSoak, sourceHead: current }, { ...valid, durationMs: activeSoak.minDurationMs - 1 }).ok, false);
	assert.equal(scenarioOk({ ...activeSoak, sourceHead: current }, { ...valid, sourceHead: 'stale-head' }).ok, false);
});

test('active soak protects canonical final evidence and final gate has explicit bounded modes', () => {
	const active = readFileSync(join(acceptanceDir, 'prebase-active-soak.mjs'), 'utf8');
	assert.match(active, /ACTIVE_SOAK_FINAL_MIN_DURATION_MS = 10 \* 60 \* 1000/);
	assert.match(active, /evidenceKind === 'final' \? 'active\.json' : 'active-diagnostic\.json'/);
	assert.match(active, /sourceHead: execFileSync\('git', \['rev-parse', 'HEAD'\]/);
	assert.doesNotMatch(active, /process count grew excessively during active soak/);

	const gate = readFileSync(join(acceptanceDir, 'prebase-phase3-final-gate.mjs'), 'utf8');
	assert.match(gate, /process\.argv\.includes\('--validate-evidence'\)/);
	assert.match(gate, /process\.argv\.includes\('--rerun-live'\)/);
	assert.match(gate, /expected \$\{entry\.evidenceKind\} evidence/);
	assert.match(gate, /evidence duration is below \$\{entry\.minDurationMs\}ms/);
	assert.match(gate, /evidence source HEAD does not match current HEAD/);
});

test('every live final-gate child has a deadline, log, and timeout failure path', () => {
	const rerunnable = PHASE3_REQUIRED_EVIDENCE.filter(item => item.rerun);
	assert.ok(rerunnable.length > 0);
	assert.ok(rerunnable.every(item => Number.isFinite(item.timeoutMs) && item.timeoutMs > 0));
	const gate = readFileSync(join(acceptanceDir, 'prebase-phase3-final-gate.mjs'), 'utf8');
	assert.match(gate, /gate-logs/);
	assert.match(gate, /child\.kill\('SIGTERM'\)/);
	assert.match(gate, /child\.kill\('SIGKILL'\)/);
	assert.match(gate, /live rerun timed out after/);
});

test('final gate requires current successful assurance evidence instead of a prose reminder', () => {
	const gate = readFileSync(join(acceptanceDir, 'prebase-phase3-final-gate.mjs'), 'utf8');
	assert.match(gate, /readJson\('assurance\.json'\)/);
	assert.match(gate, /scenarioOk\(\{ id: 'assurance', sourceHead: head \}, assurance\)/);
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
	assert.equal(scenarioOk({}, { ok: true }).ok, true);
});

test('individual harnesses must not overwrite phase-3-final/manifest.json', () => {
	const dirs = [
		acceptanceDir,
		join(repoRoot, 'graphs/scripts/acceptance'),
	];
	for (const dir of dirs) {
		const files = readdirSync(dir).filter(name =>
			name.endsWith('.mjs') &&
			!name.endsWith('.test.mjs') &&
			name !== 'prebase-phase3-final-gate.mjs' &&
			name !== 'workbenchHarness.mjs'
		);
		for (const name of files) {
			const source = readFileSync(join(dir, name), 'utf8');
			assert.equal(
				/phase-3-final\/manifest\.json/.test(source) || /join\(evidenceRoot,\s*['"]manifest\.json['"]\)/.test(source),
				false,
				`${name} must not write the final Phase 3 manifest`,
			);
		}
	}
	const gate = readFileSync(join(acceptanceDir, 'prebase-phase3-final-gate.mjs'), 'utf8');
	assert.match(gate, /join\(evidenceRoot,\s*['"]manifest\.json['"]\)/);
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
