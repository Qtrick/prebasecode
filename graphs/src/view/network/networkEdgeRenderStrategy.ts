/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { GraphEdge, GraphNode } from '../../common/types/graphTypes.js';
import { NETWORK_EDGE_PRIORITY, resolveNetworkEdgeVisual } from './networkEdgeVisual.js';

export type NetworkEdgeVisualVariant =
	| 'contains'
	| 'dependency'
	| 'import'
	| 'dynamic'
	| 'reference'
	| 'export'
	| 'entry'
	| 'highlighted'
	| 'dimmed';

export interface NetworkEdgeRenderDescriptor {
	readonly variant: NetworkEdgeVisualVariant;
	readonly strokeStyle: string;
	readonly lineWidth: number;
	readonly alpha: number;
	readonly dash: readonly number[];
	readonly curvature: number;
	readonly hasArrow: boolean;
	readonly priority: number;
	readonly visibleAtLOD: boolean;
}

export interface NetworkEdgeThemeTokens {
	readonly accent?: string;
	readonly highlight?: string;
	readonly secondary?: string;
	readonly muted?: string;
	readonly border?: string;
	readonly isDark?: boolean;
	readonly isHighContrast?: boolean;
}

export interface NetworkEdgeEvaluationContext {
	readonly zoom: number;
	readonly activeHighlightNodeId?: string | null;
	readonly entryNodeId?: string | null;
	readonly theme?: NetworkEdgeThemeTokens;
	readonly sourceNode?: GraphNode | null;
	readonly targetNode?: GraphNode | null;
	/** Raw `prebase.graph.networkEdgeOpacity` settings value; baseline 0.55 maps to 1.0. */
	readonly edgeOpacitySetting?: number | undefined | null;
}

/**
 * Typed wrapper around the authoritative pure resolver (`resolveNetworkEdgeVisual`).
 *
 * The webview consumes the SAME resolver through serialized injection
 * (`serializeNetworkEdgeVisualSource`), so semantics cannot drift between tested
 * strategy code and production rendering; this layer only adds variant naming,
 * High-Contrast token substitution and LOD visibility classification.
 */
export class NetworkEdgeRenderStrategy {
	static evaluate(edge: GraphEdge, context: NetworkEdgeEvaluationContext): NetworkEdgeRenderDescriptor {
		const zoom = context.zoom;
		const activeId = context.activeHighlightNodeId;
		const entryId = context.entryNodeId;
		const isHighContrast = Boolean(context.theme?.isHighContrast);

		const isIncidentToHighlight = Boolean(activeId && (edge.source === activeId || edge.target === activeId));
		const isIncidentToEntry = Boolean(entryId && (edge.source === entryId || edge.target === entryId));
		const isDynamic = Boolean(edge.meta?.isDynamic);
		const edgeKind = (edge.kind || 'import').toLowerCase();

		if (isIncidentToHighlight) {
			// Delegate to the authoritative resolver so LOD thresholds, widths and
			// arrow behavior can never drift from the injected webview copy; only
			// the theme accent substitution is layered on top.
			const base = resolveNetworkEdgeVisual(edge, true, activeId, zoom, context.edgeOpacitySetting);
			return {
				variant: 'highlighted',
				strokeStyle: context.theme?.accent || (base ? base.color : '#2dd4bf'),
				lineWidth: base ? base.width : Math.max(1.8, 2.2 / zoom),
				alpha: base ? base.alpha : 1.0,
				dash: isDynamic ? [4, 4] : [],
				curvature: 0,
				hasArrow: base ? base.showArrow : zoom >= 0.7,
				priority: NETWORK_EDGE_PRIORITY.highlighted,
				visibleAtLOD: true,
			};
		}

		// When another node is highlighted, non-incident edges are dimmed
		if (activeId) {
			const base = resolveNetworkEdgeVisual(edge, false, activeId, zoom, context.edgeOpacitySetting);
			return {
				variant: 'dimmed',
				strokeStyle: isHighContrast ? 'rgba(255, 255, 255, 0.08)' : (base ? base.color : 'rgba(148, 163, 184, 0.05)'),
				lineWidth: base ? base.width : 0.6 / zoom,
				alpha: isHighContrast ? 0.08 : (base ? base.alpha : 0.05),
				dash: [],
				curvature: 0,
				hasArrow: false,
				priority: NETWORK_EDGE_PRIORITY.dimmed,
				visibleAtLOD: true,
			};
		}

		const base = resolveNetworkEdgeVisual(edge, false, null, zoom, context.edgeOpacitySetting, entryId);
		if (!base) {
			// LOD-hidden: nothing is drawn, but the descriptor keeps the variant's
			// true semantic pattern (probed at a visible zoom) so consumers can
			// reason about what this edge represents.
			const probe = resolveNetworkEdgeVisual(edge, false, null, 1.0, context.edgeOpacitySetting, entryId);
			return {
				variant: edgeKind === 'contains' ? 'contains' : (probe && probe.dash.length ? 'dynamic' : 'import'),
				strokeStyle: 'rgba(0, 0, 0, 0)',
				lineWidth: 0,
				alpha: 0,
				dash: probe ? [...probe.dash] : [],
				curvature: 0,
				hasArrow: false,
				priority: 0,
				visibleAtLOD: false,
			};
		}

		let variant: NetworkEdgeVisualVariant;
		if (edgeKind === 'contains') {variant = 'contains';}
		else if (edgeKind === 'dependency') {variant = 'dependency';}
		else if (edgeKind === 'reference') {variant = 'reference';}
		else if (edgeKind === 'export') {variant = 'export';}
		else if (isDynamic) {variant = 'dynamic';}
		// GraphEdge.meta has no entry flags; entry emphasis is derived from
		// context.entryNodeId via the shared resolver.
		else if (isIncidentToEntry) {variant = 'entry';}
		else {variant = 'import';}

		return {
			variant,
			strokeStyle: base.color,
			lineWidth: base.width,
			alpha: base.alpha,
			dash: base.dash,
			curvature: 0,
			hasArrow: base.showArrow,
			priority: base.priority,
			visibleAtLOD: true,
		};
	}
}
