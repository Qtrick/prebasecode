#!/usr/bin/env node
/**
 * Guards the PreBase dark surface system:
 *
 *  1. `PreBase Night` may only use the approved palette (four surfaces, the
 *     accent ramp, the foreground ramp, translucent borders) — no ad-hoc greys.
 *  2. Text/background pairs meet the WCAG 2.2 AA ratio recorded for them.
 *  3. PreBase-owned UI source does not hardcode surface colours; surfaces must
 *     come from theme tokens so themes, colour customizations and High
 *     Contrast keep working.
 *  4. The High Contrast themes are not overridden by the PreBase palette.
 *
 * Run with `npm run verify:theme-surfaces`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonc } from './jsonc.mjs';
import { contrastRatio, truncate2 } from './contrast.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const THEME = path.join(REPO_ROOT, 'extensions/theme-defaults/themes/prebase_dark.json');

/** The four supplied surface values. Nothing else may act as a surface. */
export const SURFACES = {
	deep: '#1B1C1E',
	default: '#1F1F1F',
	raised: '#2B2B2B',
	overlay: '#303030'
};

/** Non-surface values the theme is allowed to use, each with a stated role. */
const ALLOWED_OTHER = new Map(Object.entries({
	'#2dd4bf': 'accent',
	'#5eead4': 'accent (hover / active indicator)',
	'#22d3ee': 'accent (links, modified)',
	'#2dd4bf82': 'accent wash (active input option)',
	'#134e4a': 'selected surface (accent tinted)',
	'#134e4a66': 'selected wash (slash command)',
	'#f4f4f5': 'primary foreground',
	'#a1a1aa': 'secondary foreground',
	'#8b8b93': 'muted foreground',
	'#71717a': 'disabled foreground (WCAG 1.4.3 exempt)',
	'#ffffff14': 'subtle border',
	'#ffffff1a': 'hover wash / scrollbar / button border',
	'#ffffff2e': 'default border / scrollbar hover',
	'#ffffff38': 'scrollbar active',
	'#00000066': 'widget shadow base',
	'#ff7b72': 'error foreground (AA on every surface)',
	'#F85149': 'diff deleted / gutter marker',
	'#2EA043': 'diff added',
	'#9E6A03': 'find match',
	'#BB800966': 'match highlight',
	'#E2C08D': 'modified file indicator'
}));

/**
 * Text/background pairs that must hold. `min` is 4.5 for body text and 3.0
 * where WCAG 2.2 permits large text or non-text contrast.
 */
