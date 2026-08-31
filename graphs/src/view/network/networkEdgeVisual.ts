/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * Authoritative semantic contract for Network Graph edge rendering.
 *
 * `resolveNetworkEdgeVisual` is the single source of truth consumed by BOTH:
 * - the typed render strategy (`NetworkEdgeRenderStrategy.evaluate`) and its tests
 * - the production sandboxed webview, via serialized injection
 *   (`serializeNetworkEdgeVisualSource()` in `host/workbench/networkEdgeVisualRuntime.ts`)
 *
 * IMPORTANT: keep the body of `resolveNetworkEdgeVisual` fully self-contained (parameters,
 * local variables and literals only — no references to other module symbols). The webview
 * injection serializes the function with `Function.prototype.toString()`, which is only
 * portable when the closure references nothing from the surrounding module scope.
 * To change edge visuals, change them HERE so both consumers move together.
 */

export interface EdgeLike {
	readonly id?: string;
	readonly source: string;
	readonly target: string;
	readonly kind?: string;
	readonly meta?: {
		readonly isDynamic?: boolean;
		readonly isEntryRelated?: boolean;
		readonly isEntry?: boolean;
	};
}

export interface EdgeVisualDescriptor {
	readonly color: string;
	readonly width: number;
	readonly alpha: number;
	readonly dash: readonly number[];
	readonly priority: number;
	showArrow: boolean;
}

/** Settings value whose multiplier maps to 1.0 (historical default opacity). */
export const EDGE_OPACITY_BASELINE = 0.55;

/** Draw-order priorities shared by the strategy evaluation and the webview painter. */
export const NETWORK_EDGE_PRIORITY = {
	dimmed: 0,
	import: 3,
	reference: 2,
	entry: 9,
	dynamic: 8,
	dependency: 10,
	highlighted: 100,
};

export function computeEdgeOpacityScale(opacitySetting: number | undefined | null): number {
	if (typeof opacitySetting === 'number' && Number.isFinite(opacitySetting) && opacitySetting >= 0) {
		return opacitySetting / 0.55;
	}
	return 1.0;
}

/**
 * Pure webview descriptor resolver. Identical inputs MUST produce identical outputs from
 * the strategy wrapper and the injected runtime copy (enforced by parity tests).
 */
export function resolveNetworkEdgeVisual(
	edge: EdgeLike,
	isConnectedToHighlight: boolean,
	activeHighlightId: string | null | undefined,
	zoom: number,
	opacitySetting: number | undefined | null,
	entryNodeId?: string | null,
): EdgeVisualDescriptor | null {
	let opacityScale = 1.0;
	if (typeof opacitySetting === 'number' && Number.isFinite(opacitySetting) && opacitySetting >= 0) {
		opacityScale = opacitySetting / 0.55;
	}
	const cap = function (v: number): number { return Math.min(1, Math.max(0, v)); };

	if (isConnectedToHighlight) {
		return {
			color: '#2dd4bf',
			width: Math.max(1.8, 2.2 / zoom),
			alpha: 1.0,
			dash: Boolean(edge.meta && edge.meta.isDynamic) ? [4, 4] : [],
			priority: 100,
			showArrow: zoom >= 0.7,
		};
	}

	if (activeHighlightId) {
		return {
			color: 'rgba(148, 163, 184, 0.05)',
			width: 0.6 / zoom,
			alpha: cap(0.05 * opacityScale),
			dash: [],
			priority: 0,
			showArrow: false,
		};
	}

	const isIncidentToEntry = Boolean(entryNodeId && (edge.source === entryNodeId || edge.target === entryNodeId));
	const meta = edge.meta || {};
	const kind = edge.kind || 'import';

	if (kind === 'contains') {
		if (zoom < 0.8) {return null;}
		return {
			color: 'rgba(100, 116, 139, 0.25)',
			width: 0.75 / zoom,
			alpha: cap(0.35 * opacityScale),
			dash: [2, 3],
			priority: 3,
			showArrow: false,
		};
	}

	if (kind === 'dependency') {
		return {
			color: 'rgba(167, 139, 250, 0.55)',
			width: 1.35 / zoom,
			alpha: cap(0.6 * opacityScale),
			dash: [],
			priority: 10,
			showArrow: zoom >= 1.2,
		};
	}

	if (isIncidentToEntry || meta.isEntryRelated || meta.isEntry) {
		return {
			color: 'rgba(245, 158, 11, 0.65)',
			width: 1.3 / zoom,
			alpha: cap(0.75 * opacityScale),
			dash: [],
			priority: 9,
			showArrow: zoom >= 0.9,
		};
	}

	if (meta.isDynamic) {
		if (zoom < 0.45) {return null;}
		return {
			color: 'rgba(244, 114, 182, 0.6)',
			width: 1.1 / zoom,
			alpha: cap(0.65 * opacityScale),
			dash: [4, 4],
			priority: 8,
			showArrow: zoom >= 0.9,
		};
	}

	if (kind === 'reference' || kind === 'export') {
		if (zoom < 0.6) {return null;}
		return {
			color: 'rgba(148, 163, 184, 0.32)',
			width: 0.8 / zoom,
			alpha: cap(0.4 * opacityScale),
			dash: [],
			priority: 2,
			showArrow: false,
		};
	}

	// Default standard import
	if (zoom < 0.38) {return null;}
	return {
		color: 'rgba(148, 163, 184, 0.22)',
		width: 0.85 / zoom,
		alpha: cap(0.35 * opacityScale),
		dash: [],
		priority: 3,
		showArrow: zoom >= 1.3,
	};
}
