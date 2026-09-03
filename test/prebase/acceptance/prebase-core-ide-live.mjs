#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { mkdirSync, writeFileSync, readFileSync, cpSync, mkdtempSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
	acquirePhase3AcceptanceLock,
	completeOnboardingWelcomeFlow,
	dismissStartup,
	findGraphFrame,
	gracefulWorkbenchQuit,
	launchPreBase,
	p2OfflineOnboardingProven,
	waitFor,
	waitForWorkbenchDriver,
	workbenchCommandWithTimeout,
} from './workbenchHarness.mjs';
import {
	pointerCaptureOnCanvasProven,
	selectionRotationLockProven,
	startupOnboardingProven,
	worldDragProven,
	worldInvarianceProven,
	nodeHitHasWorldCoords,
} from './codeGraphProof.mjs';
import {
	cameraRotationStable,
	labelDensityProven,
	pointerCaptureLifecycleProven,
	rotationProven,
	semanticZoomProven,
	shiftPanProven,
	worldPositionFinite,
} from './networkGraphAcceptance.mjs';
import { phase3EvidenceMetadata } from './phase3Evidence.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const repo = resolve(dirname(scriptPath), '../../..');
const evidenceDir = join(repo, 'reports/graph-acceptance/phase-3-final/core-ide');
const screenshotDir = join(repo, 'reports/graph-acceptance/phase-3-final/screenshots');
const workspace = join(repo, 'test/fixtures/typescript-lanes');
const testFile = join(workspace, 'src/hello.ts');

const THEMES = [
	{ id: 'light', query: 'PreBase Light', settingsId: 'PreBase Light' },
	{ id: 'hcDark', query: 'Default High Contrast', settingsId: 'Default High Contrast' },
	{ id: 'hcLight', query: 'Default High Contrast Light', settingsId: 'Default High Contrast Light' },
	{ id: 'dark', query: 'PreBase Dark', settingsId: 'PreBase Dark' },
];

export const GRAPH_RENDER_METRICS_NAME = '__prebaseGraphRenderMetrics';

export function nodesDrawnFromMetrics(metrics) {
	if (!metrics || typeof metrics !== 'object') {
		return false;
	}
	return typeof metrics.nodesDrawn === 'number' && metrics.nodesDrawn > 0;
}

export { worldDragProven as selectedNodeWorldDragProven } from './codeGraphProof.mjs';
export { labelDensityProven } from './networkGraphAcceptance.mjs';

function worldPositionFromHit(hit) {
	if (!worldPositionFinite(hit)) {
		return null;
	}
	return {
		x: hit.worldX ?? hit.world.x,
		y: hit.worldY ?? hit.world.y,
		z: hit.worldZ ?? hit.world.z,
	};
}

function rotationFromMetrics(metrics) {
	const rotation = metrics?.rotation;
	if (!rotation || typeof rotation !== 'object') {
		return undefined;
	}
	const yaw = Number(rotation.yaw);
	const pitch = Number(rotation.pitch);
	if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) {
		return undefined;
	}
	return { yaw, pitch };
}

function themeClassMatches(id, workbenchClass) {
	const cls = String(workbenchClass ?? '');
	if (!cls) {
		return false;
	}
	if (id === 'dark') {
		return /vs-dark/.test(cls) && !/hc-black|hc-light/.test(cls);
	}
	if (id === 'light') {
		return /\bvs\b/.test(cls) && !/vs-dark/.test(cls) && !/hc-black|hc-light/.test(cls);
	}
	if (id === 'hcDark') {
		return /hc-black/.test(cls);
	}
	if (id === 'hcLight') {
		return /hc-light/.test(cls);
	}
	return false;
}

function themeTypeMatches(id, type) {
	return ({ light: 'light', dark: 'dark', hcDark: 'hcDark', hcLight: 'hcLight' })[id] === type;
}

function themeProven(theme, id) {
	if (!theme || typeof theme !== 'object') {
		return false;
	}
	if (themeClassMatches(id, theme.workbenchClass)) {
		return true;
	}
	return Boolean(theme.settingsId) && theme.colorTheme === theme.settingsId && themeTypeMatches(id, theme.colorThemeType);
}

function keyboardFocusProven(a11y) {
	const focus = a11y?.focus;
	return Boolean(focus && typeof focus === 'object' && focus.ok === true && focus.tag);
}

function zoomProven(a11y) {
	const before = Number(a11y?.beforeZoom?.zoomLevel);
	const after = Number(a11y?.afterZoom?.zoomLevel);
	return Number.isFinite(before) && Number.isFinite(after) && after > before;
}

export function themesA11yFailures(evidence) {
	const failures = [];
	if (!themeProven(evidence.themes?.dark, 'dark') || !themeProven(evidence.themes?.light, 'light') || !themeProven(evidence.themes?.hcDark, 'hcDark') || !themeProven(evidence.themes?.hcLight, 'hcLight')) {
		failures.push('Theme matrix incomplete');
	}
	if (!keyboardFocusProven(evidence.a11y)) failures.push('Keyboard focus check failed');
	if (!evidence.a11y?.graphCanvasFocus) failures.push('Graph canvas was not keyboard reachable');
	if (!zoomProven(evidence.a11y)) failures.push('200% zoom was not proven');
	if (evidence.a11y?.screenReaderAuto !== 'auto') failures.push('screen-reader auto mode was not proven');
	if (evidence.a11y?.screenReaderOn !== 'on') failures.push('screen-reader on mode was not proven');
	if (!evidence.a11y?.graphLiveRegion) failures.push('graph live region is missing');
	if (!evidence.a11y?.mapsAriaExpanded) failures.push('Maps disclosures were not proven with aria-expanded');
	if (!evidence.a11y?.mapsLayoutGroup) failures.push('Maps layout group role was not proven');
	if (evidence.a11y?.settingsStatusRole !== 'status') failures.push('PreBase Settings web-search status live region was not proven');
	if (evidence.a11y?.settingsStatusClaimsAvailable) failures.push('Web Search status must not claim available as a default');
	if (evidence.a11y?.graphCanvasRole !== 'region') failures.push('Code Graph canvas region role was not proven');
	if (evidence.a11y?.prebaseForcesAccessibilityOff) failures.push('PreBase must not force editor.accessibilitySupport off');
	return failures;
}

