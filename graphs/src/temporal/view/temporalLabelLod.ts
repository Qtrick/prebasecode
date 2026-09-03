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
	readonly labelCollisionCullCount: number;
	readonly renderedLabelOverlapCount: number;
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

/** Count overlapping pairs among labels that were actually rendered. */
export function countRenderedLabelOverlaps(boxes: readonly LabelBox[]): number {
	let overlaps = 0;
	for (let i = 0; i < boxes.length; i++) {
		for (let j = i + 1; j < boxes.length; j++) {
			if (boxesOverlap(boxes[i], boxes[j])) {
				overlaps++;
			}
		}
	}
	return overlaps;
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

		const minCandidateX = bounds.minX + pad;
		const maxCandidateX = Math.max(minCandidateX, bounds.maxX - badgeW - pad);
		const cardX = Math.min(maxCandidateX, minCandidateX);
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
		readonly currentFileEntityId?: string;
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
	const currentFileId = options?.currentFileEntityId;
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
		const isCurrentFile = Boolean(currentFileId && currentFileId === node.entityId);
		const isChanged = Boolean(node.changeKind && node.changeKind !== 'unchanged');
		const isEntry = Boolean(node.meta?.isEntry);
		const isQueryMatch = filterQuery && (
			(node.label && node.label.toLowerCase().includes(filterQuery)) ||
			(node.path && node.path.toLowerCase().includes(filterQuery))
		);

		let score = 0;
		if (isSelected) {
			score = 1000;
		} else if (isHovered) {
			score = 900;
		} else if (isCurrentFile) {
			score = 850;
		} else if (isQueryMatch) {
			score = 800;
		} else if (isChanged) {
			score = 600;
		} else if (isEntry) {
			score = 150;
		}

		if (zoom >= 1.25 && score > 0) {
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

	const cachedFontFamily = (typeof document !== 'undefined' && document.body && typeof getComputedStyle === 'function')
		? (getComputedStyle(document.body).fontFamily || 'sans-serif')
		: 'sans-serif';
	const fontNormal = `10px ${cachedFontFamily}`;
	const fontEmphasis = `bold 11px ${cachedFontFamily}`;

	for (let i = 0; i < scored.length; i++) {
		if (visibleLabels.length >= maxLabels) {
			break;
		}

		const item = scored[i];
		const node = item.node;

		const isEmphasis = item.isSelected || item.isHovered;
		const font = isEmphasis ? fontEmphasis : fontNormal;

		const text = node.label || (node.path ? node.path.split('/').pop() || node.path : node.entityId);
		const textWidth = measureWidth(text, font);
		const r = item.isChanged ? 7.0 : 4.0;
		const labelY = (node.y || 0) + r + 10;
		const boxTop = labelY - 7;
		const boxHeight = 14;
		const boxWidth = textWidth + 6;

		const box: LabelBox = {
			x: (node.x || 0) - boxWidth / 2,
			y: boxTop,
			w: boxWidth,
			h: boxHeight,
		};

		// Selected/hovered claim occupancy normally — they win by rank, not by bypassing collision.
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
		visibleLabels.push({
			entityId: node.entityId,
			text,
			x: node.x || 0,
			y: labelY,
			box,
			font,
			isSelected: item.isSelected,
			isHovered: item.isHovered,
			isChanged: item.isChanged,
		});
	}

	return visibleLabels;
}

export function computeVisibleRouteBadges(
	candidates: readonly AggregateRouteBadgeCandidate[],
	zoom: number,
	placedBoxes: LabelBox[],
	options?: {
		readonly maxBadges?: number;
		readonly overlapCount?: { count: number };
	},
): RouteBadgeLabelItem[] {
	if (!candidates || candidates.length === 0 || zoom < 0.38) {
		return [];
	}

	const maxBadges = options?.maxBadges ?? 32;
	const out: RouteBadgeLabelItem[] = [];
	const sorted = candidates.slice().sort(function (a, b) {
		const aChanged = a.changedEdgeCount > 0 ? 1 : 0;
		const bChanged = b.changedEdgeCount > 0 ? 1 : 0;
		if (bChanged !== aChanged) {
			return bChanged - aChanged;
		}
		if (b.edgeCount !== a.edgeCount) {
			return b.edgeCount - a.edgeCount;
		}
		return a.id.localeCompare(b.id);
	});

	const badgeW = Math.max(16, Math.round(18 / Math.max(0.38, zoom)));
	const badgeH = Math.max(10, Math.round(12 / Math.max(0.38, zoom)));

	for (let i = 0; i < sorted.length; i++) {
		if (out.length >= maxBadges) {
			break;
		}
		const candidate = sorted[i];
		const curBox: LabelBox = {
			x: candidate.x - badgeW / 2,
			y: candidate.y - badgeH / 2,
			w: badgeW,
			h: badgeH,
		};

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
			isChanged: candidate.changedEdgeCount > 0,
			box: curBox,
			font: '',
		});
	}

	return out;
}

