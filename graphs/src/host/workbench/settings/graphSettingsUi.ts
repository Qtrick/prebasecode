/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../../../nls.js';
import type { IDisposable } from '../../../../../../../base/common/lifecycle.js';
import { PreBaseGraphConfigKeys } from '../../../common/configuration/graphConfigKeys.js';
import { NETWORK_LAYOUT_OPTIONS, type NetworkLayoutMode } from '../../../layouts/network/index.js';

/** Languages surfaced in PreBase Settings → About (graph analysis coverage). */
export const GRAPH_SUPPORTED_LANGUAGES: ReadonlyArray<{ name: string; extensions: string }> = [
	{ name: 'TypeScript', extensions: '.ts .tsx .mts .cts' },
	{ name: 'JavaScript', extensions: '.js .jsx .mjs .cjs' },
	{ name: 'Java', extensions: '.java' },
	{ name: 'Kotlin', extensions: '.kt .kts' },
	{ name: 'Python', extensions: '.py' },
	{ name: 'Go', extensions: '.go' },
	{ name: 'Rust', extensions: '.rs' },
	{ name: 'C#', extensions: '.cs' },
	{ name: 'C / C++', extensions: '.c .cpp .cc .cxx .h .hpp' },
	{ name: 'Swift', extensions: '.swift' },
	{ name: 'PHP', extensions: '.php' },
	{ name: 'Ruby', extensions: '.rb' },
];

/**
 * Narrow host bridge for the generic PreBase Settings editor.
 * Graph-owned panels render through this; shell keeps nav/cards/persistence helpers.
 */
export interface IPreBaseGraphSettingsUiHost {
	readonly main: HTMLElement;
	readonly advanced: HTMLElement;
	readonly category: string;
	readonly colors: {
		border: string;
		textMuted: string;
		accent: string;
	};
	get<T>(key: string, fallback: T): T;
	set(key: string, value: unknown): Promise<void>;
	track(disposable: IDisposable): void;
	on(el: HTMLElement, type: string, listener: () => void): void;
	panel(parent: HTMLElement, title: string, description?: string): HTMLElement;
	row(parent: HTMLElement, label: string, hint: string | undefined, control: HTMLElement): void;
	selectStyle(el: HTMLSelectElement): void;
	inputStyle(el: HTMLInputElement): void;
	accentCheckbox(): HTMLInputElement;
	range(min: number, max: number, step: number, value: number): HTMLInputElement;
	btn(label: string, primary?: boolean): HTMLButtonElement;
	sessionLayoutMode(): string;
	/** @deprecated Architecture layout setter — Code Graph uses network layout keys. */
	setLayoutMode(mode: string): Promise<void>;
	relayout(): Promise<void>;
}

export function renderGraphReduceMotionRow(host: IPreBaseGraphSettingsUiHost, card: HTMLElement): void {
	const reduce = host.accentCheckbox();
	reduce.checked = host.get(PreBaseGraphConfigKeys.GraphReduceMotion, false);
	host.on(reduce, 'change', () => void host.set(PreBaseGraphConfigKeys.GraphReduceMotion, reduce.checked));
	host.row(card, localize('prebase.settings.reduceMotion', "Reduce motion"), localize('prebase.settings.reduceMotionHint', "Minimizes graph and UI animations."), reduce);
}

