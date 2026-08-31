/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as vm from 'node:vm';
import { suite, test } from 'mocha';
import { interpolateWebviewScript } from '../../host/workbench/temporalRuntimeContracts.js';

class FakeElement {
	id = '';
	hidden = false;
	style: Record<string, string> = { display: 'none' };
	attributes = new Map<string, string>();
	listeners = new Map<string, Array<(evt: any) => void>>();
	classList = new Set<string>();
	textContent = '';
	title = '';
	tabIndex = 0;
	clientWidth = 800;
	clientHeight = 600;
	offsetWidth = 800;
	offsetHeight = 600;

	setAttribute(name: string, value: string): void {
		this.attributes.set(name, value);
	}
	getAttribute(name: string): string | undefined {
		return this.attributes.get(name);
	}
	hasAttribute(name: string): boolean {
		return this.attributes.has(name);
	}
	addEventListener(type: string, listener: (evt: any) => void): void {
		const arr = this.listeners.get(type) ?? [];
		arr.push(listener);
		this.listeners.set(type, arr);
	}
	dispatchEvent(event: { type: string; [k: string]: any }): boolean {
		const arr = this.listeners.get(event.type) ?? [];
		for (const fn of arr) {
			fn(event);
		}
		return true;
	}
	focus(): void {}
	blur(): void {}
	onclick: ((evt?: any) => void) | null = null;
	click(): void {
		if (typeof this.onclick === 'function') {
			this.onclick({ type: 'click' });
		}
		this.dispatchEvent({ type: 'click' });
	}
	getContext(_type: string, _opts?: any): any {
		return {
			save() {},
			restore() {},
			clearRect() {},
			beginPath() {},
			arc() {},
			stroke() {},
			fill() {},
			moveTo() {},
			lineTo() {},
			quadraticCurveTo() {},
			fillText() {},
			measureText() { return { width: 40 }; },
			setLineDash() {},
		};
	}
}