type UnifiedLabelCandidate =
	| {
		readonly kind: 'node';
		readonly rank: number;
		readonly secondaryRank: number;
		readonly tiebreaker: string;
		readonly box: LabelBox;
		readonly item: VisibleLabelItem;
	}
	| {
		readonly kind: 'guide';
		readonly rank: number;
		readonly secondaryRank: number;
		readonly tiebreaker: string;
		readonly box: LabelBox;
		readonly item: CommunityGuideLabelItem;
	}
	| {
		readonly kind: 'routeBadge';
		readonly rank: number;
		readonly secondaryRank: number;
		readonly tiebreaker: string;
		readonly box: LabelBox;
		readonly item: RouteBadgeLabelItem;
	};

function defaultMeasureWidth(text: string): number {
	return text.length * 7.0;
}

export function computeTemporalLabelLayout(
	nodes: readonly TemporalRenderNode[],
	guides: readonly TemporalCommunityGuideInput[],
	zoom: number,
	options?: {
		readonly selectedNodeId?: string;
		readonly hoveredNodeId?: string;
		readonly currentFileEntityId?: string;
		readonly filterQuery?: string;
		readonly maxNodeLabels?: number;
		readonly maxGuideLabels?: number;
		readonly maxRouteBadges?: number;
		readonly maxTotalLabels?: number;
		readonly measureWidth?: (text: string, font: string) => number;
		readonly visibleNodeIds?: ReadonlySet<string>;
		readonly representedGuideIds?: ReadonlySet<string>;
		readonly routeBadgeCandidates?: readonly AggregateRouteBadgeCandidate[];
	},
): TemporalLabelLayout {
	const measureWidth = options?.measureWidth;
	const filterQuery = (options?.filterQuery || '').toLowerCase().trim();
	const currentFileId = options?.currentFileEntityId;

	// 1. Collect Guide Landmark Candidates
	// Gate at MIN_ZOOM (0.15): large Full Map Fit clamps to minZoom and must still show
	// community landmarks. A higher gate (e.g. 0.18) created a Fit-only false red where
	// overview aggregates drew but communityLabelsDrawn stayed 0.
	const guideCandidates: UnifiedLabelCandidate[] = [];
	const visibleNodeIds = options?.visibleNodeIds;
	const representedGuideIds = options?.representedGuideIds;
	if (zoom >= 0.15 && guides && guides.length > 0) {
		const validGuides = [];
		for (let i = 0; i < guides.length; i++) {
			const g = guides[i];
			if (g && g.bounds && g.label) {
				let visibleMembers = g.nodeCount ?? g.nodeIds?.length ?? 0;
				if (visibleNodeIds && g.nodeIds?.length) {
					let count = 0;
					for (let n = 0; n < g.nodeIds.length; n++) {
						if (visibleNodeIds.has(g.nodeIds[n]!)) {
							count++;
						}
					}
					visibleMembers = count;
				}
				if (visibleMembers <= 0) {
					if (representedGuideIds?.has(g.id)) {
						visibleMembers = g.nodeCount ?? g.nodeIds?.length ?? 1;
					} else if (zoom < 0.5 && representedGuideIds) {
						continue;
					} else if (zoom < 0.5 && visibleNodeIds) {
						continue;
					}
				}
				validGuides.push(g);
			}
		}
		if (validGuides.length > 0) {
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
			const measureWidthFn = measureWidth || defaultMeasureWidth;

			for (let i = 0; i < validGuides.length; i++) {
				const guide = validGuides[i];
				const bounds = guide.bounds!;
				const gw = Math.max(8, bounds.maxX - bounds.minX);

				const text = shortenCommunityLabel(guide.label!, 24);
				const count = guide.nodeCount ?? guide.nodeIds?.length ?? 0;
				const layerStr = String(guide.layerId || 'module').toUpperCase();
				const subText = safeZoom < 0.35
					? `${count} files`
					: `${count} files · ${layerStr}`;

				const titleW = measureWidthFn(text, font);
				const subW = measureWidthFn(subText, subFont);
				const pad = Math.max(4, Math.round(8 / Math.max(0.35, safeZoom)));
				const badgeW = Math.min(Math.max(20, gw - pad * 2), Math.max(titleW, subW) + Math.round(24 / Math.max(0.35, safeZoom)));
				const badgeH = Math.round(worldFontPx + subWorldFontPx + 8 / Math.max(0.35, safeZoom));

				const minCandidateX = bounds.minX + pad;
				const maxCandidateX = Math.max(minCandidateX, bounds.maxX - badgeW - pad);
				const cardX = Math.min(maxCandidateX, minCandidateX);
				const cardY = bounds.minY + pad;

				const box: LabelBox = {
					x: cardX,
					y: cardY,
					w: badgeW,
					h: badgeH,
				};

				const w = (bounds.maxX - bounds.minX);
				const h = (bounds.maxY - bounds.minY);
				const area = Math.max(1, w * h);
				const score = count * 1000 + area;

				guideCandidates.push({
					kind: 'guide',
					rank: 350, // landmark after changed/search; before ordinary routes/files
					secondaryRank: score,
					tiebreaker: guide.id,
					box,
					item: {
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
					},
				});
			}
		}
	}

	// 2. Collect Route Badge Candidates
	const routeBadgeCandidates: UnifiedLabelCandidate[] = [];
	const rawRouteBadges = options?.routeBadgeCandidates;
	if (rawRouteBadges && rawRouteBadges.length > 0 && zoom >= 0.38) {
		const badgeW = Math.max(16, Math.round(18 / Math.max(0.38, zoom)));
		const badgeH = Math.max(10, Math.round(12 / Math.max(0.38, zoom)));

		for (let i = 0; i < rawRouteBadges.length; i++) {
			const cand = rawRouteBadges[i];
			const isChanged = cand.changedEdgeCount > 0;
			const curBox: LabelBox = {
				x: cand.x - badgeW / 2,
				y: cand.y - badgeH / 2,
				w: badgeW,
				h: badgeH,
			};

			routeBadgeCandidates.push({
				kind: 'routeBadge',
				rank: isChanged ? 550 : 200, // changed routes beat guides; ordinary routes yield
				secondaryRank: cand.edgeCount,
				tiebreaker: cand.id,
				box: curBox,
				item: {
					id: cand.id,
					text: cand.text,
					x: cand.x,
					y: cand.y,
					isChanged,
					box: curBox,
					font: '',
				},
			});
		}
	}

	// 3. Collect Node Label Candidates
	const nodeCandidates: UnifiedLabelCandidate[] = [];
	if (nodes && nodes.length > 0) {
		const family = (typeof document !== 'undefined' && document.body && typeof getComputedStyle === 'function')
			? (getComputedStyle(document.body).fontFamily || 'sans-serif')
			: 'sans-serif';

		const safeZoom = Math.max(0.001, Number.isFinite(zoom) ? zoom : 1);
		const fontNormal = `${Math.round(10 / safeZoom)}px ${family}`;
		const fontEmphasis = `bold ${Math.round(11 / safeZoom)}px ${family}`;
		const measureWidthFn = measureWidth || defaultMeasureWidth;

		for (let i = 0; i < nodes.length; i++) {
			const node = nodes[i];
			const isSelected = Boolean(options?.selectedNodeId && node.entityId === options.selectedNodeId);
			const isHovered = Boolean(options?.hoveredNodeId && node.entityId === options.hoveredNodeId);
			const isCurrentFile = Boolean(currentFileId && node.entityId === currentFileId);
			const isQueryMatch = Boolean(filterQuery && (
				(node.label && node.label.toLowerCase().includes(filterQuery)) ||
				(node.path && node.path.toLowerCase().includes(filterQuery))
			));
			const isChanged = Boolean(node.changeKind && node.changeKind !== 'unchanged');
			const isEntry = Boolean(node.meta?.isEntry);

			if (zoom < 0.25) {
				if (!isSelected && !isHovered && !isCurrentFile && !isQueryMatch && !isChanged) {
					continue;
				}
			} else if (zoom < 0.45) {
				const degree = Number(node.meta?.['degree'] ?? 0);
				if (!isSelected && !isHovered && !isCurrentFile && !isQueryMatch && !isChanged && degree < 2) {
					continue;
				}
			}

			let rank = 100;
			if (isSelected) {
				rank = 1000;
			} else if (isHovered) {
				rank = 900;
			} else if (isCurrentFile) {
				rank = 850;
			} else if (isQueryMatch) {
				rank = 800;
			} else if (isChanged) {
				rank = 600;
			} else if (isEntry) {
				rank = 150;
			}

			const isEmphasis = isSelected || isHovered;
			const font = isEmphasis ? fontEmphasis : fontNormal;
			const text = node.label || (node.path ? node.path.split('/').pop() || node.path : node.entityId);
			const textWidth = measureWidthFn(text, font);
			const r = isChanged ? 7.0 : 4.0;
			const labelY = (node.y || 0) + r + 10;
			const boxTop = labelY - 7;
			const boxHeight = 14;
			const boxWidth = textWidth + 6;

			const box: LabelBox = {
				x: (node.x || 0) - boxWidth / 2,
				y: boxTop,
				w: boxWidth,
				h: boxHeight,
			};

			nodeCandidates.push({
				kind: 'node',
				rank,
				secondaryRank: (isEntry ? 50 : 0) + Number(node.meta?.['degree'] ?? 0),
				tiebreaker: node.entityId,
				box,
				item: {
					entityId: node.entityId,
					text,
					x: node.x || 0,
					y: labelY,
					box,
					font,
					isSelected,
					isHovered,
					isChanged,
				},
			});
		}
	}

	// 4. Unified Priority Ranking
	const allCandidates: UnifiedLabelCandidate[] = [
		...guideCandidates,
		...routeBadgeCandidates,
		...nodeCandidates,
	];

	allCandidates.sort(function (a, b) {
		if (b.rank !== a.rank) {
			return b.rank - a.rank;
		}
		if (b.secondaryRank !== a.secondaryRank) {
			return b.secondaryRank - a.secondaryRank;
		}
		return a.tiebreaker.localeCompare(b.tiebreaker);
	});

	// 5. Shared Single-Pass Occupancy Placement — higher rank claims first; zero visible overlap.
	const placedBoxes: LabelBox[] = [];
	const nodeLabels: VisibleLabelItem[] = [];
	const guideLabels: CommunityGuideLabelItem[] = [];
	const routeBadges: RouteBadgeLabelItem[] = [];
	let labelCollisionCullCount = 0;

	const maxNodeLabels = options?.maxNodeLabels ?? (zoom < 0.35 ? 20 : (zoom < 0.65 ? 64 : 100));
	const maxGuideLabels = options?.maxGuideLabels ?? (zoom < 0.35 ? 8 : (zoom < 0.65 ? 14 : 24));
	const maxBadges = options?.maxRouteBadges ?? (zoom < 0.35 ? 8 : 32);
	// Global visual budget so guide+node+badge caps cannot explode density.
	const globalBudget = options?.maxTotalLabels ?? (zoom < 0.35 ? 48 : (zoom < 0.65 ? 96 : 140));
	let placedTotal = 0;

	for (let i = 0; i < allCandidates.length; i++) {
		const cand = allCandidates[i];

		if (placedTotal >= globalBudget) {
			labelCollisionCullCount++;
			continue;
		}
		if (cand.kind === 'node' && maxNodeLabels && nodeLabels.length >= maxNodeLabels) {
			labelCollisionCullCount++;
			continue;
		}
		if (cand.kind === 'guide' && guideLabels.length >= maxGuideLabels) {
			labelCollisionCullCount++;
			continue;
		}
		if (cand.kind === 'routeBadge' && routeBadges.length >= maxBadges) {
			labelCollisionCullCount++;
			continue;
		}

		let collision = false;
		for (let b = 0; b < placedBoxes.length; b++) {
			if (boxesOverlap(cand.box, placedBoxes[b])) {
				collision = true;
				break;
			}
		}
		if (collision) {
			labelCollisionCullCount++;
			continue;
		}

		placedBoxes.push(cand.box);
		placedTotal++;
		if (cand.kind === 'node') {
			nodeLabels.push(cand.item);
		} else if (cand.kind === 'guide') {
			guideLabels.push(cand.item);
		} else if (cand.kind === 'routeBadge') {
			routeBadges.push(cand.item);
		}
	}

	const renderedBoxes: LabelBox[] = [];
	for (let gi = 0; gi < guideLabels.length; gi++) {
		renderedBoxes.push(guideLabels[gi].box);
	}
	for (let ri = 0; ri < routeBadges.length; ri++) {
		renderedBoxes.push(routeBadges[ri].box);
	}
	for (let ni = 0; ni < nodeLabels.length; ni++) {
		renderedBoxes.push(nodeLabels[ni].box);
	}
	const renderedLabelOverlapCount = countRenderedLabelOverlaps(renderedBoxes);

	return {
		nodeLabels,
		guideLabels,
		routeBadges,
		labelCollisionCullCount,
		renderedLabelOverlapCount,
		compositeLabelOverlapCount: labelCollisionCullCount + renderedLabelOverlapCount,
	};
}
