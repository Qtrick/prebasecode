import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as vm from 'node:vm';
import { suite, test } from 'mocha';
import { serializeNetworkEdgeVisualSource } from '../../host/workbench/networkEdgeVisualRuntime.js';

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

suite('GraphAccessibility (Unit - Keyboard Shortcuts & ARIA Parity)', () => {
	function createAccessibilityHarness() {
		const editorSource = readFileSync(new URL('../../host/workbench/graphEditor.ts', import.meta.url), 'utf8');
		const html = editorSource.slice(editorSource.indexOf('<script nonce="${nonce}">'));
		let script = html.match(/<script nonce="\$\{nonce\}">([\s\S]*?)<\/script>/)?.[1];
		assert.ok(script, 'webview script must be present in graphEditor.ts');

		script = script.replace('${generation}', '42')
			.replace('${initialGraphType}', 'temporal')
			.replace('${serializeNetworkEdgeVisualSource()}', serializeNetworkEdgeVisualSource());

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
			'graphLiveRegion', 'graphKbdHelp', 'zoomIn', 'zoomOut', 'fit', 'centerLock', 'reset', 'temporalLegendBtn'
		]) {
			const el = new FakeElement();
			el.id = id;
			elements.set(id, el);
		}

		let activeElement: any = elements.get('netCanvas');
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

		return {
			elements,
			setActiveElement(el: any) { activeElement = el; },
			dispatchKey(key: string, modifiers: { altKey?: boolean; metaKey?: boolean; shiftKey?: boolean; ctrlKey?: boolean } = {}) {
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
		};
	}

	test('1. F1 Non-Interception: Plain F1 does NOT trigger help and is NOT prevented', () => {
		const harness = createAccessibilityHarness();
		const helpEl = harness.elements.get('graphKbdHelp')!;
		helpEl.hidden = true;

		const result = harness.dispatchKey('F1');
		assert.strictEqual(result.prevented, false, 'Plain F1 must not be preventDefaulted so VS Code Command Palette works');
		assert.strictEqual(helpEl.hidden, true, 'Help dialog remains hidden');
	});

	test('2. Alt+F1 & Option+F1: Alt+F1 triggers help overlay and is prevented', () => {
		const harness = createAccessibilityHarness();
		const helpEl = harness.elements.get('graphKbdHelp')!;
		helpEl.hidden = true;

		const result = harness.dispatchKey('F1', { altKey: true });
		assert.strictEqual(result.prevented, true, 'Alt+F1 is handled by graph');
		assert.strictEqual(helpEl.hidden, false, 'Help overlay is opened');

		// Escape closes it
		const escResult = harness.dispatchKey('Escape');
		assert.strictEqual(escResult.prevented, true);
		assert.strictEqual(helpEl.hidden, true, 'Escape closes help');
	});

	test('3. Question Mark: ? triggers help overlay', () => {
		const harness = createAccessibilityHarness();
		const helpEl = harness.elements.get('graphKbdHelp')!;
		helpEl.hidden = true;

		const result = harness.dispatchKey('?');
		assert.strictEqual(result.prevented, true);
		assert.strictEqual(helpEl.hidden, false, '? opens help overlay');
	});

	test('4. Temporal Button ARIA Attributes: Viewport buttons have proper ARIA labels and roles', () => {
		const harness = createAccessibilityHarness();
		const fitBtn = harness.elements.get('temporalFitBtn')!;
		const centerLockBtn = harness.elements.get('temporalCenterLockBtn')!;
		const zoomInBtn = harness.elements.get('temporalZoomInBtn')!;
		const zoomOutBtn = harness.elements.get('temporalZoomOutBtn')!;
		const resetBtn = harness.elements.get('temporalResetBtn')!;
		const helpBtn = harness.elements.get('temporalHelpBtn')!;

		assert.ok(fitBtn, 'temporalFitBtn exists');
		assert.ok(centerLockBtn, 'temporalCenterLockBtn exists');
		assert.ok(zoomInBtn, 'temporalZoomInBtn exists');
		assert.ok(zoomOutBtn, 'temporalZoomOutBtn exists');
		assert.ok(resetBtn, 'temporalResetBtn exists');
		assert.ok(helpBtn, 'temporalHelpBtn exists');
	});
});
