/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { TemporalRenderNode } from './temporalViewTypes.js';

export interface LabelBox {
	readonly x: number;
	readonly y: number;
	readonly w: number;
	readonly h: number;
}

export interface VisibleLabelItem {
	readonly entityId: string;
	readonly text: string;
	readonly x: number;
	readonly y: number;
	readonly box: LabelBox;
	readonly isSelected: boolean;
	readonly isHovered: boolean;
	readonly isChanged: boolean;
	readonly font: string;
}

export interface CommunityGuideLabelItem {
	readonly guideId: string;
	readonly text: string;
	readonly x: number;
	readonly y: number;
	readonly box: LabelBox;
	readonly font: string;
}

export interface TemporalLabelLayout {
	readonly nodeLabels: readonly VisibleLabelItem[];
	readonly guideLabels: readonly CommunityGuideLabelItem[];
	readonly labelOverlapCount: number;
}

export interface TemporalCommunityGuideInput {
	readonly id: string;
	readonly label?: string;
	readonly bounds?: {
		readonly minX: number;
		readonly minY: number;
		readonly maxX: number;
		readonly maxY: number;
	};
	readonly nodeCount?: number;
	readonly nodeIds?: readonly string[];
}

export function boxesOverlap(a: LabelBox, b: LabelBox): boolean {
	return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Deterministic shortening for hierarchical community names (metadata preserved in full label elsewhere). */
export function shortenCommunityLabel(label: string, maxLen = 28): string {
	const trimmed = label.trim();
	if (trimmed.length <= maxLen) {
		return trimmed;
	}
	const parts = trimmed.split(/\s*[·•|/]\s*/).map(function (part) { return part.trim(); }).filter(Boolean);
	if (parts.length > 1) {
		const leaf = parts[parts.length - 1];
		if (leaf.length <= maxLen) {
			return leaf;
		}
	}
	if (trimmed.length <= maxLen + 4) {
		return trimmed;
	}
	const head = Math.max(8, Math.floor(maxLen * 0.45));
	const tail = Math.max(6, maxLen - head - 1);
	return `${trimmed.slice(0, head)}…${trimmed.slice(-tail)}`;
}

export function computeVisibleCommunityGuideLabels(
	guides: readonly TemporalCommunityGuideInput[],
	zoom: number,
	placedBoxes: LabelBox[],
	options?: {
		readonly maxLabels?: number;
		readonly measureWidth?: (text: string, font: string) => number;
		readonly visibleNodeIds?: ReadonlySet<string>;
		readonly overlapCount?: { count: number };
	},
): CommunityGuideLabelItem[] {
	if (!guides.length || zoom < 0.18) {
		return [];
	}
	const maxLabels = options?.maxLabels ?? (zoom < 0.35 ? 6 : zoom < 0.65 ? 12 : 24);
	const measureWidth = options?.measureWidth || function (text: string) { return text.length * 6.8; };
	const visibleNodeIds = options?.visibleNodeIds;

	interface ScoredGuide {
		readonly guide: TemporalCommunityGuideInput;
		readonly score: number;
	}

	const scored: ScoredGuide[] = [];
	for (let i = 0; i < guides.length; i++) {
		const guide = guides[i];
		if (!guide.label || !guide.bounds) {
			continue;
		}
		let visibleMembers = guide.nodeCount ?? guide.nodeIds?.length ?? 0;
		if (visibleNodeIds && guide.nodeIds?.length) {
			let count = 0;
			for (let n = 0; n < guide.nodeIds.length; n++) {
				if (visibleNodeIds.has(guide.nodeIds[n])) {
					count++;
				}
			}
			visibleMembers = count;
		}
		if (visibleMembers <= 0 && zoom < 0.5) {
			continue;
		}
		const score = visibleMembers * 10 + (guide.nodeCount ?? 0);
		scored.push({ guide, score });
	}
	scored.sort(function (a, b) {
		if (b.score !== a.score) {
			return b.score - a.score;
		}
		return (a.guide.id || '').localeCompare(b.guide.id || '');
	});

	const family = (typeof document !== 'undefined' && document.body && typeof getComputedStyle === 'function')
		? (getComputedStyle(document.body).fontFamily || 'sans-serif')
		: 'sans-serif';

	const out: CommunityGuideLabelItem[] = [];
	for (let i = 0; i < scored.length && out.length < maxLabels; i++) {
		const guide = scored[i].guide;
		const bounds = guide.bounds!;
		const text = shortenCommunityLabel(guide.label!);
		const font = `600 ${zoom < 0.45 ? 10 : 11}px ${family}`;
		const textW = measureWidth(text, font);
		const box: LabelBox = {
			x: bounds.minX + 4,
			y: bounds.minY - 16,
			w: textW + 8,
			h: 14,
		};
		let collision = false;
		for (let b = 0; b < placedBoxes.length; b++) {
			if (boxesOverlap(box, placedBoxes[b])) {
				collision = true;
				break;
			}
		}
		if (collision) {
			if (options?.overlapCount) {
				options.overlapCount.count++;
			}
			continue;
		}
		placedBoxes.push(box);
		out.push({
			guideId: guide.id,
			text,
			x: bounds.minX + 6,
			y: bounds.minY - 4,
			box,
			font,
		});
	}
	return out;
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
		readonly occupancySeed?: LabelBox[];
		readonly overlapCount?: { count: number };
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

	scored.sort(function (a, b) {
		if (b.score !== a.score) return b.score - a.score;
		return a.node.entityId.localeCompare(b.node.entityId);
	});

	const visibleLabels: VisibleLabelItem[] = [];
	const placedBoxes: LabelBox[] = options?.occupancySeed ? [...options.occupancySeed] : [];

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

		if (!item.isSelected && !item.isHovered) {
			let collision = false;
			for (let b = 0; b < placedBoxes.length; b++) {
				if (boxesOverlap(curBox, placedBoxes[b])) {
					collision = true;
					break;
				}
			}
			if (collision) {
				if (options?.overlapCount) {
					options.overlapCount.count++;
				}
				continue;
			}
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

export function computeTemporalLabelLayout(
	nodes: readonly TemporalRenderNode[],
	guides: readonly TemporalCommunityGuideInput[],
	zoom: number,
	options?: {
		readonly selectedNodeId?: string;
		readonly hoveredNodeId?: string;
		readonly filterQuery?: string;
		readonly maxNodeLabels?: number;
		readonly maxGuideLabels?: number;
		readonly measureWidth?: (text: string, font: string) => number;
		readonly visibleNodeIds?: ReadonlySet<string>;
	},
): TemporalLabelLayout {
	const measureWidth = options?.measureWidth;
	const placedBoxes: LabelBox[] = [];
	const overlapCount = { count: 0 };
	const guideLabels = computeVisibleCommunityGuideLabels(guides, zoom, placedBoxes, {
		maxLabels: options?.maxGuideLabels,
		measureWidth,
		visibleNodeIds: options?.visibleNodeIds,
		overlapCount,
	});
	const nodeLabels = computeVisibleLabels(nodes, zoom, {
		selectedNodeId: options?.selectedNodeId,
		hoveredNodeId: options?.hoveredNodeId,
		filterQuery: options?.filterQuery,
		maxLabels: options?.maxNodeLabels,
		measureWidth,
		occupancySeed: placedBoxes,
		overlapCount,
	});
	return {
		nodeLabels,
		guideLabels,
		labelOverlapCount: overlapCount.count,
	};
}
