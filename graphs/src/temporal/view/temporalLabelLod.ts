/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
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
	readonly subText?: string;
	readonly layerId?: string;
	readonly color?: string;
	readonly x: number;
	readonly y: number;
	readonly box: LabelBox;
	readonly font: string;
	readonly subFont?: string;
	readonly isCard: boolean;
	readonly badgeWidth: number;
	readonly badgeHeight: number;
}

export interface AggregateRouteBadgeCandidate {
	readonly id: string;
	readonly text: string;
	readonly x: number;
	readonly y: number;
	readonly edgeCount: number;
	readonly changedEdgeCount: number;
}

export interface RouteBadgeLabelItem {
	readonly id: string;
	readonly text: string;
	readonly x: number;
	readonly y: number;
	readonly box: LabelBox;
	readonly font: string;
	readonly isChanged: boolean;
}

export interface TemporalLabelLayout {
	readonly nodeLabels: readonly VisibleLabelItem[];
	readonly guideLabels: readonly CommunityGuideLabelItem[];
	readonly routeBadges: readonly RouteBadgeLabelItem[];
	readonly labelOverlapCount: number;
	readonly compositeLabelOverlapCount: number;
}

export interface TemporalCommunityGuideInput {
	readonly id: string;
	readonly label?: string;
	readonly layerId?: string;
	readonly color?: string;
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
		readonly representedGuideIds?: ReadonlySet<string>;
		readonly overlapCount?: { count: number };
	},
): CommunityGuideLabelItem[] {
	if (!guides.length || zoom < 0.15) {
		return [];
	}
	const maxLabels = options?.maxLabels ?? (zoom < 0.35 ? 8 : zoom < 0.65 ? 14 : 24);
	const measureWidth = options?.measureWidth || function (text: string) { return text.length * 7.0; };
	const visibleNodeIds = options?.visibleNodeIds;
	const representedGuideIds = options?.representedGuideIds;

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
		if (visibleMembers <= 0) {
			if (representedGuideIds?.has(guide.id)) {
				visibleMembers = guide.nodeCount ?? guide.nodeIds?.length ?? 1;
			} else if (zoom < 0.5) {
				continue;
			}
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

	const safeZoom = Math.max(0.001, Number.isFinite(zoom) ? zoom : 1);
	const screenFontPx = safeZoom < 0.35 ? 11 : (safeZoom < 0.65 ? 12 : 11);
	const worldFontPx = Math.max(10, Math.round(screenFontPx / safeZoom));
	const subScreenFontPx = safeZoom < 0.35 ? 8.5 : 9.5;
	const subWorldFontPx = Math.max(8, Math.round(subScreenFontPx / safeZoom));

	const font = `600 ${worldFontPx}px ${family}`;
	const subFont = `400 ${subWorldFontPx}px ${family}`;

	const out: CommunityGuideLabelItem[] = [];
	for (let i = 0; i < scored.length && out.length < maxLabels; i++) {
		const guide = scored[i].guide;
		const bounds = guide.bounds!;
		const gw = Math.max(8, bounds.maxX - bounds.minX);

		const text = shortenCommunityLabel(guide.label!, 24);
		const count = guide.nodeCount ?? guide.nodeIds?.length ?? 0;
		const layerStr = String(guide.layerId || 'module').toUpperCase();
		const subText = safeZoom < 0.35
			? `${count} files`
			: `${count} files · ${layerStr}`;

		const titleW = measureWidth(text, font);
		const subW = measureWidth(subText, subFont);
		const pad = Math.max(4, Math.round(8 / Math.max(0.35, safeZoom)));
		const badgeW = Math.min(Math.max(20, gw - pad * 2), Math.max(titleW, subW) + Math.round(24 / Math.max(0.35, safeZoom)));
		const badgeH = Math.round(worldFontPx + subWorldFontPx + 8 / Math.max(0.35, safeZoom));

		const cardX = bounds.minX + pad;
		const cardY = bounds.minY + pad;

		const box: LabelBox = {
			x: cardX,
			y: cardY,
			w: badgeW,
			h: badgeH,
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
			subText,
			layerId: guide.layerId,
			color: guide.color,
			x: cardX,
			y: cardY,
			box,
			font,
			subFont,
			isCard: true,
			badgeWidth: badgeW,
			badgeHeight: badgeH,
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
		if (isSelected) {score += 1000;}
		if (isHovered) {score += 900;}
		if (isChanged) {score += 500;}
		if (isEntry) {score += 300;}

		const isQueryMatch = filterQuery && (
			(node.label && node.label.toLowerCase().includes(filterQuery)) ||
			(node.path && node.path.toLowerCase().includes(filterQuery))
		);
		if (isQueryMatch) {score += 400;}

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
		if (b.score !== a.score) {return b.score - a.score;}
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
		if (!labelText) {continue;}

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

/** Ranked aggregate route count badges sharing the same occupancy grid as file/guide labels. */
export function computeVisibleRouteBadges(
	candidates: readonly AggregateRouteBadgeCandidate[],
	zoom: number,
	placedBoxes: LabelBox[],
	options?: {
		readonly maxBadges?: number;
		readonly minZoom?: number;
		readonly overlapCount?: { count: number };
	},
): RouteBadgeLabelItem[] {
	const minZoom = options?.minZoom ?? 0.38;
	if (!candidates.length || zoom < minZoom) {
		return [];
	}
	const safeZoom = Math.max(0.001, Number.isFinite(zoom) ? zoom : 1);
	const maxBadges = options?.maxBadges ?? (safeZoom < 0.45 ? 6 : safeZoom < 0.65 ? 10 : 16);
	const badgeW = 18 / safeZoom;
	const badgeH = 12 / safeZoom;
	const family = (typeof document !== 'undefined' && document.body && typeof getComputedStyle === 'function')
		? (getComputedStyle(document.body).fontFamily || 'sans-serif')
		: 'sans-serif';
	const font = `600 ${Math.max(8, Math.round(9 / safeZoom))}px ${family}`;

	interface ScoredRoute {
		readonly candidate: AggregateRouteBadgeCandidate;
		readonly score: number;
	}

	const scored: ScoredRoute[] = [];
	for (let i = 0; i < candidates.length; i++) {
		const candidate = candidates[i];
		if (!candidate.text || !Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) {
			continue;
		}
		const score = (candidate.changedEdgeCount > 0 ? 10000 : 0)
			+ candidate.edgeCount * 10
			+ Math.log2(1 + candidate.edgeCount);
		scored.push({ candidate, score });
	}
	scored.sort(function (a, b) {
		if (b.score !== a.score) {
			return b.score - a.score;
		}
		return (a.candidate.id || '').localeCompare(b.candidate.id || '');
	});

	const out: RouteBadgeLabelItem[] = [];
	for (let i = 0; i < scored.length && out.length < maxBadges; i++) {
		const candidate = scored[i].candidate;
		const boxLeft = candidate.x - badgeW / 2;
		const boxTop = candidate.y - badgeH / 2;
		const curBox = { x: boxLeft, y: boxTop, w: badgeW, h: badgeH };
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
		placedBoxes.push(curBox);
		out.push({
			id: candidate.id,
			text: candidate.text,
			x: candidate.x,
			y: candidate.y,
			box: curBox,
			font,
			isChanged: candidate.changedEdgeCount > 0,
		});
	}
	return out;
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
		readonly representedGuideIds?: ReadonlySet<string>;
		readonly routeBadgeCandidates?: readonly AggregateRouteBadgeCandidate[];
	},
): TemporalLabelLayout {
	const measureWidth = options?.measureWidth;
	const placedBoxes: LabelBox[] = [];
	const overlapCount = { count: 0 };
	const guideLabels = computeVisibleCommunityGuideLabels(guides, zoom, placedBoxes, {
		maxLabels: options?.maxGuideLabels,
		measureWidth,
		visibleNodeIds: options?.visibleNodeIds,
		representedGuideIds: options?.representedGuideIds,
		overlapCount,
	});
	const routeBadges = computeVisibleRouteBadges(options?.routeBadgeCandidates || [], zoom, placedBoxes, {
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
		routeBadges,
		labelOverlapCount: overlapCount.count,
		compositeLabelOverlapCount: overlapCount.count,
	};
}