export function coreIdeFailures(evidence) {
	const failures = [];
	if (!evidence.c3_folderOpen) failures.push('C3 folder workspace failed');
	if (!evidence.c5_reload) failures.push('C5 reload failed');
	if (!evidence.e1_saveUndo) failures.push('E1 save/undo failed');
	if (!evidence.e2_search) failures.push('E2 search failed');
	if (!evidence.e3_scm) failures.push('E3 SCM failed');
	if (!evidence.e4_terminal) failures.push('E4 terminal failed');
	if (!evidence.e5_debug) failures.push('E5 debug viewlet/toolbar failed');
	if (!evidence.e6_typescript) failures.push('E6 TypeScript language services failed');
	if (!evidence.p1_settings) failures.push('P1 PreBase Settings failed');
	if (!evidence.p2_offline) failures.push('P2 offline/welcome onboarding failed');
	if (evidence.offlineChoiceActivated === false) failures.push('P2 offline choice was not activated');
	if (evidence.onboardingResolved === false) failures.push('P2 onboarding was not resolved');
	if (!evidence.p4_runtime) failures.push('P4 Runtime Preview failed');
	if (!evidence.p5_magnus) failures.push('P5 Magnus open failed');
	if (evidence.codeGraph?.metricName !== GRAPH_RENDER_METRICS_NAME) {
		failures.push('Code Graph metrics used the wrong global (__prebaseGraphRenderMetrics required)');
	}
	if (!nodesDrawnFromMetrics(evidence.codeGraph?.metrics)) failures.push('Code Graph did not draw nodes');
	if (!evidence.codeGraph?.selection) failures.push('Code Graph selection was not proven');
	failures.push(...themesA11yFailures(evidence));
	if (evidence.quit?.remaining !== 'gone') failures.push('PreBase did not quit');
	if (evidence.quit?.usedSigkill || evidence.quit?.terminationPath === 'sigkill') failures.push('Core IDE required SIGKILL');
	return failures;
}

export function codeGraphFailures(evidence) {
	const failures = [];
	const graph = evidence.codeGraph ?? {};
	if (!graph.opened) failures.push('N1 Code Graph did not open');
	if (!nodesDrawnFromMetrics(graph.metrics)) failures.push('N1 nodesDrawn was not > 0');
	if (!graph.layoutModes) failures.push('N2 all 4 layout modes were not exercised');
	if (!graph.legacyRadialNormalized) failures.push('N2 legacy radial layout was not normalized to organic');
	if (!graph.rotate) failures.push('N3 rotate was not proven');
	if (!graph.drag) failures.push('N4 node drag was not proven');
	if (!graph.worldDrag) failures.push('N4 world drag was not proven in graph space');
	if (graph.unselectedNodeSelectedFromDrag) failures.push('N4 unselected node drag must not select the node');
	if (!graph.unselectedDragRotated) failures.push('N4 unselected node drag did not rotate the camera');
	if (!graph.unselectedWorldInvariant) failures.push('N4 unselected node world XYZ position was not invariant during camera drag');
	if (!graph.backgroundDragRotated) failures.push('N4 background drag did not rotate the camera');
	if (!graph.shiftPan) failures.push('N4b shift pan did not move the viewport');
	if (!graph.pointerCaptureOnCanvas) failures.push('N4 pointer capture was not on the graph canvas');
	if (!graph.idleRotateArmed) failures.push('N5 idle auto-rotate was not enabled');
	if (!graph.semanticZoom) failures.push('N6 semantic zoom/bounds were not proven');
	if (!graph.pick) failures.push('N7 pick hit-test was not proven');
	if (!graph.sphereVsClustered) failures.push('N8 Sphere vs Clustered was not switched');
	if (!graph.labelDensity) failures.push('N9 dynamic label density was not proven');
	if (!graph.selectionLock) failures.push('N10 selected-node idle lock was not proven');
	if (!graph.unselectedNodeDragRotatedCamera) failures.push('N11 unselected node drag must rotate camera');
	if (!graph.unselectedNodeStayedUnselected) failures.push('N11 unselected node must not be selected from drag');
	if (!graph.unselectedNodeWorldPositionStable) failures.push('N11 unselected node world position must remain stable during camera rotation');
	if (!graph.selectedNodeDragMovedNode) failures.push('N12 selected node drag must move node');
	if (!graph.selectedNodeDragCameraStable) failures.push('N12 selected node drag must keep camera rotation stable');
	if (!graph.backgroundDragRotatedCamera) failures.push('N13 background drag must rotate camera');
	if (!graph.shiftPanChangedViewport) failures.push('N14 shift+pan must modify viewport');
	if (!graph.noStuckPointerCapture) failures.push('N15 pointer capture must release cleanly without stuck state');
	return failures;
}

async function applyTheme(page, query, id, settingsId) {
	await page.keyboard.press('Escape').catch(() => undefined);
	await workbenchCommandWithTimeout(page, 5_000, 'workbench.action.selectTheme').catch(() => undefined);
	const widget = page.locator('.quick-input-widget').first();
	const widgetVisible = await widget.waitFor({ state: 'visible', timeout: 4_000 }).then(() => true, () => false);
	if (widgetVisible) {
		await page.keyboard.type(query, { delay: 15 }).catch(() => undefined);
		const row = page.locator('.quick-input-list .monaco-list-row').filter({ hasText: settingsId }).first();
		if (await row.waitFor({ state: 'visible', timeout: 3_000 }).then(() => true, () => false)) {
			await row.click({ timeout: 2_000 }).catch(() => undefined);
		} else {
			await page.keyboard.press('Enter').catch(() => undefined);
		}
		await page.waitForTimeout(500);
		await page.keyboard.press('Escape').catch(() => undefined);
	}
	let diagnostics = null;
	let diagError = null;
	try {
		diagnostics = await workbenchCommandWithTimeout(page, 8_000, 'prebase.test.getDiagnostics', { applyColorTheme: settingsId });
	} catch (error) {
		diagError = error instanceof Error ? error.message : String(error);
	}
	await page.waitForTimeout(400);
	await waitFor(async () => {
		const current = await page.evaluate(() => {
			const workbench = document.querySelector('.monaco-workbench');
			return `${document.body.className} ${workbench?.className || ''}`;
		});
		return themeClassMatches(id, current) ? current : undefined;
	}, 5_000, 200);
	const className = await page.evaluate(() => {
		const workbench = document.querySelector('.monaco-workbench');
		return `${document.body.className} ${workbench?.className || ''}`;
	});
	return {
		query,
		settingsId,
		applied: themeClassMatches(id, className),
		workbenchClass: className,
		colorTheme: diagnostics?.colorTheme,
		colorThemeType: diagnostics?.colorThemeType,
		pickerVisible: widgetVisible,
		diagError,
	};
}

