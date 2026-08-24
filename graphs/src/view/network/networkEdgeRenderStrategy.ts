/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { GraphEdge, GraphNode } from '../../common/types/graphTypes.js';

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
	readonly edgeOpacityMultiplier?: number;
}

export class NetworkEdgeRenderStrategy {
	/**
	 * Resolves a pure, theme-aware render descriptor for a single graph edge.
	 */
	static evaluate(edge: GraphEdge, context: NetworkEdgeEvaluationContext): NetworkEdgeRenderDescriptor {
		const zoom = context.zoom;
		const activeId = context.activeHighlightNodeId;
		const entryId = context.entryNodeId;
		const isHighContrast = Boolean(context.theme?.isHighContrast);
		const opacityMultiplier = typeof context.edgeOpacityMultiplier === 'number' && Number.isFinite(context.edgeOpacityMultiplier)
			? context.edgeOpacityMultiplier
			: 1.0;

		const isIncidentToHighlight = Boolean(activeId && (edge.source === activeId || edge.target === activeId));
		const isIncidentToEntry = Boolean(entryId && (edge.source === entryId || edge.target === entryId));
		const isDynamic = Boolean(edge.meta?.isDynamic);
		const edgeKind = (edge.kind || 'import').toLowerCase();

		// Priority and Highlight State Determination
		if (isIncidentToHighlight) {
			const accentColor = context.theme?.accent || '#2dd4bf';
			return {
				variant: 'highlighted',
				strokeStyle: accentColor,
				lineWidth: Math.max(1.8, 2.2 / zoom),
				alpha: 1.0,
				dash: isDynamic ? [4, 4] : [],
				curvature: 0,
				hasArrow: zoom >= 0.8,
				priority: 3,
				visibleAtLOD: true,
			};
		}

		// When another node is highlighted, non-incident edges are dimmed
		if (activeId) {
			const dimmedAlpha = isHighContrast ? 0.08 : 0.04;
			return {
				variant: 'dimmed',
				strokeStyle: isHighContrast ? 'rgba(255, 255, 255, 0.08)' : 'rgba(148, 163, 184, 0.05)',
				lineWidth: 0.6 / zoom,
				alpha: dimmedAlpha,
				dash: [],
				curvature: 0,
				hasArrow: false,
				priority: 0,
				visibleAtLOD: true,
			};
		}

		// 1. CONTAINS (Structural file/folder tree relation)
		if (edgeKind === 'contains') {
			const visible = zoom >= 0.9;
			return {
				variant: 'contains',
				strokeStyle: isHighContrast ? 'rgba(255, 255, 255, 0.3)' : 'rgba(100, 116, 139, 0.18)',
				lineWidth: 0.7 / zoom,
				alpha: visible ? Math.min(1.0, 0.25 * opacityMultiplier) : 0,
				dash: [2, 3],
				curvature: 0,
				hasArrow: false,
				priority: 0,
				visibleAtLOD: visible,
			};
		}

		// 2. DEPENDENCY (Aggregate folder/package/community link)
		if (edgeKind === 'dependency') {
			// Aggregate edges are specially highlighted at overview/macro zoom
			const baseAlpha = zoom < 0.6 ? 0.65 : (zoom < 1.2 ? 0.45 : 0.25);
			return {
				variant: 'dependency',
				strokeStyle: isHighContrast ? 'rgba(167, 139, 250, 0.8)' : 'rgba(167, 139, 250, 0.55)',
				lineWidth: zoom < 0.6 ? 1.6 / zoom : 1.1 / zoom,
				alpha: Math.min(1.0, baseAlpha * opacityMultiplier),
				dash: [],
				curvature: 0.05,
				hasArrow: zoom >= 0.7,
				priority: 2,
				visibleAtLOD: true,
			};
		}

		// 3. ENTRY-RELATED (Edges connected to application root)
		if (isIncidentToEntry) {
			const baseAlpha = zoom < 0.5 ? 0.8 : 0.6;
			return {
				variant: 'entry',
				strokeStyle: isHighContrast ? '#f59e0b' : 'rgba(245, 158, 11, 0.65)',
				lineWidth: 1.4 / zoom,
				alpha: Math.min(1.0, baseAlpha * opacityMultiplier),
				dash: [],
				curvature: 0,
				hasArrow: zoom >= 0.7,
				priority: 2,
				visibleAtLOD: true,
			};
		}

		// 4. DYNAMIC IMPORT
		if (isDynamic) {
			const visible = zoom >= 0.45;
			const baseAlpha = zoom >= 0.8 ? 0.7 : 0.45;
			return {
				variant: 'dynamic',
				strokeStyle: isHighContrast ? '#f472b6' : 'rgba(244, 114, 182, 0.6)',
				lineWidth: 1.1 / zoom,
				alpha: visible ? Math.min(1.0, baseAlpha * opacityMultiplier) : 0,
				dash: [4, 4],
				curvature: 0,
				hasArrow: zoom >= 0.85,
				priority: 2,
				visibleAtLOD: visible,
			};
		}

		// 5. REFERENCE / EXPORT
		if (edgeKind === 'reference' || edgeKind === 'export') {
			const visible = zoom >= 0.7;
			return {
				variant: edgeKind === 'reference' ? 'reference' : 'export',
				strokeStyle: isHighContrast ? 'rgba(203, 213, 225, 0.5)' : 'rgba(148, 163, 184, 0.35)',
				lineWidth: 0.8 / zoom,
				alpha: visible ? Math.min(1.0, 0.4 * opacityMultiplier) : 0,
				dash: edgeKind === 'export' ? [5, 2] : [],
				curvature: 0,
				hasArrow: zoom >= 1.0,
				priority: 1,
				visibleAtLOD: visible,
			};
		}

		// 6. STANDARD IMPORT (Default source dependency)
		// Semantic Zoom LOD: Suppress individual raw imports at extreme macro view to avoid spaghetti
		const visibleAtLOD = zoom >= 0.38;
		const baseAlpha = zoom < 0.6 ? 0.18 : (zoom < 1.1 ? 0.32 : 0.48);

		return {
			variant: 'import',
			strokeStyle: isHighContrast ? 'rgba(255, 255, 255, 0.4)' : 'rgba(148, 163, 184, 0.3)',
			lineWidth: 0.85 / zoom,
			alpha: visibleAtLOD ? Math.min(1.0, baseAlpha * opacityMultiplier) : 0,
			dash: [],
			curvature: 0,
			hasArrow: zoom >= 1.1,
			priority: 1,
			visibleAtLOD,
		};
	}
}