export function renderGraphCategory(host: IPreBaseGraphSettingsUiHost): void {
	const card = host.panel(
		host.main,
		localize('prebase.settings.graph.title', "Graph"),
		localize('prebase.settings.graph.desc', "Code Graph layout and display.")
	);

	const layout = document.createElement('select');
	host.selectStyle(layout);
	for (const m of NETWORK_LAYOUT_OPTIONS) {
		const opt = document.createElement('option');
		opt.value = m.id;
		opt.textContent = m.label;
		layout.appendChild(opt);
	}
	layout.value = host.get(PreBaseGraphConfigKeys.GraphNetworkLayoutMode, 'community');
	host.on(layout, 'change', () => {
		void (async () => {
			await host.set(PreBaseGraphConfigKeys.GraphNetworkLayoutMode, layout.value as NetworkLayoutMode);
			await host.relayout();
		})();
	});
	host.row(card, localize('prebase.settings.defaultLayout', "Default layout"), localize('prebase.settings.defaultLayoutHint', "Code Graph arrangement (Community Force, Organic, Sphere, …)."), layout);

	const session = document.createElement('span');
	// Live snapshot mode (not the saved default) — match NETWORK_LAYOUT_OPTIONS labels.
	const sessionModeId = host.sessionLayoutMode() || host.get(PreBaseGraphConfigKeys.GraphNetworkLayoutMode, 'community');
	const sessionOpt = NETWORK_LAYOUT_OPTIONS.find(m => m.id === sessionModeId);
	session.textContent = sessionOpt?.label || sessionModeId;
	Object.assign(session.style, { fontSize: '12px', color: host.colors.accent });
	host.row(card, localize('prebase.settings.sessionLayout', "Session layout"), localize('prebase.settings.sessionLayoutHint', "Active Code Graph layout for the current project."), session);

	const zoom = host.range(0.5, 1.4, 0.02, host.get(PreBaseGraphConfigKeys.GraphInitialZoom, 0.92));
	host.on(zoom, 'input', () => void host.set(PreBaseGraphConfigKeys.GraphInitialZoom, Number(zoom.value)));
	host.row(card, localize('prebase.settings.initialZoom', "Initial zoom"), localize('prebase.settings.initialZoomHint', "Camera zoom when a project first loads."), zoom);

	// ponytail: showEdgeLabels + legendInteractionDim stay registered (included:false) — do not surface no-op controls.
}

/** Graph canvas interaction controls (terminal visibility stays in the Settings shell). */
export function renderGraphInteractionControls(host: IPreBaseGraphSettingsUiHost): void {
	const card = host.panel(
		host.main,
		localize('prebase.settings.interaction.title', "Interaction"),
		localize('prebase.settings.interaction.desc', "Code Graph drag behavior.")
	);

	const drag = document.createElement('select');
	host.selectStyle(drag);
	for (const [v, label] of [['natural', 'Natural'], ['inverted', 'Inverted']] as const) {
		const opt = document.createElement('option');
		opt.value = v;
		opt.textContent = label;
		drag.appendChild(opt);
	}
	drag.value = host.get(PreBaseGraphConfigKeys.InteractionNetworkDragDirection, 'natural');
	host.on(drag, 'change', () => void host.set(PreBaseGraphConfigKeys.InteractionNetworkDragDirection, drag.value));
	host.row(
		card,
		localize('prebase.settings.networkDrag', "Code Graph drag direction"),
		localize('prebase.settings.networkDragHint', "Natural follows cursor drag like grabbing the sphere; Inverted rotates opposite to cursor."),
		drag
	);
}

export function renderGraphPerformanceCategory(host: IPreBaseGraphSettingsUiHost): void {
	const card = host.panel(
		host.main,
		localize('prebase.settings.performance.title', "Performance"),
		localize('prebase.settings.performance.desc', "Rendering quality and graph limits.")
	);

	const quality = document.createElement('select');
	host.selectStyle(quality);
	for (const [v, label] of [['balanced', 'Balanced'], ['performance', 'Performance']] as const) {
		const opt = document.createElement('option');
		opt.value = v;
		opt.textContent = label;
		quality.appendChild(opt);
	}
	const q = host.get<string>(PreBaseGraphConfigKeys.GraphQuality, 'balanced');
	quality.value = (q === 'performance') ? 'performance' : 'balanced';
	host.on(quality, 'change', () => void host.set(PreBaseGraphConfigKeys.GraphQuality, quality.value));
	host.row(card, localize('prebase.settings.graphQuality', "Graph quality"), localize('prebase.settings.graphQualityHint', "Performance mode reduces edge animation."), quality);
}