suite('GraphAccessibility (Unit - Real HTML Markup & Keyboard Interaction)', () => {
	function getGeneratedHtmlTemplate(): string {
		const editorSource = readFileSync(new URL('../../host/workbench/graphEditor.ts', import.meta.url), 'utf8');
		const htmlStart = editorSource.indexOf('<!DOCTYPE html>');
		const htmlEnd = editorSource.indexOf('</script>', htmlStart) + '</script>'.length;
		assert.ok(htmlStart > 0 && htmlEnd > htmlStart, 'HTML template must be extractable from graphEditor.ts');
		return editorSource.slice(htmlStart, htmlEnd);
	}

	function parseTagAttributes(html: string, id: string): Map<string, string> {
		const regex = new RegExp(`<([a-zA-Z0-9]+)[^>]*id=["']${id}["'][^>]*>`, 'i');
		const match = html.match(regex);
		assert.ok(match, `Element with id "${id}" must exist in HTML template`);

		const fullTag = match[0];
		const attrs = new Map<string, string>();
		const attrRegex = /([a-zA-Z0-9_-]+)(?:=["']([^"']*)["'])?/g;
		let m: RegExpExecArray | null;
		while ((m = attrRegex.exec(fullTag)) !== null) {
			const name = m[1].toLowerCase();
			const val = m[2] !== undefined ? m[2] : 'true';
			attrs.set(name, val);
		}
		return attrs;
	}

	test('1. Real HTML Markup: netCanvas has role="region", correct roledescription, and updated shortcut help copy', () => {
		const html = getGeneratedHtmlTemplate();
		const attrs = parseTagAttributes(html, 'netCanvas');

		assert.strictEqual(attrs.get('role'), 'region', 'netCanvas must have role="region" rather than aggressive role="application"');
		assert.strictEqual(attrs.get('aria-roledescription'), 'interactive graph');
		assert.strictEqual(attrs.get('tabindex'), '0', 'netCanvas must be keyboard focusable (tabIndex="0")');
		assert.strictEqual(attrs.get('aria-describedby'), 'graphKbdHelp');

		const label = attrs.get('aria-label') || '';
		assert.ok(label.includes('Code Graph'), 'aria-label must describe Code Graph');
		assert.ok(label.includes('?'), 'aria-label must reference ? for shortcut help');
		assert.ok(!label.includes('Alt+F1') && !label.includes('Option+F1'), 'aria-label must preserve VS Code Accessibility Help shortcuts');
		assert.ok(!label.includes('press F1 for help'), 'aria-label must NOT contain stale "press F1 for help" copy');

		const liveRegion = parseTagAttributes(html, 'graphLiveRegion');
		assert.equal(liveRegion.get('role'), 'status');
		assert.equal(liveRegion.get('aria-live'), 'polite');

		const helpBtn = parseTagAttributes(html, 'graphHelpBtn');
		assert.ok(helpBtn.size, 'Code Graph must expose a visible help button');
		assert.ok((helpBtn.get('title') || '').includes('?'), 'help button tooltip must mention ?');
		assert.equal(helpBtn.get('aria-label'), 'Keyboard Shortcuts');
	});

	test('2. Real HTML Markup: Viewport toolbar buttons have explicit ARIA labels and toggle states', () => {
		const html = getGeneratedHtmlTemplate();

		// Center Lock button
		const centerLockAttrs = parseTagAttributes(html, 'temporalCenterLockBtn');
		assert.strictEqual(centerLockAttrs.get('aria-label'), 'Keep graph centered');
		assert.strictEqual(centerLockAttrs.get('aria-pressed'), 'false', 'Initial aria-pressed must be "false"');
		assert.ok(centerLockAttrs.has('title'), 'temporalCenterLockBtn must have title attribute');

		// Fit button
		const fitAttrs = parseTagAttributes(html, 'temporalFitBtn');
		assert.strictEqual(fitAttrs.get('aria-label'), 'Fit to screen');
		assert.ok(fitAttrs.has('title'), 'temporalFitBtn must have title attribute');

		// Toggle details button
		const detailsAttrs = parseTagAttributes(html, 'temporalToggleDetailsBtn');
		assert.strictEqual(detailsAttrs.get('aria-expanded'), 'false');
		assert.strictEqual(detailsAttrs.get('aria-controls'), 'temporalDetailsPanel');

		// Retry button
		const retryAttrs = parseTagAttributes(html, 'temporalRetryBtn');
		assert.strictEqual(retryAttrs.get('aria-label'), 'Retry');
	});

	test('3. Real HTML Markup: No raw improvised unicode close characters (✕ or ×)', () => {
		const html = getGeneratedHtmlTemplate();

		// popupClose must use SVG codicon
		const popupMatch = html.match(/<button[^>]*id=["']popupClose["'][^>]*>([\s\S]*?)<\/button>/i);
		assert.ok(popupMatch, 'popupClose button must exist in HTML');
		assert.ok(!popupMatch[1].includes('✕') && !popupMatch[1].includes('×'), 'popupClose must not use raw unicode ✕ or ×');
		assert.ok(popupMatch[1].includes('<svg'), 'popupClose must use SVG icon');

		// temporalDetailsClose must use SVG codicon
		const detailsCloseMatch = html.match(/<button[^>]*id=["']temporalDetailsClose["'][^>]*>([\s\S]*?)<\/button>/i);
		assert.ok(detailsCloseMatch, 'temporalDetailsClose button must exist in HTML');
		assert.ok(!detailsCloseMatch[1].includes('✕') && !detailsCloseMatch[1].includes('×'), 'temporalDetailsClose must not use raw unicode ✕ or ×');
		assert.ok(detailsCloseMatch[1].includes('<svg'), 'temporalDetailsClose must use SVG icon');

		const legendCloseMatch = html.match(/<button[^>]*id=["']legendCloseBtn["'][^>]*>([\s\S]*?)<\/button>/i);
		assert.ok(legendCloseMatch, 'legendCloseBtn must exist in the generated legend markup');
		assert.ok(!legendCloseMatch[1].includes('✕') && !legendCloseMatch[1].includes('×'), 'legend close must not use raw unicode ✕ or ×');
		assert.ok(legendCloseMatch[1].includes('<svg'), 'legend close must use SVG icon');
		assert.ok(!html.includes('>✕</button>'), 'no PreBase-owned close control may use a raw ✕ glyph');
	});

	test('4. Keyboard Interaction: F1 and Alt/Option+F1 pass through, ? toggles help, Escape closes panels', () => {
		const editorSource = readFileSync(new URL('../../host/workbench/graphEditor.ts', import.meta.url), 'utf8');
		const html = editorSource.slice(editorSource.indexOf('<script nonce="${nonce}">'));
		let script = html.match(/<script nonce="\$\{nonce\}">([\s\S]*?)<\/script>/)?.[1];
		assert.ok(script, 'webview script must be present in graphEditor.ts');
		script = interpolateWebviewScript(script, '42', 'temporal');

		const elements = new Map<string, FakeElement>();
		for (const id of [
			'archSvg', 'netCanvas', 'status', 'legend', 'empty', 'idleToggle', 'idleToggleWrap',
			'toolbar', 'temporalToolbar', 'temporalBreadcrumbTarget', 'temporalBreadcrumbBase', 'temporalRepoWrap', 'temporalRepoSelect', 'temporalScrubberBar', 'temporalRefSelect', 'temporalCompareSelect',
			'temporalFollowHead', 'temporalFilterInput', 'temporalScrubber', 'temporalPrevBtn', 'temporalNextBtn',
			'temporalPlayBtn', 'temporalCommitSha', 'temporalCommitMessage', 'temporalCommitAuthor', 'temporalCommitStatus',
			'temporalPartialWarning', 'badgeAdded', 'badgeRemoved', 'badgeModified', 'badgeRenamed',
			'temporalModeChangesBtn', 'temporalModeStateBtn', 'temporalContextModeWrap', 'temporalContextFocusedBtn', 'temporalContextFullBtn', 'temporalToggleDetailsBtn', 'temporalTimelineStrip', 'temporalLoadMoreBtn',
			'temporalFitBtn', 'temporalCenterLockBtn', 'temporalZoomInBtn', 'temporalZoomOutBtn', 'temporalResetBtn', 'temporalHelpBtn', 'temporalRetryBtn',
			'temporalDetailsPanel', 'temporalDetailsClose', 'temporalDetailsList', 'temporalDetailsSha', 'temporalDetailsAuthor', 'temporalDetailsParents', 'temporalDetailsSummary',
			'detailsCommitSha', 'detailsCommitMsg', 'detailsCommitAuthor', 'detailsCommitParents', 'detailsDeltaSummary', 'detailsEntityList',
			'popup', 'popupTitle', 'popupMeta', 'popupLayerBadge', 'popupChangeBadge', 'popupDetailsList', 'popupAiWrap', 'popupAi', 'popupAiProvenance',
			'popupClose', 'popupOpen', 'popupHistoricalView', 'popupSourceDiff', 'popupSetBase', 'popupReveal', 'popupMagnus', 'noChangesCard', 'noChangesViewSource',
			'graphLiveRegion', 'graphKbdHelp', 'graphHelpBtn', 'zoomIn', 'zoomOut', 'fit', 'centerLock', 'reset', 'temporalLegendBtn'
		]) {
			const el = new FakeElement();
			el.id = id;
			elements.set(id, el);
		}

		const activeElement: any = elements.get('netCanvas');
		const documentListeners = new Map<string, Array<(evt: any) => void>>();
		const windowListeners = new Map<string, Array<(evt: any) => void>>();

		const document = {
			body: new FakeElement(),
			documentElement: new FakeElement(),
			get activeElement() { return activeElement; },
			getElementById(id: string) {
				return elements.get(id) || new FakeElement();
			},
			createElement(_tag: string) {
				return new FakeElement();
			},
			addEventListener(type: string, listener: any) {
				const arr = documentListeners.get(type) ?? [];
				arr.push(listener);
				documentListeners.set(type, arr);
			},
			get hidden() { return false; },
		};

		const context = vm.createContext({
			acquireVsCodeApi: () => ({ postMessage() {} }),
			document,
			window: {
				devicePixelRatio: 1,
				innerWidth: 800,
				innerHeight: 600,
				addEventListener(type: string, listener: any) {
					const arr = windowListeners.get(type) ?? [];
					arr.push(listener);
					windowListeners.set(type, arr);
				},
				matchMedia: () => ({ matches: false, addEventListener() {} }),
			},
			console: { log() {}, warn() {}, error() {} },
			setTimeout: () => 1,
			clearTimeout: () => {},
			requestAnimationFrame: () => 1,
			cancelAnimationFrame: () => {},
		});

		vm.runInContext(script, context);

		function dispatchKey(key: string, modifiers: { altKey?: boolean; metaKey?: boolean; shiftKey?: boolean; ctrlKey?: boolean } = {}) {
			const keyListeners = [...(windowListeners.get('keydown') ?? []), ...(documentListeners.get('keydown') ?? [])];
			let prevented = false;
			const event = {
				type: 'keydown',
				key,
				altKey: !!modifiers.altKey,
				metaKey: !!modifiers.metaKey,
				shiftKey: !!modifiers.shiftKey,
				ctrlKey: !!modifiers.ctrlKey,
				preventDefault() { prevented = true; },
				stopPropagation() {},
			};
			for (const fn of keyListeners) {
				fn(event);
			}
			return { prevented };
		}

		// 1. Plain F1 must NOT be preventDefaulted
		const helpEl = elements.get('graphKbdHelp')!;
		helpEl.hidden = true;
		const f1Result = dispatchKey('F1');
		assert.strictEqual(f1Result.prevented, false, 'Plain F1 must pass through to VS Code');
		assert.strictEqual(helpEl.hidden, true);

		// 2. Alt/Option+F1 must pass through to VS Code Accessibility Help even if help is already open.
		helpEl.hidden = false;
		const altF1Result = dispatchKey('F1', { altKey: true });
		assert.strictEqual(altF1Result.prevented, false);
		assert.strictEqual(helpEl.hidden, false, 'Alt/Option+F1 must not toggle PreBase help');
		helpEl.hidden = true;
		const optionF1Result = dispatchKey('F1', { altKey: true });
		assert.strictEqual(optionF1Result.prevented, false);
		assert.strictEqual(helpEl.hidden, true, 'Alt+F1 does not hijack VS Code Accessibility Help');

		// 3. ? toggles local graph help.
		const questionResult = dispatchKey('?');
		assert.strictEqual(questionResult.prevented, true);
		assert.strictEqual(helpEl.hidden, false, '? opens local graph help');

		// 4. Escape closes help
		const escResult = dispatchKey('Escape');
		assert.strictEqual(escResult.prevented, true);
		assert.strictEqual(helpEl.hidden, true, 'Escape closes help');

		// 5. graphHelpBtn is the visible PreBase help control (not F1).
		const helpBtn = elements.get('graphHelpBtn')!;
		assert.equal(typeof helpBtn.onclick, 'function', 'graphHelpBtn must wire toggleGraphHelp');
		helpBtn.click();
		assert.strictEqual(helpEl.hidden, false, 'graphHelpBtn opens local graph help');
		helpBtn.click();
		assert.strictEqual(helpEl.hidden, true, 'graphHelpBtn toggles local graph help closed');

	});

	test('5. Narrow-viewport temporal zoom controls use display:none, not visually-hidden a11y duplicates', () => {
		const html = getGeneratedHtmlTemplate();
		const media = html.match(/@media \(max-width: 780px\) \{([\s\S]*?display:none !important;[\s\S]*?)\}/)?.[0];
		assert.ok(media, '780px breakpoint must exist for temporal viewport controls');
		assert.match(media, /#temporalViewportControls #temporalZoomInBtn/);
		assert.match(media, /#temporalViewportControls #temporalZoomOutBtn/);
		assert.match(media, /#temporalViewportControls #temporalResetBtn/);
		assert.match(media, /display:none !important/);
		assert.doesNotMatch(media, /visibility:\s*hidden|opacity:\s*0|clip(?:-path)?:|sr-only|visually-hidden/);
		assert.equal((html.match(/id="temporalZoomInBtn"/g) || []).length, 1, 'temporal zoom-in must exist once, not as a queryable duplicate');
		assert.equal((html.match(/id="temporalZoomOutBtn"/g) || []).length, 1, 'temporal zoom-out must exist once, not as a queryable duplicate');
		assert.equal((html.match(/id="zoomIn"/g) || []).length, 1, 'network zoom-in is a separate control, not a 780px duplicate');
	});

	test('6. Temporal camera preserves user pan/zoom; small graphs fit more tightly', () => {
		const html = getGeneratedHtmlTemplate();
		assert.match(html, /canFitTemporal && \(first \|\| !hasFittedTemporalView\) && !userAdjustedViewport/);
		assert.match(html, /keepGraphCentered && !userAdjustedViewport/);
		assert.match(html, /userAdjustedViewport = true/);
		assert.match(html, /function zoomByFactor\(factor\) \{[\s\S]{0,500}userAdjustedViewport = true/);
		assert.match(html, /case '\+':[\s\S]{0,80}zoomByFactor\(1\.25\)/);
		assert.match(html, /case '-':[\s\S]{0,80}zoomByFactor\(0\.8\)/);
		assert.match(html, /nodes\.length <= 10 \? 3\.2 : 2\.4/);
		assert.match(html, /isFocusMode && targetNodes\.length <= 4 \? 3\.2 : 2\.4/);
		assert.doesNotMatch(html, /isFocusMode[^;\n]*4\.2/, 'Temporal focus must not keep a leftover 4.2 zoom cap');
		assert.match(html, /No dependency edges were detected in this view/);
	});

	test('7. Maps/graph chrome uses vscode focus and button tokens, not a hardcoded teal', () => {
		const html = getGeneratedHtmlTemplate();
		assert.match(html, /outline:1px solid var\(--vscode-focusBorder/);
		assert.match(html, /#toolbar button\[aria-pressed="true"\] \{ color:var\(--vscode-button-background/);
		assert.match(html, /#temporalDisplayModeWrap button\.active \{ background:var\(--vscode-button-background/);
		assert.doesNotMatch(html, /outline:[^;]*#2dd4bf/, 'focus rings must not hardcode the teal hex');
		const maps = readFileSync(new URL('../../host/workbench/prebaseMapsView.ts', import.meta.url), 'utf8');
		assert.match(maps, /const ACCENT = 'var\(--vscode-focusBorder, var\(--vscode-button-background\)\)'/);
		assert.doesNotMatch(maps, /#2dd4bf/);
		const settings = readFileSync(new URL('../../../../src/vs/workbench/contrib/prebase/browser/prebaseSettingsEditor.ts', import.meta.url), 'utf8');
		assert.match(settings, /accent: 'var\(--vscode-focusBorder, var\(--vscode-button-background\)\)'/);
		assert.doesNotMatch(settings, /#2dd4bf/);
	});
});
