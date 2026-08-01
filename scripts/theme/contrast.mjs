#!/usr/bin/env node
/**
 * WCAG 2.x relative luminance / contrast helpers shared by the PreBase theme
 * verification scripts. Pure functions, no dependencies.
 */

/** @param {string} hex `#rgb`, `#rrggbb` or `#rrggbbaa` (alpha ignored). */
export function parseHex(hex) {
	const value = String(hex).trim().replace(/^#/, '');
	const expand = value.length === 3 || value.length === 4
		? value.slice(0, 3).split('').map(c => c + c).join('')
		: value.slice(0, 6);
	if (!/^[0-9a-fA-F]{6}$/.test(expand)) {
		throw new Error(`Not a hex colour: ${hex}`);
	}
	return {
		r: parseInt(expand.slice(0, 2), 16),
		g: parseInt(expand.slice(2, 4), 16),
		b: parseInt(expand.slice(4, 6), 16)
	};
}

/** Alpha channel of `#rrggbbaa`, or 1 when the colour is opaque. */
export function alphaOf(hex) {
	const value = String(hex).trim().replace(/^#/, '');
	if (value.length === 8) {
		return parseInt(value.slice(6, 8), 16) / 255;
	}
	if (value.length === 4) {
		return parseInt(value[3] + value[3], 16) / 255;
	}
	return 1;
}

/** Composite a possibly translucent foreground over an opaque background. */
export function flatten(color, background) {
	const alpha = alphaOf(color);
	if (alpha >= 1) {
		return toHex(parseHex(color));
	}
	const fg = parseHex(color);
	const bg = parseHex(background);
	return toHex({
		r: Math.round(fg.r * alpha + bg.r * (1 - alpha)),
		g: Math.round(fg.g * alpha + bg.g * (1 - alpha)),
		b: Math.round(fg.b * alpha + bg.b * (1 - alpha))
	});
}

function toHex({ r, g, b }) {
	return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}

/** WCAG 2.2 relative luminance. */
export function relativeLuminance(hex) {
	const { r, g, b } = parseHex(hex);
	const channel = v => {
		const s = v / 255;
		return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
	};
	return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * WCAG 2.2 contrast ratio. Translucent foregrounds are composited over
 * `background` first so the reported ratio matches what is rendered.
 */
export function contrastRatio(foreground, background) {
	const fg = relativeLuminance(flatten(foreground, background));
	const bg = relativeLuminance(background);
	const lighter = Math.max(fg, bg);
	const darker = Math.min(fg, bg);
	return (lighter + 0.05) / (darker + 0.05);
}

/** Truncate (never round up) to two decimals so a failing ratio cannot pass. */
export function truncate2(ratio) {
	return Math.floor(ratio * 100) / 100;
}