export function renderGraphAdvanced(host: IPreBaseGraphSettingsUiHost): void {
	const card = document.createElement('div');
	host.advanced.appendChild(card);
	Object.assign(card.style, {
		borderRadius: '12px',
		border: `1px solid ${host.colors.border}`,
		background: 'rgba(17, 24, 39, 0.35)',
		padding: '0 16px',
	});
	const head = document.createElement('div');
	card.appendChild(head);
	Object.assign(head.style, { padding: '12px 0', borderBottom: `1px solid rgba(30, 41, 59, 0.6)`, marginBottom: '4px' });
	const h = document.createElement('h3');
	head.appendChild(h);
	h.textContent = localize('prebase.settings.advanced', "Advanced");
	Object.assign(h.style, { margin: '0', fontSize: '13px', fontWeight: '600' });
	const d = document.createElement('p');
	head.appendChild(d);
	d.textContent = host.category === 'graph'
		? localize('prebase.settings.advancedGraphHint', "Layout changes apply after relayout.")
		: localize('prebase.settings.advancedHint', "Fine-tuned controls for this category.");
	Object.assign(d.style, { margin: '2px 0 0', fontSize: '11px', color: host.colors.textMuted });

	if (host.category === 'graph') {
		// Phase E: architecture-only layer/scatter advanced controls removed from Settings UI
		// (keys remain registered/readable for migration).
		advNumber(host, card, localize('prebase.settings.layoutAnim', "Layout animation"), localize('prebase.settings.layoutAnimHint', "Fit-view duration in milliseconds."), PreBaseGraphConfigKeys.GraphLayoutAnimationDuration, 750, 0, 2000, 50);
		advRange(host, card, localize('prebase.settings.visibleRelated', "Visible related connections"), localize('prebase.settings.visibleRelatedHint', "Root link always shown; controls extra ranked links per file (0–2)."), PreBaseGraphConfigKeys.GraphVisibleRelatedConnections, 1, 0, 2, 1, true);

		const autoRotate = host.accentCheckbox();
		autoRotate.checked = host.get(PreBaseGraphConfigKeys.GraphNetworkIdleAutoRotate, false);
		host.on(autoRotate, 'change', () => void host.set(PreBaseGraphConfigKeys.GraphNetworkIdleAutoRotate, autoRotate.checked));
		host.row(card, localize('prebase.settings.autoRotate', "Auto-rotate when idle"), localize('prebase.settings.autoRotateHint', "Slowly rotates the Code Graph when you are not interacting."), autoRotate);

		// ponytail: physics/edgeOpacity reserved keys stay registered (included:false) — do not surface no-op sliders.

		const applyRow = document.createElement('div');
		card.appendChild(applyRow);
		Object.assign(applyRow.style, { padding: '12px 0' });
		const apply = host.btn(localize('prebase.settings.applyLayout', "Apply layout now"), true);
		host.on(apply, 'click', () => { void host.relayout(); });
		applyRow.appendChild(apply);
	}

	if (host.category === 'performance') {
		advNumber(host, card, localize('prebase.settings.maxNodes', "Max rendered nodes"), localize('prebase.settings.maxNodesHint', "Caps visible nodes by importance."), PreBaseGraphConfigKeys.GraphMaxRenderedNodes, 280, 50, 2000, 50);
	}
}

function advNumber(
	host: IPreBaseGraphSettingsUiHost,
	parent: HTMLElement,
	label: string,
	hint: string,
	key: string,
	fallback: number,
	min: number,
	max: number,
	step: number,
): void {
	const input = document.createElement('input');
	input.type = 'number';
	input.min = String(min);
	input.max = String(max);
	input.step = String(step);
	host.inputStyle(input);
	input.value = String(host.get(key, fallback));
	host.on(input, 'change', () => {
		const n = Number(input.value);
		void host.set(key, Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback);
	});
	host.row(parent, label, hint, input);
}

function advRange(
	host: IPreBaseGraphSettingsUiHost,
	parent: HTMLElement,
	label: string,
	hint: string,
	key: string,
	fallback: number,
	min: number,
	max: number,
	step: number,
	showValue = false,
): void {
	const wrap = document.createElement('div');
	Object.assign(wrap.style, { display: 'flex', alignItems: 'center', gap: '8px' });
	const value = host.get(key, fallback);
	const range = host.range(min, max, step, value);
	const valEl = document.createElement('span');
	valEl.textContent = showValue ? String(Number(Number(value).toFixed(2))) : '';
	Object.assign(valEl.style, { fontSize: '10px', color: host.colors.textMuted, width: showValue ? '28px' : '0', textAlign: 'right' });
	host.on(range, 'input', () => {
		const n = Number(range.value);
		if (showValue) {
			valEl.textContent = String(Number(n.toFixed(2)));
		}
		void host.set(key, n);
	});
	wrap.appendChild(range);
	if (showValue) {
		wrap.appendChild(valEl);
	}
	host.row(parent, label, hint, wrap);
}