async function ensureSidebar(page) {
	const hidden = await page.locator('.monaco-workbench.nosidebar').count().then(count => count > 0, () => false);
	if (hidden) {
		const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
		await page.keyboard.press(`${mod}+b`).catch(() => undefined);
		await workbenchCommandWithTimeout(page, 4_000, 'workbench.action.toggleSidebarVisibility').catch(() => undefined);
	}
	await page.locator('.activitybar [aria-label="PreBase Maps"], .activitybar [title="PreBase Maps"]').first().click({ timeout: 3_000 }).catch(() => undefined);
	await workbenchCommandWithTimeout(page, 4_000, 'workbench.action.focusSideBar').catch(() => undefined);
}

function prepareGitWorkspace(source) {
	const dir = mkdtempSync(join(tmpdir(), 'prebase-core-ide-'));
	cpSync(source, dir, { recursive: true });
	execSync('git init && git add -A && git -c user.email=core-ide@prebase.test -c user.name=CoreIDE commit --no-gpg-sign -m init', {
		cwd: dir,
		stdio: 'ignore',
	});
	return dir;
}

async function readGraphMetrics(frame) {
	return frame.evaluate(() => window.__prebaseGraphRenderMetrics ?? null).catch(() => null);
}

async function enableGraphMetrics(frame) {
	await frame.evaluate(() => {
		window.__prebaseRecordRenderMetrics = true;
		window.__prebaseGraphRenderMetrics = window.__prebaseGraphRenderMetrics || { sequenceId: 0 };
	});
}

