/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * Architecture Graph screen-space hit testing helpers.
 * Keep in sync with the webview pickArchitectureNode / architectureHitRadiusScreen in graphEditor.ts.
 *
 * Hit radius is computed in CSS pixels (screen space), then converted to world via `/ zoom`.
 * Do not use a fixed world-space radius (Network-style) — that shrinks the clickable target when zoomed out.
 */

export const ARCH_NODE_W = 28;
export const ARCH_NODE_H = 28;
/** Minimum hit radius in CSS pixels (screen space). */
export const ARCH_MIN_HIT_PX = 10;

export function architectureHitRadiusScreen(zoom: number, minPx: number = ARCH_MIN_HIT_PX): number {
	const k = Math.max(0.001, zoom);
	const visual = Math.hypot(ARCH_NODE_W / 2, ARCH_NODE_H / 2) * k;
	return Math.max(minPx, visual + 4);
}

export interface ArchPickNode {
	readonly id: string;
	readonly x: number;
	readonly y: number;
}

/**
 * Pick closest node whose center is within screen-space hit radius.
 * `wx`/`wy` are graph-world coordinates (after undoing pan/zoom).
 */
export function pickArchitectureNodeAt(
	wx: number,
	wy: number,
	nodes: readonly ArchPickNode[],
	zoom: number,
	minHitPx: number = ARCH_MIN_HIT_PX
): ArchPickNode | null {
	const k = Math.max(0.001, zoom);
	const hitWorld = architectureHitRadiusScreen(k, minHitPx) / k;
	let best: ArchPickNode | null = null;
	let bestDist = Infinity;
	for (const node of nodes) {
		const cx = node.x + ARCH_NODE_W / 2;
		const cy = node.y + ARCH_NODE_H / 2;
		const d = Math.hypot(wx - cx, wy - cy);
		if (d <= hitWorld && (d < bestDist || (d === bestDist && best !== null && node.id < best.id))) {
			bestDist = d;
			best = node;
		}
	}
	return best;
}