const CONTRAST_CASES = [
	['foreground', 'editor.background', 4.5],
	['foreground', 'sideBar.background', 4.5],
	['foreground', 'editorWidget.background', 4.5],
	['foreground', 'menu.background', 4.5],
	['descriptionForeground', 'editor.background', 4.5],
	['descriptionForeground', 'sideBar.background', 4.5],
	['descriptionForeground', 'editorWidget.background', 4.5],
	['descriptionForeground', 'menu.background', 4.5],
	['tab.inactiveForeground', 'tab.inactiveBackground', 4.5],
	['tab.activeForeground', 'tab.activeBackground', 4.5],
	['input.placeholderForeground', 'input.background', 4.5],
	['editorLineNumber.foreground', 'editor.background', 4.5],
	['activityBar.inactiveForeground', 'activityBar.background', 3.0],
	['statusBar.foreground', 'statusBar.background', 4.5],
	['titleBar.activeForeground', 'titleBar.activeBackground', 4.5],
	['list.activeSelectionForeground', 'list.activeSelectionBackground', 4.5],
	['quickInputList.focusForeground', 'quickInputList.focusBackground', 4.5],
	['menu.selectionForeground', 'menu.selectionBackground', 4.5],
	['button.foreground', 'button.background', 4.5],
	['button.secondaryForeground', 'button.secondaryBackground', 4.5],
	['textLink.foreground', 'editor.background', 4.5],
	['textLink.foreground', 'editorWidget.background', 4.5],
	['errorForeground', 'editorWidget.background', 4.5],
	['errorForeground', 'editor.background', 4.5],
	['errorForeground', 'menu.background', 4.5],
	['foreground', 'panel.background', 4.5],
	['foreground', 'terminal.background', 4.5],
	['foreground', 'chat.requestBackground', 4.5],
	['descriptionForeground', 'panel.background', 4.5],
	['panelTitle.inactiveForeground', 'panel.background', 4.5],
	['input.foreground', 'input.background', 4.5],
	['dropdown.foreground', 'dropdown.background', 4.5],
	['breadcrumb.foreground', 'breadcrumb.background', 4.5],
	['commandCenter.foreground', 'commandCenter.background', 4.5],
	['keybindingLabel.foreground', 'keybindingLabel.background', 4.5],
	['notifications.foreground', 'notifications.background', 4.5],
	['editorSuggestWidget.selectedForeground', 'editorSuggestWidget.selectedBackground', 4.5],
	['sideBarSectionHeader.foreground', 'sideBarSectionHeader.background', 4.5],
	['activityBar.foreground', 'activityBar.background', 4.5],
	// The accent focus ring must stay clearly visible (WCAG 2.2 non-text contrast).
	['focusBorder', 'editor.background', 3.0],
	['focusBorder', 'sideBar.background', 3.0],
	['focusBorder', 'menu.background', 3.0]
];

/**
 * Legacy raw palettes that must not come back into PreBase UI source. Surfaces
 * belong in the theme, not in component code.
 */
const FORBIDDEN_SOURCE_COLORS = [
	'#020617', '#070b14', '#0b1220', '#0f172a', '#111827', '#1e293b', '#334155',
	'#94a3b8', '#cbd5e1', '#e2e8f0', '#64748b', '#155e75', '#ecfeff',
	'#0a0a0b', '#101012', '#161618', '#242428'
];

/** PreBase-owned UI source that must stay theme driven. */
const SOURCE_ROOTS = [
	'src/vs/workbench/contrib/prebase/browser',
	'src/vs/workbench/contrib/prebase/electron-browser',
	'graphs/src/host'
];

/** The archive and tests are intentionally frozen / fixture data. */
const SOURCE_IGNORE = [/\/preserved\//, /\/tests?\//, /\.test\.ts$/];

const failures = [];
const notes = [];

/**
 * Flatten a theme and everything it includes into the colours it resolves to.
 *
 * @param {string} file
 * @returns {Record<string, string>}
 */
function resolveTheme(file) {
	const data = readJsonc(file);
	const base = data.include ? resolveTheme(path.join(path.dirname(file), data.include)) : {};
	return { ...base, ...(data.colors ?? {}) };
}

// ---------------------------------------------------------------------------
// 1) Palette allowlist
// ---------------------------------------------------------------------------
const theme = readJsonc(THEME);
const colors = theme.colors ?? {};
const surfaceValues = new Set(Object.values(SURFACES).map(v => v.toLowerCase()));
const allowed = new Set([...surfaceValues, ...[...ALLOWED_OTHER.keys()].map(v => v.toLowerCase())]);

for (const [token, value] of Object.entries(colors)) {
	if (typeof value !== 'string' || !value.startsWith('#')) {
		continue;
	}
	if (!allowed.has(value.toLowerCase())) {
		failures.push(`palette: ${token} uses unapproved colour ${value} (add a documented role or reuse a surface)`);
	}
}

const usedSurfaces = new Set(
	Object.values(colors).filter(v => typeof v === 'string' && surfaceValues.has(v.toLowerCase())).map(v => v.toLowerCase())
);
for (const [role, value] of Object.entries(SURFACES)) {
	if (!usedSurfaces.has(value.toLowerCase())) {
		failures.push(`palette: surface role "${role}" (${value}) is defined but unused`);
	}
}

// A theme that paints large chrome pure black defeats the point of the system.
for (const [token, value] of Object.entries(colors)) {
	if (typeof value === 'string' && /^#000000?$/i.test(value)) {
		failures.push(`palette: ${token} is opaque pure black; use a surface role (translucent black is allowed for shadows)`);
	}
}

// ---------------------------------------------------------------------------
// 2) Contrast
// ---------------------------------------------------------------------------
for (const [fgToken, bgToken, min] of CONTRAST_CASES) {
	const fg = colors[fgToken];
	const bg = colors[bgToken];
	if (!fg || !bg) {
		failures.push(`contrast: missing token ${!fg ? fgToken : bgToken} — the surface system expects it to be set explicitly`);
		continue;
	}
	const ratio = truncate2(contrastRatio(fg, bg));
	if (ratio < min) {
		failures.push(`contrast: ${fgToken} on ${bgToken} is ${ratio}:1, below the required ${min}:1`);
	} else {
		notes.push(`${fgToken} on ${bgToken}: ${ratio}:1 (min ${min})`);
	}
}

// ---------------------------------------------------------------------------
// 3) No hardcoded surfaces in PreBase UI source
// ---------------------------------------------------------------------------
function* walk(dir) {
	if (!fs.existsSync(dir)) {
		return;
	}
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			yield* walk(full);
		} else if (/\.(ts|css)$/.test(entry.name)) {
			yield full;
		}
	}
}