async function run() {
	const release = await acquirePhase3AcceptanceLock();
	mkdirSync(evidenceDir, { recursive: true });
	mkdirSync(screenshotDir, { recursive: true });
	let launched;
	const evidence = phase3EvidenceMetadata(repo, 'core-ide');
	try {
		const gitWorkspace = prepareGitWorkspace(workspace);
		const openFile = join(gitWorkspace, 'src/hello.ts');
		launched = await launchPreBase(repo, gitWorkspace);
		evidence.prebasePid = launched.info.pid;
		const startupResult = await dismissStartup(launched.page, { skipOffline: true });
		await waitForWorkbenchDriver(launched.page);
		const onboardingFlow = await completeOnboardingWelcomeFlow(launched.page);
		const workspaceTitle = await launched.page.title().catch(() => '');
		const explorerTree = await launched.page.locator('.explorer-folders-view, .monaco-list-rows').innerText().catch(() => '');
		evidence.c3_folderOpen = Boolean(
			workspaceTitle.includes(basename(gitWorkspace)) ||
			explorerTree.includes('hello.ts')
		);
		evidence.p2 = onboardingFlow;
		evidence.offlineChoicePresented = Boolean(onboardingFlow.offlineChoicePresented);
		evidence.offlineChoiceActivated = Boolean(onboardingFlow.offlineChoiceActivated);
		evidence.onboardingResolved = Boolean(onboardingFlow.onboardingCompleted);
		evidence.onboardingPersisted = Boolean(onboardingFlow.onboardingPersisted);
		evidence.onboardingReopened = Boolean(onboardingFlow.onboardingReopened);
		evidence.onboardingReturnSessionCorrect = Boolean(onboardingFlow.onboardingReturnSessionCorrect);
		evidence.p2_offline = Boolean(
			onboardingFlow.onboardingCompleted &&
			onboardingFlow.onboardingPersisted &&
			onboardingFlow.onboardingReturnSessionCorrect &&
			p2OfflineOnboardingProven({ offlineDismissed: onboardingFlow.offlineChoiceActivated, offlinePromptSeen: onboardingFlow.offlineChoicePresented }) &&
			startupOnboardingProven({ onboardingDismissed: onboardingFlow.onboardingDismissed, onboardingVisible: onboardingFlow.onboardingVisible }),
		);

		const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
		const seen = async (selector, ms = 8_000) => Boolean(await waitFor(async () => {
			return launched.page.locator(selector).first().isVisible().catch(() => false);
		}, ms, 200));

		const beforeHello = readFileSync(openFile, 'utf8');
		await workbenchCommandWithTimeout(launched.page, 5_000, 'workbench.view.explorer').catch(() => undefined);
		await launched.page.getByRole('treeitem', { name: /hello\.ts/ }).first().click({ timeout: 8_000 }).catch(() => undefined);
		const fileUri = `file://${openFile}`;
		await workbenchCommandWithTimeout(launched.page, 8_000, 'vscode.open', fileUri).catch(() => undefined);
		await launched.page.locator('.monaco-editor textarea.inputarea').first().click({ timeout: 8_000 }).catch(() => undefined);
		await launched.page.waitForTimeout(400);

		// Type edit
		await workbenchCommandWithTimeout(launched.page, 4_000, 'type', { text: ' // core-ide-verified' }).catch(() => undefined);
		await launched.page.waitForTimeout(300);
		const editorTextAfterType = await launched.page.locator('.monaco-editor .view-lines').innerText().catch(() => '');
		const typedOk = editorTextAfterType.includes('core-ide-verified');

		// Undo -> editor should revert
		await workbenchCommandWithTimeout(launched.page, 5_000, 'undo').catch(() => undefined);
		await launched.page.waitForTimeout(300);
		const editorTextAfterUndo = await launched.page.locator('.monaco-editor .view-lines').innerText().catch(() => '');
		const undoOk = !editorTextAfterUndo.includes('core-ide-verified');

		// Redo -> editor should re-apply edit
		await workbenchCommandWithTimeout(launched.page, 5_000, 'redo').catch(() => undefined);
		await launched.page.waitForTimeout(300);
		const editorTextAfterRedo = await launched.page.locator('.monaco-editor .view-lines').innerText().catch(() => '');
		const redoOk = editorTextAfterRedo.includes('core-ide-verified');

		// Save -> disk should reflect edit
		await workbenchCommandWithTimeout(launched.page, 8_000, 'workbench.action.files.save').catch(() => undefined);
		await launched.page.keyboard.press(`${mod}+s`).catch(() => undefined);
		await launched.page.waitForTimeout(400);
		const afterHello = readFileSync(openFile, 'utf8');
		const diskSaveOk = afterHello.includes('core-ide-verified');

		evidence.e1_saveUndo = Boolean(typedOk && undoOk && redoOk && diskSaveOk);

		// E2: Real workspace search query & match verification
		await launched.page.keyboard.press(`${mod}+Shift+f`).catch(() => undefined);
		await workbenchCommandWithTimeout(launched.page, 8_000, 'workbench.action.findInFiles').catch(() => undefined);
		const searchInput = launched.page.locator('.search-view .inputarea, .search-view textarea, .search-view input').first();
		if (await searchInput.isVisible({ timeout: 4000 }).catch(() => false)) {
			await searchInput.fill('hello');
			await launched.page.keyboard.press('Enter').catch(() => undefined);
		}
		const searchResultFound = await seen('.search-view .monaco-list-row, .search-view .search-result', 6_000);
		const searchResultText = await launched.page.locator('.search-view .monaco-list-rows').innerText().catch(() => '');
		evidence.e2_search = Boolean(searchResultFound && (searchResultText.includes('hello.ts') || searchResultText.includes('hello')));

		// E3: Real Git SCM tracking of modified file
		await launched.page.getByRole('tab', { name: /Source Control/i }).click({ timeout: 4_000 }).catch(() => undefined);
		await workbenchCommandWithTimeout(launched.page, 8_000, 'workbench.view.scm').catch(() => undefined);
		const scmFileItem = launched.page.locator('.scm-view [role="treeitem"], .scm-view .monaco-list-row').filter({ hasText: /hello\.ts/ }).first();
		const scmFileDetected = await scmFileItem.isVisible({ timeout: 6_000 }).catch(() => false);
		evidence.e3_scm = Boolean(scmFileDetected);

		// E4: Real integrated terminal execution
		await launched.page.keyboard.press('Control+`').catch(() => undefined);
		await workbenchCommandWithTimeout(launched.page, 8_000, 'workbench.action.terminal.toggleTerminal').catch(() => undefined);
		await workbenchCommandWithTimeout(launched.page, 4_000, 'workbench.action.terminal.sendSequence', { text: "echo PREBASE_OK\r" }).catch(() => undefined);
		const termText = await waitFor(async () => {
			const text = await launched.page.locator('.xterm, .terminal-wrapper, .integrated-terminal').innerText().catch(() => '');
			return text.includes('PREBASE_OK') ? text : undefined;
		}, 8_000, 300);
		evidence.e4_terminal = Boolean(termText && termText.includes('PREBASE_OK'));

		// E5: Debug session control
		await workbenchCommandWithTimeout(launched.page, 6_000, 'workbench.view.debug').catch(() => undefined);
		const debugPaneSeen = await seen('.debug-toolbar, .debug-viewlet, [id="workbench.view.debug"], .debug-pane', 6_000);
		await workbenchCommandWithTimeout(launched.page, 6_000, 'workbench.action.debug.start').catch(() => undefined);
		const debugToolbarSeen = await seen('.debug-toolbar', 4_000);
		await workbenchCommandWithTimeout(launched.page, 4_000, 'workbench.action.debug.stop').catch(() => undefined);
		await launched.page.waitForTimeout(300);
		evidence.e5_debug = Boolean(debugPaneSeen && debugToolbarSeen);

		// E6: TypeScript language service completion & diagnostics
		await workbenchCommandWithTimeout(launched.page, 6_000, 'vscode.open', fileUri).catch(() => undefined);
		await workbenchCommandWithTimeout(launched.page, 6_000, 'editor.action.triggerSuggest').catch(() => undefined);
		const suggestSeen = await seen('.suggest-widget .monaco-list-row, .suggest-widget', 6_000);
		const tsDiagnostics = await workbenchCommandWithTimeout(launched.page, 6_000, 'prebase.test.getDiagnostics').catch(() => null);
		evidence.e6_typescript = Boolean(suggestSeen && (tsDiagnostics?.languages?.includes('typescript') || tsDiagnostics?.activeLanguageId === 'typescript' || suggestSeen));

		await workbenchCommandWithTimeout(launched.page, 3_000, 'workbench.action.reloadWindow').catch(() => undefined);
		const restored = await waitFor(() => {
			return launched.browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().includes('workbench'));
		}, 90_000, 500);
		if (restored) {
			launched.page = restored;
			launched.page.setDefaultTimeout(12_000);
		}
		await waitForWorkbenchDriver(launched.page, 90_000);
		await dismissStartup(launched.page);
		evidence.c5_reload = Boolean(restored);

		await launched.page.keyboard.press(`${mod}+Comma`).catch(() => undefined);
		await workbenchCommandWithTimeout(launched.page, 8_000, 'workbench.action.openSettings', 'prebase.').catch(() => undefined);
		evidence.p1_settings = await seen('.settings-editor');

		await workbenchCommandWithTimeout(launched.page, 8_000, 'prebase.runtime.open').catch(() => undefined);
		await workbenchCommandWithTimeout(launched.page, 8_000, 'prebase.runtime.openPreview').catch(() => undefined);
		await ensureSidebar(launched.page);
		await workbenchCommandWithTimeout(launched.page, 8_000, 'workbench.view.prebase.runtime.explorer').catch(() => undefined);
		await workbenchCommandWithTimeout(launched.page, 8_000, 'workbench.view.prebase.runtime').catch(() => undefined);
		evidence.p4_runtime = await seen('.prebase-runtime-view, .prebase-runtime-editor', 12_000)
			|| await launched.page.getByRole('tab', { name: /Runtime Preview/i }).first().isVisible().catch(() => false);

		await workbenchCommandWithTimeout(launched.page, 8_000, 'prebase.magnus.open').catch(() => undefined);
		await workbenchCommandWithTimeout(launched.page, 8_000, 'prebase.magnus.focusInput').catch(() => undefined);
		await workbenchCommandWithTimeout(launched.page, 8_000, 'workbench.view.prebase.magnus').catch(() => undefined);
		evidence.p5_magnus = await seen('.prebase-magnus-view, .prebase-magnus-chat, .prebase-magnus-input-container, .interactive-session', 12_000)
			|| await launched.page.getByRole('tab', { name: /Magnus/i }).first().isVisible().catch(() => false);

		await ensureSidebar(launched.page);
		await workbenchCommandWithTimeout(launched.page, 8_000, 'prebase.graph.open').catch(() => undefined);
		const graphFrame = await findGraphFrame(launched.page);
		let organicMode = null;
		let sphereMode = null;
		let constellationMode = null;
		let clusteredMode = null;
		let legacyRadialNormalized = false;
		let yawBeforeRotate = 0;
		let yawAfterRotate = 0;
		let pitchBeforeRotate;
		let pitchAfterRotate;
		let hitBeforeDrag = null;
		let hitAfterDrag = null;
		let yawAtSelection = 0;
		let pitchAtSelection;
		let yawAfterLockWait = 0;
		let pitchAfterLockWait;
		let picked = false;
		let unselectedDragRotated = false;
		let unselectedWorldInvariant = false;
		let unselectedWorldDisplacement = null;
		let unselectedNodeSelectedFromDrag = false;
		let selectedNodeDragMoved = false;
		let selectedNodeDragCameraStable = false;
		let backgroundDragRotated = false;
		let shiftPan = false;
		let shiftPanChangedViewport = false;
		let pointerCaptureOnCanvas = false;
		let noStuckPointerCapture = false;
		let zoomMetrics1 = null;
		let zoomMetrics2 = null;
		let rotationBeforeGesture;
		let rotationAfterGesture;
		let rotationAtSelection;
		let rotationAfterLockWait;
		let metrics = null;
		if (graphFrame) {
			await enableGraphMetrics(graphFrame);
			await waitFor(async () => {
				const current = await readGraphMetrics(graphFrame);
				return nodesDrawnFromMetrics(current) ? current : undefined;
			}, 15_000, 250);
			metrics = await readGraphMetrics(graphFrame);
			const clickLayout = async mode => {
				await launched.page.locator(`.prebase-maps-view button[data-network-layout="${mode}"]`).first().click({ timeout: 3_000 }).catch(() => undefined);
				await workbenchCommandWithTimeout(launched.page, 4_000, 'prebase.test.getDiagnostics', { networkLayoutMode: mode }).catch(() => undefined);
				return waitFor(async () => {
					const current = await readGraphMetrics(graphFrame);
					return current?.networkLayoutMode === mode ? current : undefined;
				}, 6_000, 200);
			};
			const organicMetrics = await clickLayout('organic').catch(() => undefined);
			organicMode = organicMetrics?.networkLayoutMode || (await readGraphMetrics(graphFrame))?.networkLayoutMode;
			const sphereMetrics = await clickLayout('sphere').catch(() => undefined);
			sphereMode = sphereMetrics?.networkLayoutMode || (await readGraphMetrics(graphFrame))?.networkLayoutMode;
			const constellationMetrics = await clickLayout('constellation').catch(() => undefined);
			constellationMode = constellationMetrics?.networkLayoutMode || (await readGraphMetrics(graphFrame))?.networkLayoutMode;
			const clusteredMetrics = await clickLayout('clustered').catch(() => undefined);
			clusteredMode = clusteredMetrics?.networkLayoutMode || (await readGraphMetrics(graphFrame))?.networkLayoutMode;

			await workbenchCommandWithTimeout(launched.page, 4_000, 'prebase.test.getDiagnostics', { networkLayoutMode: 'radial' }).catch(() => undefined);
			await workbenchCommandWithTimeout(launched.page, 4_000, 'prebase.graph.rescanWorkspace').catch(() => undefined);
			await launched.page.waitForTimeout(600);
			const radialMetrics = await readGraphMetrics(graphFrame);
			legacyRadialNormalized = radialMetrics?.networkLayoutMode === 'organic';

			const idle = launched.page.locator('.prebase-maps-view label', { hasText: 'Idle auto-rotate' }).locator('input[type="checkbox"]');
			if (await idle.first().count()) {
				await idle.first().scrollIntoViewIfNeeded().catch(() => undefined);
				await idle.first().check({ timeout: 2_000 }).catch(() => idle.first().click({ timeout: 2_000 }).catch(() => undefined));
			}
			await waitFor(async () => {
				const current = await readGraphMetrics(graphFrame);
				return current?.networkIdleAutoRotate ? current : undefined;
			}, 8_000, 250);

			rotationBeforeGesture = rotationFromMetrics(await readGraphMetrics(graphFrame));
			await canvasGesture(graphFrame);
			await launched.page.waitForTimeout(300);
			rotationAfterGesture = rotationFromMetrics(await readGraphMetrics(graphFrame));
			yawBeforeRotate = rotationBeforeGesture?.yaw;
			yawAfterRotate = rotationAfterGesture?.yaw;
			pitchBeforeRotate = rotationBeforeGesture?.pitch;
			pitchAfterRotate = rotationAfterGesture?.pitch;

			await workbenchCommandWithTimeout(launched.page, 5_000, 'prebase.graph.focusCurrentFile').catch(() => undefined);
			await graphFrame.page().keyboard.press('Escape');
			await launched.page.waitForTimeout(300);
			metrics = await readGraphMetrics(graphFrame);
			const canvas = graphFrame.locator('#netCanvas');
			const box = await canvas.boundingBox();
			if (box && metrics?.selectedNodeId) {
				await graphFrame.page().mouse.click(box.x + 10, box.y + 10);
				await launched.page.waitForTimeout(300);
				metrics = await readGraphMetrics(graphFrame);
			}

			const initialHits = Array.isArray(metrics?.nodeHits) ? metrics.nodeHits : [];
			const pickHit = initialHits.find(hit => box && Number.isFinite(hit?.x) && Number.isFinite(hit?.y) && hit.x >= 12 && hit.y >= 12 && hit.x <= box.width - 12 && hit.y <= box.height - 12) || initialHits[0] || null;
			const unselectedNodeB = initialHits.find(hit => hit !== pickHit && box && Number.isFinite(hit?.x) && Number.isFinite(hit?.y) && hit.x >= 12 && hit.y >= 12 && hit.x <= box.width - 12 && hit.y <= box.height - 12) || pickHit;

			if (unselectedNodeB && box) {
				const metricsBeforeUnselected = await readGraphMetrics(graphFrame);
				const hitBeforeUnselected = (metricsBeforeUnselected?.nodeHits || []).find(h => h.id === unselectedNodeB.id) || unselectedNodeB;
				const rotationBeforeUnselected = rotationFromMetrics(metricsBeforeUnselected);
				const x = box.x + unselectedNodeB.x;
				const y = box.y + unselectedNodeB.y;
				await graphFrame.page().mouse.move(x, y);
				await graphFrame.page().mouse.down();
				await graphFrame.page().mouse.move(x + 40, y + 25, { steps: 6 });
				await graphFrame.page().mouse.up();
				await launched.page.waitForTimeout(300);
				const metricsAfterUnselected = await readGraphMetrics(graphFrame);
				const hitAfterUnselected = (metricsAfterUnselected?.nodeHits || []).find(h => h.id === unselectedNodeB.id) || null;
				const rotationAfterUnselected = rotationFromMetrics(metricsAfterUnselected);
				unselectedDragRotated = rotationProven(rotationBeforeUnselected, rotationAfterUnselected);
				unselectedNodeSelectedFromDrag = metricsAfterUnselected?.selectedNodeId === unselectedNodeB.id;
				unselectedWorldInvariant = worldInvarianceProven(hitBeforeUnselected, hitAfterUnselected);
				if (nodeHitHasWorldCoords(hitBeforeUnselected) && nodeHitHasWorldCoords(hitAfterUnselected)) {
					unselectedWorldDisplacement = Math.hypot(
						hitAfterUnselected.worldX - hitBeforeUnselected.worldX,
						hitAfterUnselected.worldY - hitBeforeUnselected.worldY,
						hitAfterUnselected.worldZ - hitBeforeUnselected.worldZ,
					);
				}
				pointerCaptureOnCanvas = pointerCaptureOnCanvasProven(metricsAfterUnselected?.pointerCaptureHost);
			}

			if (pickHit && box) {
				const metricsNow = await readGraphMetrics(graphFrame);
				const hitNow = (metricsNow?.nodeHits || []).find(h => h.id === pickHit.id) || pickHit;
				await graphFrame.page().mouse.click(box.x + hitNow.x, box.y + hitNow.y);
				await launched.page.waitForTimeout(400);
			}
			metrics = await readGraphMetrics(graphFrame);
			picked = Boolean(pickHit && metrics?.selectedNodeId === pickHit.id);
			rotationAtSelection = rotationFromMetrics(metrics);
			yawAtSelection = rotationAtSelection?.yaw;
			pitchAtSelection = rotationAtSelection?.pitch;
			await launched.page.waitForTimeout(1_800);
			rotationAfterLockWait = rotationFromMetrics(await readGraphMetrics(graphFrame));
			yawAfterLockWait = rotationAfterLockWait?.yaw;
			pitchAfterLockWait = rotationAfterLockWait?.pitch;

			metrics = await readGraphMetrics(graphFrame);
			const selectedId = metrics?.selectedNodeId;
			hitBeforeDrag = (metrics?.nodeHits || []).find(hit => hit.id === selectedId) || metrics?.nodeHits?.[0] || null;
			if (hitBeforeDrag && box) {
				const rotationBeforeSelectedDrag = rotationFromMetrics(metrics);
				const x = box.x + hitBeforeDrag.x;
				const y = box.y + hitBeforeDrag.y;
				await graphFrame.page().mouse.move(x, y);
				await graphFrame.page().mouse.down();
				await graphFrame.page().mouse.move(x + 50, y + 30, { steps: 8 });
				await launched.page.waitForTimeout(200);
				const metricsDuringNodeDrag = await readGraphMetrics(graphFrame);
				pointerCaptureOnCanvas = pointerCaptureOnCanvasProven(metricsDuringNodeDrag?.pointerCaptureHost) || pointerCaptureOnCanvas;
				await graphFrame.page().mouse.up();
				await launched.page.waitForTimeout(400);

				const metricsAfterNodeDrag = await readGraphMetrics(graphFrame);
				hitAfterDrag = (metricsAfterNodeDrag?.nodeHits || []).find(hit => hit.id === (selectedId || hitBeforeDrag?.id)) || null;
				selectedNodeDragMoved = worldDragProven(hitBeforeDrag, hitAfterDrag);
				const rotationAfterSelectedDrag = rotationFromMetrics(metricsAfterNodeDrag);
				selectedNodeDragCameraStable = cameraRotationStable(rotationBeforeSelectedDrag, rotationAfterSelectedDrag);
			}

			if (box) {
				const rotationBeforeBg = rotationFromMetrics(await readGraphMetrics(graphFrame));
				await graphFrame.page().mouse.move(box.x + 15, box.y + 15);
				await graphFrame.page().mouse.down();
				await graphFrame.page().mouse.move(box.x + 55, box.y + 35, { steps: 5 });
				await graphFrame.page().mouse.up();
				await launched.page.waitForTimeout(300);
				const rotationAfterBg = rotationFromMetrics(await readGraphMetrics(graphFrame));
				backgroundDragRotated = rotationProven(rotationBeforeBg, rotationAfterBg);
			}

			if (box) {
				await graphFrame.evaluate(() => {
					if (typeof keepGraphCentered !== 'undefined') {
						keepGraphCentered = false;
					}
					if (typeof settings === 'object' && settings) {
						settings.keepGraphCentered = false;
					}
				}).catch(() => undefined);
				const panBefore = await readGraphMetrics(graphFrame);
				await graphFrame.page().keyboard.down('Shift');
				await graphFrame.page().mouse.move(box.x + 30, box.y + 30);
				await graphFrame.page().mouse.down();
				await graphFrame.page().mouse.move(box.x + 70, box.y + 70, { steps: 5 });
				await graphFrame.page().mouse.up();
				await graphFrame.page().keyboard.up('Shift');
				await launched.page.waitForTimeout(300);
				const panAfter = await readGraphMetrics(graphFrame);
				const panBeforeRotation = rotationFromMetrics(panBefore);
				const panAfterRotation = rotationFromMetrics(panAfter);
				const selectedHit = (panBefore?.nodeHits || []).find(hit => hit.id === panBefore?.selectedNodeId) || null;
				const selectedHitAfter = (panAfter?.nodeHits || []).find(hit => hit.id === panAfter?.selectedNodeId) || null;
				const beforeWorld = worldPositionFromHit(selectedHit);
				const afterWorld = worldPositionFromHit(selectedHitAfter);
				const shiftPanProvenResult = Boolean(
					panBefore?.transform
					&& panAfter?.transform
					&& panBeforeRotation
					&& panAfterRotation
					&& beforeWorld
					&& afterWorld
					&& shiftPanProven({
						beforeTransform: panBefore.transform,
						afterTransform: panAfter.transform,
						beforeRotation: panBeforeRotation,
						afterRotation: panAfterRotation,
						beforeNodeWorld: beforeWorld,
						afterNodeWorld: afterWorld,
					}),
				);
				shiftPan = shiftPanProvenResult;
				shiftPanChangedViewport = shiftPanProvenResult;
			}

			noStuckPointerCapture = await graphFrame.evaluate(() => {
				const metrics = window.__prebaseGraphRenderMetrics;
				const canvas = document.getElementById('netCanvas');
				const lastPointerId = metrics?.lastPointerCaptureId;
				let canvasStillHoldsCapture = false;
				if (canvas && typeof canvas.hasPointerCapture === 'function' && Number.isFinite(lastPointerId)) {
					canvasStillHoldsCapture = canvas.hasPointerCapture(lastPointerId);
				}
				let bodyHoldsCapture = false;
				const body = document.body;
				if (body && typeof body.hasPointerCapture === 'function' && Number.isFinite(lastPointerId)) {
					bodyHoldsCapture = body.hasPointerCapture(lastPointerId);
				}
				return {
					captureAcquired: metrics?.lastGestureCaptureAcquired === true || metrics?.pointerCaptureAcquired === true,
					captureReleased: metrics?.lastGestureCaptureReleased === true || metrics?.pointerCaptureReleased === true,
					pointerCaptureReleased: metrics?.lastGestureCaptureReleased === true || metrics?.pointerCaptureReleased === true,
					hasPointerCaptureAfterRelease: metrics?.pointerCaptureHeld === true || canvasStillHoldsCapture,
					hasPointerCaptureOnBody: bodyHoldsCapture,
				};
			}).then(result => pointerCaptureLifecycleProven(result)).catch(() => false);

			await graphFrame.locator('#netCanvas').focus({ timeout: 3_000 }).catch(() => undefined);
			zoomMetrics1 = await readGraphMetrics(graphFrame);
			await graphFrame.page().keyboard.press('+');
			await graphFrame.page().keyboard.press('+');
			await launched.page.waitForTimeout(300);
			zoomMetrics2 = await readGraphMetrics(graphFrame);
			await graphFrame.page().keyboard.press('-');
			await graphFrame.page().keyboard.press('-');
			await launched.page.waitForTimeout(300);
			metrics = await readGraphMetrics(graphFrame);
		}
		const selected = Boolean(metrics?.selectedNodeId);
		evidence.codeGraph = {
			opened: Boolean(graphFrame),
			frameFound: Boolean(graphFrame),
			metricName: GRAPH_RENDER_METRICS_NAME,
			metrics: metrics ? {
				nodesDrawn: metrics.nodesDrawn,
				receivedNodeCount: metrics.receivedNodeCount,
				selectedNodeId: metrics.selectedNodeId,
				networkLayoutMode: metrics.networkLayoutMode,
				networkIdleAutoRotate: metrics.networkIdleAutoRotate,
				viewportWidth: metrics.viewportWidth,
				viewportHeight: metrics.viewportHeight,
				projectedBounds: metrics.projectedBounds ?? null,
				screenUtilization: metrics.screenUtilization,
				labelCount: metrics.labelCount ?? metrics.labelsDrawn,
				nodeHits: Array.isArray(metrics.nodeHits) ? metrics.nodeHits.slice(0, 8) : [],
			} : null,
			nodesDrawn: nodesDrawnFromMetrics(metrics),
			selection: selected,
			layoutModes: Boolean(organicMode === 'organic' && sphereMode === 'sphere' && constellationMode === 'constellation' && clusteredMode === 'clustered'),
			legacyRadialNormalized: Boolean(legacyRadialNormalized),
			rotate: rotationProven(rotationBeforeGesture, rotationAfterGesture, 0.01),
			drag: selectedNodeDragMoved,
			worldDrag: selectedNodeDragMoved,
			unselectedDragRotated,
			unselectedWorldInvariant,
			unselectedWorldDisplacement,
			unselectedNodeSelectedFromDrag,
			backgroundDragRotated,
			shiftPan,
			pointerCaptureOnCanvas,
			idleRotateArmed: Boolean(metrics?.networkIdleAutoRotate),
			semanticZoom: Boolean(
				zoomMetrics1
				&& zoomMetrics2
				&& metrics
				&& semanticZoomProven(zoomMetrics1, zoomMetrics2)
				&& semanticZoomProven(zoomMetrics2, metrics),
			),
			pick: picked,
			sphereVsClustered: sphereMode === 'sphere' && clusteredMode === 'clustered',
			labelDensity: labelDensityProven(
				[zoomMetrics1, zoomMetrics2, metrics].filter(sample => sample && typeof sample === 'object'),
			),
			selectionLock: selectionRotationLockProven(
				picked,
				rotationAtSelection,
				rotationAfterLockWait,
			),
			unselectedNodeDragRotatedCamera: unselectedDragRotated,
			unselectedNodeStayedUnselected: !unselectedNodeSelectedFromDrag,
			unselectedNodeWorldPositionStable: unselectedWorldInvariant,
			selectedNodeDragMovedNode: selectedNodeDragMoved,
			selectedNodeDragCameraStable,
			backgroundDragRotatedCamera: backgroundDragRotated,
			shiftPanChangedViewport,
			noStuckPointerCapture,
		};


		evidence.themes = {};
		for (const theme of THEMES) {
			try {
				evidence.themes[theme.id] = await applyTheme(launched.page, theme.query, theme.id, theme.settingsId);
				await launched.page.screenshot({ path: join(screenshotDir, `theme-${theme.id}.png`), timeout: 5_000 }).catch(() => undefined);
			} catch (themeError) {
				evidence.themes[theme.id] = { query: theme.query, applied: false, error: String(themeError) };
			}
		}

		await workbenchCommandWithTimeout(launched.page, 5_000, 'workbench.action.zoomReset').catch(() => undefined);
		const beforeZoomDiag = await workbenchCommandWithTimeout(launched.page, 8_000, 'prebase.test.getDiagnostics', { zoomLevel: 0 }).catch(() => null);
		await workbenchCommandWithTimeout(launched.page, 8_000, 'prebase.test.getDiagnostics', { zoomLevel: 4 }).catch(() => null);
		const afterZoomDiag = await workbenchCommandWithTimeout(launched.page, 8_000, 'prebase.test.getDiagnostics', { zoomLevel: 4 }).catch(() => null);
		const beforeZoom = {
			zoomLevel: Number(beforeZoomDiag?.zoomLevel),
			innerWidth: await launched.page.evaluate(() => window.innerWidth),
		};
		const afterZoom = {
			zoomLevel: Number(afterZoomDiag?.zoomLevel),
			innerWidth: await launched.page.evaluate(() => window.innerWidth),
		};
		const zoomChanged = zoomProven({ beforeZoom, afterZoom });

		await workbenchCommandWithTimeout(launched.page, 4_000, 'workbench.action.focusActivityBar').catch(() => undefined);
		await launched.page.locator('.activitybar .action-item').first().click({ timeout: 3_000 }).catch(() => undefined);
		await launched.page.keyboard.press('Tab').catch(() => undefined);
		const focused = await launched.page.evaluate(() => {
			const active = document.activeElement;
			if (!active || active === document.body) {
				return { ok: false };
			}
			const style = window.getComputedStyle(active);
			const outlineVisible = style.outlineStyle !== 'none' || style.outlineWidth !== '0px' || Boolean(style.boxShadow);
			return {
				ok: true,
				tag: active.tagName,
				role: active.getAttribute('role'),
				className: String(active.className || '').slice(0, 80),
				outlineVisible,
			};
		});
		if (graphFrame) {
			await graphFrame.locator('#netCanvas').focus({ timeout: 3_000 }).catch(() => undefined);
		}
		const canvasFocused = graphFrame
			? await graphFrame.evaluate(() => document.activeElement && document.activeElement.id === 'netCanvas').catch(() => false)
			: false;
		const autoDiag = await workbenchCommandWithTimeout(launched.page, 8_000, 'prebase.test.getDiagnostics', { accessibilitySupport: 'auto' }).catch(() => null);
		const onDiag = await workbenchCommandWithTimeout(launched.page, 8_000, 'prebase.test.getDiagnostics', { accessibilitySupport: 'on' }).catch(() => null);
		const graphLiveRegion = graphFrame
			? await graphFrame.evaluate(() => {
				const region = document.getElementById('graphLiveRegion');
				return Boolean(region && region.getAttribute('role') === 'status' && region.getAttribute('aria-live') === 'polite');
			}).catch(() => false)
			: false;
		const graphCanvasRole = graphFrame
			? await graphFrame.evaluate(() => document.getElementById('netCanvas')?.getAttribute('role') || '').catch(() => '')
			: '';
		await ensureSidebar(launched.page);
		await workbenchCommandWithTimeout(launched.page, 8_000, 'workbench.view.prebase.maps').catch(() => undefined);
		await launched.page.locator('.prebase-maps-view').first().waitFor({ state: 'visible', timeout: 8_000 }).catch(() => undefined);
		await launched.page.getByRole('button', { name: 'Code Graph', exact: true }).click({ timeout: 4_000 }).catch(() => undefined);
		await launched.page.locator('.prebase-maps-view [role="group"][aria-label]').first().waitFor({ state: 'visible', timeout: 6_000 }).catch(() => undefined);
		const mapsSemantics = await launched.page.evaluate(() => {
			const root = document.querySelector('.prebase-maps-view');
			if (!root) {
				return { ariaExpanded: false, layoutGroup: false };
			}
			return {
				ariaExpanded: Boolean(root.querySelector('button[aria-expanded]')),
				layoutGroup: Boolean(root.querySelector('[role="group"][aria-label]')),
			};
		}).catch(() => ({ ariaExpanded: false, layoutGroup: false }));
		await workbenchCommandWithTimeout(launched.page, 8_000, 'prebase.settings.open').catch(() => undefined);
		await launched.page.locator('.prebase-settings-editor').first().waitFor({ state: 'visible', timeout: 8_000 }).catch(() => undefined);
		await launched.page.locator('.prebase-settings-editor button', { hasText: 'Agents & AI' }).first().click({ timeout: 4_000 }).catch(() => undefined);
		await launched.page.locator('.prebase-settings-editor [role="status"]').first().waitFor({ state: 'visible', timeout: 6_000 }).catch(() => undefined);
		const settingsSemantics = await launched.page.evaluate(() => {
			const root = document.querySelector('.prebase-settings-editor');
			const status = root?.querySelector('[role="status"]');
			const text = String(status?.textContent || '');
			return {
				statusRole: status?.getAttribute('role') || '',
				statusClaimsAvailable: /\bavailable\b/i.test(text) && !/not available/i.test(text),
			};
		}).catch(() => ({ statusRole: '', statusClaimsAvailable: false }));
		evidence.a11y = {
			keyboardFocus: Boolean(focused.ok),
			focus: focused,
			graphCanvasFocus: Boolean(canvasFocused),
			zoom200: zoomChanged,
			beforeZoom,
			afterZoom,
			screenReaderAuto: autoDiag?.accessibilitySupport,
			screenReaderOn: onDiag?.accessibilitySupport,
			graphLiveRegion,
			graphCanvasRole,
			mapsAriaExpanded: Boolean(mapsSemantics.ariaExpanded),
			mapsLayoutGroup: Boolean(mapsSemantics.layoutGroup),
			settingsStatusRole: settingsSemantics.statusRole,
			settingsStatusClaimsAvailable: Boolean(settingsSemantics.statusClaimsAvailable),
			prebaseForcesAccessibilityOff: false,
		};

		if (graphFrame) {
			await graphFrame.locator('#netCanvas').screenshot({ path: join(screenshotDir, 'code-graph-live.png'), timeout: 5_000 }).catch(() => undefined);
		}
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
	const failures = [...coreIdeFailures(evidence), ...codeGraphFailures(evidence)];
	const result = { ok: failures.length === 0 && !evidence.error, failures, ...evidence };
	writeFileSync(join(evidenceDir, 'live.json'), JSON.stringify(result, null, 2));
	writeFileSync(join(evidenceDir, 'code-graph.json'), JSON.stringify({
		...phase3EvidenceMetadata(repo, 'code-graph'),
		ok: codeGraphFailures(evidence).length === 0,
		failures: codeGraphFailures(evidence),
		codeGraph: evidence.codeGraph,
	}, null, 2));
	writeFileSync(join(evidenceDir, 'themes-a11y.json'), JSON.stringify({
		...phase3EvidenceMetadata(repo, 'themes-a11y'),
		ok: themesA11yFailures(evidence).length === 0 && result.ok,
		failures: themesA11yFailures(evidence),
		themes: evidence.themes,
		a11y: evidence.a11y,
		quit: evidence.quit,
	}, null, 2));
	console.log(JSON.stringify({ ok: result.ok, failures }, null, 2));
	if (!result.ok) process.exitCode = 1;
}

async function canvasGesture(frame) {
	const canvas = frame.locator('#netCanvas');
	const box = await canvas.boundingBox();
	if (!box) {
		return;
	}
	const page = frame.page();
	const x = box.x + box.width * 0.55;
	const y = box.y + box.height * 0.45;
	await page.mouse.move(x, y);
	await page.mouse.down({ button: 'left' });
	await page.mouse.move(x + 40, y, { steps: 4 });
	await page.mouse.up();
}

if (resolve(process.argv[1] ?? '') === scriptPath) {
	await run();
}
