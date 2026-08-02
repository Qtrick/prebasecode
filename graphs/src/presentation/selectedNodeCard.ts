/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * Neutral selected-node card presentation for Code Graph morphing.
 * Inspired by PreBase First Test ArchitectureNode (64×62 / entry 66) and flow-adapter
 * constants — reimplemented for the canvas renderer (no React / React Flow).
 *
 * Active runtime may import this module. It must NOT import
 * `graphs/src/preserved/architecture/**`.
 */

/** Screen-space card width at full expansion (CSS px). */
export const SELECTED_NODE_CARD_WIDTH = 64;

/** Screen-space card height at full expansion (CSS px). */
export const SELECTED_NODE_CARD_HEIGHT = 62;

/** Entry-node card height at full expansion (CSS px). */
export const SELECTED_NODE_ENTRY_HEIGHT = 66;

/** Icon tile edge at full expansion (CSS px). */
export const SELECTED_NODE_ICON_SIZE = 24;

/** Corner radius of the fully expanded card (CSS px). */
export const SELECTED_NODE_CARD_RADIUS = 6;

/** Default expansion duration (ms). */
export const MORPH_EXPAND_MS = 200;

/** Default contraction duration (ms). */
export const MORPH_CONTRACT_MS = 170;

export interface NodeMorphPresentation {
	/** Interpolated width in CSS px (screen-space intent). */
	width: number;
	/** Interpolated height in CSS px. */
	height: number;
	/** Corner radius in CSS px (half-size when fully collapsed). */
	cornerRadius: number;
	/** 0..1 icon tile opacity. */
	iconOpacity: number;
	/** 0..1 label opacity. */
	labelOpacity: number;
	/** 0..1 badge opacity. */
	badgeOpacity: number;
	/** Card surface mix 0 = node accent fill, 1 = raised card surface. */
	surfaceMix: number;
}

function clamp01(t: number): number {
	if (!Number.isFinite(t)) {
		return 0;
	}
	return Math.max(0, Math.min(1, t));
}

/** Smoothstep-ish ease-out for expansion (responsive start, soft settle). */
export function easeMorphExpand(t: number): number {
	const x = clamp01(t);
	return 1 - Math.pow(1 - x, 2.4);
}

/** Slightly snappier ease for contraction. */
export function easeMorphContract(t: number): number {
	const x = clamp01(t);
	return 1 - Math.pow(1 - x, 2);
}

/**
 * Interpolate presentation for morph progress `t` in [0,1].
 * t=0 → circular dot; t=1 → Architecture-style card.
 */
export function interpolateNodePresentation(
	t: number,
	opts: {
		dotDiameter: number;
		isEntry?: boolean;
	}
): NodeMorphPresentation {
	const u = clamp01(t);
	const dot = Math.max(4, opts.dotDiameter);
	const targetH = opts.isEntry ? SELECTED_NODE_ENTRY_HEIGHT : SELECTED_NODE_CARD_HEIGHT;
	const targetW = SELECTED_NODE_CARD_WIDTH;
	const width = dot + (targetW - dot) * u;
	const height = dot + (targetH - dot) * u;
	const cornerFullyCollapsed = Math.min(width, height) / 2;
	const cornerRadius = cornerFullyCollapsed + (SELECTED_NODE_CARD_RADIUS - cornerFullyCollapsed) * u;
	// Staged content reveal (see GRAPH_NODE_MORPH_RESEARCH).
	const iconOpacity = clamp01((u - 0.25) / 0.3);
	const labelOpacity = clamp01((u - 0.45) / 0.4);
	const badgeOpacity = clamp01((u - 0.55) / 0.35);
	return {
		width,
		height,
		cornerRadius: Math.max(0, cornerRadius),
		iconOpacity,
		labelOpacity,
		badgeOpacity,
		surfaceMix: u,
	};
}

/**
 * Axis-aligned hit test for an interpolated card/dot centered at (cx, cy).
 * Coordinates and sizes must share the same space (screen or graph).
 */
export function hitTestNodePresentation(
	px: number,
	py: number,
	cx: number,
	cy: number,
	pres: NodeMorphPresentation,
	/** Extra padding for easier picking when nearly collapsed. */
	pad = 2
): boolean {
	const hw = pres.width / 2 + pad;
	const hh = pres.height / 2 + pad;
	return px >= cx - hw && px <= cx + hw && py >= cy - hh && py <= cy + hh;
}

/** Clamp a wall-clock delta after sleep/background (seconds). */
export function clampMorphDeltaSeconds(dt: number, max = 0.05): number {
	if (!Number.isFinite(dt) || dt < 0) {
		return 0;
	}
	return Math.min(max, dt);
}

/** Theme-aware card chrome (webview / canvas fill helpers). */
export interface SelectedNodeCardThemeColors {
	/** Raised card surface over the node accent. */
	surface: string;
	/** Selection ring / focus stroke. */
	selectionRing: string;
	/** Soft glow behind a selected card. */
	selectionGlow: string;
	/** Label text on the card. */
	label: string;
	/** Kind icon tile fill. */
	iconTile: string;
	/** Entry badge text. */
	entryBadge: string;
}

/**
 * Resolve card colors from CSS custom properties when available, else PreBase Night defaults.
 * Pure helper — no DOM required; pass `getProperty` from `getComputedStyle(document.documentElement).getPropertyValue`.
 */
export function resolveSelectedNodeCardColors(
	getProperty?: (name: string) => string
): SelectedNodeCardThemeColors {
	const read = (name: string, fallback: string): string => {
		if (!getProperty) {
			return fallback;
		}
		const v = (getProperty(name) || '').trim();
		return v || fallback;
	};
	return {
		surface: read('--vscode-editor-background', '#1B1C1E'),
		selectionRing: read('--vscode-focusBorder', '#2dd4bf'),
		selectionGlow: 'rgba(45,212,191,0.35)',
		label: read('--vscode-foreground', '#f4f4f5'),
		iconTile: 'rgba(255,255,255,0.92)',
		entryBadge: '#e8b84a',
	};
}
