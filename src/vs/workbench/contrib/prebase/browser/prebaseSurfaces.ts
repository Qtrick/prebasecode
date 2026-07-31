/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Semantic surface, border and foreground roles for PreBase's custom editors
 * (Home, Onboarding, Settings, Runtime Preview).
 *
 * Every value resolves to a workbench theme colour at runtime rather than a
 * literal, so these surfaces follow the active colour theme, user
 * `workbench.colorCustomizations` and High Contrast themes. The concrete hex
 * values for the default PreBase Night theme live in
 * `extensions/theme-defaults/themes/prebase_dark.json`; the role definitions
 * are documented in `docs/experiments/one-graph-type/DARK_SURFACE_TOKENS.md`.
 *
 * Do not add literal colours here. If a role is missing, map it to the closest
 * native theme token instead of inventing a new palette value.
 */
export const PreBaseSurface = {
	/** Deepest content well: page canvases, editor-like bodies, code blocks. */
	deep: 'var(--vscode-editor-background)',
	/** Default application chrome: toolbars and side panels of custom editors. */
	chrome: 'var(--vscode-sideBar-background)',
	/** Raised surface: cards, grouped controls, docked inspectors. */
	raised: 'var(--vscode-editorWidget-background)',
	/** Overlay surface: floating popovers and hover state on a raised surface. */
	overlay: 'var(--vscode-editorHoverWidget-background)',
	/** Welcome-style tiles (Home, Onboarding) and their hover state. */
	tile: 'var(--vscode-welcomePage-tileBackground)',
	tileHover: 'var(--vscode-welcomePage-tileHoverBackground)',
	/** Selected navigation entry or toggled control. */
	selected: 'var(--vscode-list-activeSelectionBackground)',
	/** Hover state for rows on a chrome surface. */
	hover: 'var(--vscode-list-hoverBackground)'
} as const;

export const PreBaseBorder = {
	/** Structural separators between regions. Intentionally low contrast. */
	subtle: 'var(--vscode-panel-border)',
	/** Boundaries that identify a control or a floating surface. */
	default: 'var(--vscode-widget-border)',
	/** Keyboard focus indicator. Never dim this for aesthetic reasons. */
	focus: 'var(--vscode-focusBorder)'
} as const;

export const PreBaseForeground = {
	primary: 'var(--vscode-foreground)',
	secondary: 'var(--vscode-descriptionForeground)',
	/** Only for genuinely disabled controls (WCAG 1.4.3 exempts these). */
	disabled: 'var(--vscode-disabledForeground)',
	onSelected: 'var(--vscode-list-activeSelectionForeground)',
	link: 'var(--vscode-textLink-foreground)',
	error: 'var(--vscode-errorForeground)'
} as const;

export const PreBaseControl = {
	accentBackground: 'var(--vscode-button-background)',
	accentForeground: 'var(--vscode-button-foreground)',
	accentHoverBackground: 'var(--vscode-button-hoverBackground)',
	secondaryBackground: 'var(--vscode-button-secondaryBackground)',
	secondaryForeground: 'var(--vscode-button-secondaryForeground)',
	secondaryHoverBackground: 'var(--vscode-button-secondaryHoverBackground)',
	inputBackground: 'var(--vscode-input-background)',
	inputForeground: 'var(--vscode-input-foreground)',
	inputBorder: 'var(--vscode-input-border)',
	inputPlaceholder: 'var(--vscode-input-placeholderForeground)',
	shadow: 'var(--vscode-widget-shadow)'
} as const;