const forbidden = FORBIDDEN_SOURCE_COLORS.map(c => c.toLowerCase());
for (const root of SOURCE_ROOTS) {
	for (const file of walk(path.join(REPO_ROOT, root))) {
		const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/');
		if (SOURCE_IGNORE.some(re => re.test('/' + rel))) {
			continue;
		}
		const text = fs.readFileSync(file, 'utf8');
		for (const [index, line] of text.split('\n').entries()) {
			const lower = line.toLowerCase();
			for (const color of forbidden) {
				if (lower.includes(color)) {
					failures.push(`source: ${rel}:${index + 1} hardcodes ${color}; use a role from prebaseSurfaces.ts or a --vscode-* variable`);
				}
			}
			// Opaque pure black as a background. Shadows and translucent
			// overlays (rgba(0,0,0,.4), #0006, …) stay legal.
			if (/background[^;]*:\s*(#000000|#000)\b/i.test(line) || /background\s*=\s*'(#000000|#000)'/i.test(line)) {
				failures.push(`source: ${rel}:${index + 1} paints an opaque pure-black background; use PreBaseSurface.deep`);
			}
		}
	}
}

// ---------------------------------------------------------------------------
// 4) High Contrast must not inherit the PreBase greys
// ---------------------------------------------------------------------------
for (const hc of ['hc_black.json', 'hc_light.json']) {
	const file = path.join(REPO_ROOT, 'extensions/theme-defaults/themes', hc);
	const hcTheme = readJsonc(file);
	for (const [token, value] of Object.entries(hcTheme.colors ?? {})) {
		if (typeof value === 'string' && surfaceValues.has(value.toLowerCase())) {
			failures.push(`high contrast: ${hc} ${token} uses PreBase surface ${value}; High Contrast must keep its own colours`);
		}
	}
	if ((theme.include ?? '').includes(hc)) {
		failures.push(`high contrast: PreBase Night must not extend ${hc}`);
	}
}

// ---------------------------------------------------------------------------
// 5) Startup colours must match the themes they stand in for
// ---------------------------------------------------------------------------
// `COLOR_THEME_*_INITIAL_COLORS` paints the workbench on a cold start, before
// the theme extension is registered. When it drifts from the theme the first
// frame flashes a different palette.
{
	const file = path.join(REPO_ROOT, 'src/vs/workbench/services/themes/common/workbenchThemeService.ts');
	const source = fs.readFileSync(file, 'utf8');
	for (const [constant, themeFile] of [
		['COLOR_THEME_DARK_INITIAL_COLORS', 'prebase_dark.json'],
		['COLOR_THEME_LIGHT_INITIAL_COLORS', 'prebase_light.json']
	]) {
		const block = source.match(new RegExp(`export const ${constant} = \\{\\n([\\s\\S]*?)\\n\\};`));
		if (!block) {
			failures.push(`startup: ${constant} not found in workbenchThemeService.ts`);
			continue;
		}
		const resolved = resolveTheme(path.join(REPO_ROOT, 'extensions/theme-defaults/themes', themeFile));
		for (const [, token, value] of block[1].matchAll(/'([^']+)':\s*'([^']+)'/g)) {
			const expected = resolved[token];
			if (expected === undefined) {
				failures.push(`startup: ${constant} sets ${token}, which ${themeFile} does not define`);
			} else if (expected.toLowerCase() !== value.toLowerCase()) {
				failures.push(`startup: ${constant} ${token} is ${value} but ${themeFile} resolves to ${expected}`);
			}
		}
	}
}

// ---------------------------------------------------------------------------
// 6) Semantic roles must survive themes that leave their token undefined
// ---------------------------------------------------------------------------
// A colour ID registered with a `null` default for some theme kind emits no CSS
// custom property under that kind. A bare `var(--vscode-x)` then makes the whole
// declaration invalid, so the property is dropped (or, for a shorthand,
// silently reset) rather than falling back. Every role that maps to such a
// token must therefore supply its own fallback.
{
	const registrations = new Map();
	for (const file of walk(path.join(REPO_ROOT, 'src/vs/platform/theme/common/colors'))) {
		collectNullDefaults(fs.readFileSync(file, 'utf8'), registrations);
	}
	for (const rel of [
		'src/vs/workbench/common/theme.ts',
		'src/vs/workbench/contrib/welcomeGettingStarted/browser/gettingStartedColors.ts'
	]) {
		collectNullDefaults(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'), registrations);
	}

	const rel = 'src/vs/workbench/contrib/prebase/browser/prebaseSurfaces.ts';
	const source = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
	for (const [index, line] of source.split('\n').entries()) {
		const match = line.match(/'var\(--vscode-([A-Za-z]+)-([A-Za-z]+)([^']*)\)'/);
		if (!match) {
			continue;
		}
		const [, group, name, rest] = match;
		const token = `${group}.${name}`;
		const kinds = registrations.get(token);
		if (kinds && !rest.includes(',')) {
			failures.push(`roles: ${rel}:${index + 1} uses ${token} bare, but it has no default for ${kinds.join(', ')}; add a fallback`);
		}
	}
	notes.push(`roles: ${registrations.size} colour IDs have a null default for at least one theme kind`);
}

/**
 * Record every `registerColor` whose defaults object leaves a theme kind null.
 *
 * @param {string} source
 * @param {Map<string, string[]>} into
 */
function collectNullDefaults(source, into) {
	for (const match of source.matchAll(/registerColor\(\s*'([^']+)',\s*\{([^}]*)\}/g)) {
		const kinds = [...match[2].matchAll(/(\w+):\s*null\b/g)].map(m => m[1]);
		if (kinds.length > 0) {
			into.set(match[1], kinds);
		}
	}
}

// ---------------------------------------------------------------------------

if (process.argv.includes('--verbose')) {
	for (const note of notes) {
		console.log(`  ${note}`);
	}
}

if (failures.length > 0) {
	console.error('verify:theme-surfaces: FAIL');
	for (const failure of failures) {
		console.error(`  - ${failure}`);
	}
	process.exit(1);
}

console.log(`verify:theme-surfaces: OK (${Object.keys(colors).length} tokens, ${CONTRAST_CASES.length} contrast checks)`);
