/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { TemporalRenderNode } from './temporalViewTypes.js';

export interface VisibleLabelItem {
	readonly entityId: string;
	readonly text: string;
	readonly x: number;
	readonly y: number;
	readonly box: {
		readonly x: number;
		readonly y: number;
		readonly w: number;
		readonly h: number;
	};
	readonly isSelected: boolean;
	readonly isHovered: boolean;
	readonly isChanged: boolean;
	readonly font: string;
}

export function computeVisibleLabels(
	nodes: readonly TemporalRenderNode[],
	zoom: number,
	options?: {
		readonly selectedNodeId?: string;
		readonly hoveredNodeId?: string;
		readonly filterQuery?: string;
		readonly maxLabels?: number;
		readonly measureWidth?: (text: string, font: string) => number;
	},
): VisibleLabelItem[] {
	if (!nodes || nodes.length === 0) {
		return [];
	}

	const selectedId = options?.selectedNodeId;
	const hoveredId = options?.hoveredNodeId;
	const filterQuery = (options?.filterQuery || '').toLowerCase().trim();
	const maxLabels = options?.maxLabels ?? 150;
	const measureWidth = options?.measureWidth || function (text: string): number {
		return text.length * 6.5;
	};

	interface ScoredNode {
		readonly node: TemporalRenderNode;
		readonly score: number;
		readonly isSelected: boolean;
		readonly isHovered: boolean;
		readonly isChanged: boolean;
	}

	const scored: ScoredNode[] = [];

	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i];
		const isSelected = selectedId === node.entityId;
		const isHovered = hoveredId === node.entityId;
		const isChanged = Boolean(node.changeKind && node.changeKind !== 'unchanged');
		const isEntry = Boolean(node.meta?.isEntry);

		let score = 0;
		if (isSelected) score += 1000;
		if (isHovered) score += 900;
		if (isChanged) score += 500;
		if (isEntry) score += 300;

		const isQueryMatch = filterQuery && (
			(node.label && node.label.toLowerCase().includes(filterQuery)) ||
			(node.path && node.path.toLowerCase().includes(filterQuery))
		);
		if (isQueryMatch) score += 400;

		if (zoom >= 1.25) {
			score += 100;
		}

		if (score > 0) {
			scored.push({
				node,
				score,
				isSelected,
				isHovered,
				isChanged,
			});
		}
	}

	// Sort highest priority first
	scored.sort(function (a, b) {
		if (b.score !== a.score) return b.score - a.score;
		return a.node.entityId.localeCompare(b.node.entityId);
	});

	const visibleLabels: VisibleLabelItem[] = [];
	const placedBoxes: { x: number; y: number; w: number; h: number }[] = [];

	const family = (typeof document !== 'undefined' && document.body && typeof getComputedStyle === 'function')
		? (getComputedStyle(document.body).fontFamily || 'sans-serif')
		: 'sans-serif';

	for (let i = 0; i < scored.length && visibleLabels.length < maxLabels; i++) {
		const item = scored[i];
		const node = item.node;
		const labelText = node.label || node.path || '';
		if (!labelText) continue;

		const font = (item.isSelected || item.isHovered)
			? `bold 11px ${family}`
			: `10px ${family}`;

		const textW = measureWidth(labelText, font);
		const r = item.isChanged ? 7.0 : 4.0;
		const labelY = (node.y || 0) + r + 10;
		const boxW = textW + 6;
		const boxH = 14;
		const boxLeft = (node.x || 0) - boxW / 2;
		const boxTop = labelY - 7;

		const curBox = { x: boxLeft, y: boxTop, w: boxW, h: boxH };

		// Selected and Hovered nodes bypass collision culling
		if (!item.isSelected && !item.isHovered) {
			let collision = false;
			for (let b = 0; b < placedBoxes.length; b++) {
				const pb = placedBoxes[b];
				if (curBox.x < pb.x + pb.w && curBox.x + curBox.w > pb.x &&
					curBox.y < pb.y + pb.h && curBox.y + curBox.h > pb.y) {
					collision = true;
					break;
				}
			}
			if (collision) continue;
		}

		placedBoxes.push(curBox);
		visibleLabels.push({
			entityId: node.entityId,
			text: labelText,
			x: node.x || 0,
			y: labelY,
			box: curBox,
			isSelected: item.isSelected,
			isHovered: item.isHovered,
			isChanged: item.isChanged,
			font,
		});
	}

	return visibleLabels;
}
