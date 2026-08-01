# Dark Surface Audit — PreBase

Inventory of every significant dark surface in PreBase, its state before this
pass, and the semantic role it was assigned. Baseline commit: `6941d275`
("Update: Architectural graph removed. Network graph updated"). Token
definitions: [`DARK_SURFACE_TOKENS.md`](./DARK_SURFACE_TOKENS.md). Rationale:
[`DARK_UI_RESEARCH.md`](./DARK_UI_RESEARCH.md).

## Method

1. Resolved the full theme `include` chain (`prebase_dark.json` →
   `dark_plus.json` → `dark_vs.json`) plus the upstream colour registry
   (`src/vs/platform/theme/common/colors/*.ts`, `src/vs/workbench/common/theme.ts`,
   contrib registries) so that *unset* tokens were audited too, not just set ones.
   916 registered colours were scanned.
2. Grepped PreBase-owned UI source for literal colours:
   `#000`, `#000000`, `black`, `rgb(0`, `rgba(0`, `#101010`, `#111`, `#181818`,
   `#1a1a1a`, `#1b1b1b`, `#1e1e1e`, `#1f1f1f`, inline `style.background = …`,
   CSS custom properties and `registerColor` calls.
3. Measured relative luminance and WCAG 2.2 contrast with
   `scripts/theme/contrast.mjs` (truncated, never rounded up).
4. Excluded from scope: TextMate/semantic `tokenColors` (syntax), the frozen
   archive under `graphs/src/preserved/`, test fixtures, and third-party
   extension content.

## Headline findings (before)

| # | Finding | Evidence | Severity |
| - | ------- | -------- | -------- |
| A1 | **The application shipped two unrelated dark palettes.** The workbench theme used a neutral near-black ramp (`#0a0a0b` / `#101012` / `#161618` / `#242428`) while every PreBase custom editor and the graph webview used a *slate/navy* ramp (`#0b1220`, `#0f172a`, `#111827`, `#1e293b`, `#334155`). Opening PreBase Home or the Graph next to the Explorer produced a visible blue cast against neutral chrome. | `prebaseHomeEditor.ts:39-44`, `prebaseSettingsEditor.ts:83-94`, `graphEditor.ts:349-378`, `prebaseMapsView.ts:42-47` @ `6941d275` | High |
| A2 | **Elevation was inverted.** Chrome (`sideBar`, `activityBar`, `panel`, `statusBar`, `titleBar`, tab strip) was `#0a0a0b` (0.306% relative luminance) while the editor content well was *lighter* at `#101012` (0.524%). Apple's base/elevated model and Atlassian's sunken/default model both require the opposite. | baseline theme lines 7, 33, 65, 83, 90, 103, 110, 125 | High |
| A3 | **The largest surface in the product was effectively pure black.** `#0a0a0b` is 0.306% luminance versus 0.000% for `#000000`; against `#f4f4f5` body text that is an 18.0:1 field covering the activity bar, sidebar, tab strip, panel, title bar and status bar simultaneously. | measured | High |
| A4 | **Three WCAG 1.4.3 failures.** `input.placeholderForeground` 3.73:1, `editorLineNumber.foreground` 3.93:1, `activityBar.inactiveForeground` 4.09:1 — all `#71717a` on near-black. | measured | Critical (accessibility) |
| A5 | **`button.secondaryBackground` was `#00000000`** — fully transparent. Secondary buttons had no surface at all and relied entirely on a border, so they disappeared on any surface without one. | baseline theme line 18 | Medium |
| A6 | **Hardcoded colours defeated theming.** Because PreBase custom editors wrote literal hex into inline styles, switching to Dark Modern, Light, or High Contrast left Home / Settings / Onboarding / Graph / Runtime Preview stuck in the navy palette. `workbench.colorCustomizations` had no effect on them. | same files as A1 | High |
| A7 | **Graph legend lied about edge colour.** The legend swatch for "Import / dependency" was hardcoded `#94a3b8` while the canvas drew a different value, so the legend did not match the rendering. | `graphEditor.ts:670-673` vs canvas stroke code | Medium |
| A8 | **Foreign surfaces leaked through unset tokens.** Ten large-ish surfaces fell back to upstream defaults unrelated to either PreBase palette (see the table below). | registry scan | Medium |

## Surface inventory

Approximate screen area is for a maximised window with the Explorer open, an
editor group and the panel visible. It is an ordering aid, not a measurement.

### Application shell

| Component | Before | Before token | Visual role | ~Area | Role assigned | After | Contrast | Status |
| --------- | ------ | ------------ | ----------- | ----- | ------------- | ----- | -------- | ------ |
| Activity bar | `#0a0a0b` | `activityBar.background` | Chrome rail | 2% | Default chrome | `#1F1F1F` | icons 4.87:1 (min 3.0, 1.4.11) | Done |
| Sidebar body | `#0a0a0b` | `sideBar.background` | Chrome | 14% | Default chrome | `#1F1F1F` | text 14.99:1 | Done |
| Sidebar section header | `#0a0a0b` | `sideBarSectionHeader.background` | Grouping | 2% | Default chrome + `#ffffff14` border (deliberately *not* a new gray — Atlassian restraint) | `#1F1F1F` | 14.99:1 | Done |
| Title bar | `#0a0a0b` | `titleBar.activeBackground` | Chrome | 1% | Default chrome | `#1F1F1F` | 14.99:1 | Done |
| Title bar (inactive window) | `#101012` | `titleBar.inactiveBackground` | Chrome | 1% | Default chrome (was inconsistent with active) | `#1F1F1F` | 6.43:1 | Done |
| Status bar | `#0a0a0b` | `statusBar.background` | Chrome | 1% | Default chrome | `#1F1F1F` | 6.43:1 | Done |
| Window border | unset (`#000000`-ish default) | `window.activeBorder` | Separation | — | Default border | `#ffffff2e` | n/a | Done |

### Editor and tabs

| Component | Before | Visual role | ~Area | Role assigned | After | Contrast | Status |
| --------- | ------ | ----------- | ----- | ------------- | ----- | -------- | ------ |
| Editor canvas | `#101012` | Content well | 45% | Deep | `#1B1C1E` | 15.51:1 | Done |
| Editor pane / empty group | unset → `#1E1E1E` | Content well | — | Deep | `#1B1C1E` | — | Done |
| Tab strip | `#0a0a0b` | Chrome | 2% | Default chrome | `#1F1F1F` | — | Done |
| Active tab | `#101012` | Belongs to content | <1% | Deep (= editor, so the tab reads as attached) + `#5eead4` top border | `#1B1C1E` | 15.51:1 | Done |
| Inactive tab | `#0a0a0b` | Chrome | 1% | Default chrome | `#1F1F1F` | 6.43:1 | Done |
| Tab hover | `#101012` (same as active — no feedback) | Feedback | — | Raised | `#2B2B2B` | — | Fixed |
| Multi-selected tab | unset → `#222222` | Selection | — | Raised | `#2B2B2B` | 12.88:1 | Done |
| Sticky scroll | unset → `#1F1F1F`-ish / gutter `#2A2D2E` | Chrome over content | — | Default chrome + `#ffffff14` border | `#1F1F1F` | — | Done |
| Inactive line highlight | unset → `#282828` | Content marker | — | Default chrome | `#1F1F1F` | — | Done |
| Breadcrumbs | unset | Content chrome | <1% | Deep (sits on the editor) | `#1B1C1E` | 6.65:1 | Done |
| Peek view editor / result | `#101012` / `#101012` | Content / list | — | Deep / default chrome | `#1B1C1E` / `#1F1F1F` | — | Done |

### Panel and terminal

| Component | Before | Visual role | ~Area | Role assigned | After | Contrast | Status |
| --------- | ------ | ----------- | ----- | ------------- | ----- | -------- | ------ |
| Panel body | `#0a0a0b` | Chrome | 20% when open | Default chrome | `#1F1F1F` | 14.99:1 | Done |
| Terminal body | unset (followed the panel) | Content well | 18% when open | Deep — the terminal is a content well inside panel chrome | `#1B1C1E` | 15.51:1 | Done |
| Panel section header | unset | Grouping | — | Raised | `#2B2B2B` | — | Done |
| Terminal sticky scroll / hover | unset → `#2A2D2E` (both) | Overlay on content | — | Default chrome / raised (so hover is now distinguishable) | `#1F1F1F` / `#2B2B2B` | — | Fixed |
| Panel active tab indicator | `#5eead4` | Accent | — | unchanged | `#5eead4` | — | Kept |

ANSI colours, cursor, selection and hyperlink colours were **not** touched.

### Widgets, menus, inputs

| Component | Before | Visual role | Role assigned | After | Contrast | Status |
| --------- | ------ | ----------- | ------------- | ----- | -------- | ------ |
| Editor widget (find/replace) | `#161618` | Raised | Raised | `#2B2B2B` | 12.88:1 | Done |
| Quick input / Command Palette body | `#161618` | Raised | Raised | `#2B2B2B` | — | Done |
| Quick input title | unset | Overlay | Overlay | `#303030` | — | Done |
| Context menu | `#101012` | Overlay | Overlay | `#303030` | 12.0:1 | Done |
| Dropdown (closed) | `#161618` | In-flow control | Raised | `#2B2B2B` | 12.88:1 | Done |
| Dropdown (open list) | `#101012` — *darker than the closed control* | Out-of-flow list | Overlay | `#303030` | — | Fixed |
| Hover widget | unset | Overlay | Overlay | `#303030` | — | Done |
| Suggest widget | unset | Overlay | Overlay | `#303030`, selected `#134e4a` | 8.62:1 | Done |
| Notifications / centre header | `#101012` | Raised | Raised | `#2B2B2B` | 12.88:1 | Done |
| Text input | `#161618` | Input well | Deep | `#1B1C1E` | 15.51:1, placeholder 5.04:1 | Fixed (A4) |
| Secondary button | `#00000000` (invisible) | Control | Raised | `#2B2B2B` | 12.88:1 | Fixed (A5) |
| Debug toolbar | `#0a0a0b` | Floating toolbar | Overlay | `#303030` | — | Done |
| Keybinding label | unset background | Raised chip | Raised | `#2B2B2B` | 12.88:1 | Done |

### Lists and trees

| Component | Before | Role assigned | After | Status |
| --------- | ------ | ------------- | ----- | ------ |
| Row hover | unset → upstream `#2A2D2E` | Raised | `#2B2B2B` | Done |
| Active selection | unset → upstream blue `#04395E` | Selected (accent tinted) | `#134e4a`, fg 8.62:1 | Done |
| Inactive selection | unset | Raised | `#2B2B2B` | Done |
| Keyboard focus (unselected) | unset | Raised | `#2B2B2B` | Done |
| Drop target | unset → `#383B3D` | Overlay | `#303030` | Done |
| Indent guides | unset → `#585858`/`#404040` | Subtle/default border | `#ffffff2e` / `#ffffff14` | Done |

### Scrollbars and sashes

| Component | Before | After | Status |
| --------- | ------ | ----- | ------ |
| Slider rest / hover / active | unset → upstream white washes | `#ffffff1a` / `#ffffff2e` / `#ffffff38` | Done |
| Sash hover | unset | `#2dd4bf` | Done |

### PreBase custom UI

| Component | Before (hardcoded) | Visual role | Role assigned | Implementation | Status |
| --------- | ------------------ | ----------- | ------------- | -------------- | ------ |
| PreBase Home body | `#0b1220` + radial teal wash | Page canvas | `PreBaseSurface.deep` | `prebaseHomeEditor.ts` | Done |
| Home project cards | `#0f172a`, border `#1e293b` | Tile | `PreBaseSurface.tile` / `tileHover` | `prebaseHomeEditor.ts` | Done |
| Home text ramp | `#e2e8f0` / `#94a3b8` / `#64748b` | Text | `PreBaseForeground.primary/secondary/disabled` | `prebaseHomeEditor.ts` | Done |
| Home menu shadow | `rgba(0,0,0,0.45)` | Shadow base | **kept** — translucent black is a legal shadow, not a surface | `prebaseHomeEditor.ts:552` | Intentional |
| Onboarding | `#0b1220`, pills `#1e293b` | Page + chips | `deep` + `raised` | `prebaseOnboardingEditor.ts` | Done |
| Settings body / nav / cards | `#0b1220` / `#0f172a` / `#111827` / `#1e293b` | Page / chrome / raised | `deep` / `chrome` / `raised` | `prebaseSettingsEditor.ts` | Done |
| Settings active chip | `#155e75` bg, `#ecfeff` fg, `#22d3ee88` border | Selected | `PreBaseSurface.selected` + `PreBaseForeground.onSelected` | `prebaseSettingsEditor.ts` | Done |
| Graph canvas | `#070b14` | Deepest content well | `--vscode-editor-background` | `graphEditor.ts` | Done |
| Graph toolbar | `rgba(15,23,42,.82)` + `#334155` | Floating control bar | `--vscode-editorWidget-background` + `editorWidget.border` | `graphEditor.ts` | Done |
| Graph status pill | `rgba(15,23,42,.88)` | Floating status | `--vscode-editorWidget-background` | `graphEditor.ts` | Done |
| Graph legend | `rgba(15,23,42,.88)` + `#334155` | Floating legend | `--vscode-editorWidget-background` | `graphEditor.ts` | Done |
| Graph inspector popup | `rgba(15,23,42,.96)` + `#334155` | Overlay | `--vscode-editorHoverWidget-background` | `graphEditor.ts` | Done |
| Graph legend edge swatches | hardcoded `#94a3b8` / `#a78bfa`, out of sync with the canvas | Legend | shared `EDGE_IMPORT_RGB` / `EDGE_CONTAINS_RGB` constants + `--prebase-edge-line` | `graphEditor.ts` | Fixed (A7) |
| Graph node / community / file-type colours | `#3178c6`, `#f1e05a`, `#a371f7`, `#e34c26`, … | Data encoding, not surfaces | **unchanged** — these carry meaning | `graphEditor.ts:434-437` | Intentional |
| Graph maps view (sidebar) | `#1e293b` / `#0f172a` / `#334155` / `#94a3b8` | Chrome / overlay | `PreBaseSurface.chrome` / `overlay`, `PreBaseBorder.*` | `prebaseMapsView.ts` | Done |
| Runtime Preview chrome | hardcoded fallbacks | Toolbar / inspector | `PreBaseSurface.*` roles | `runtimeEditor.ts`, `prebaseRuntimeView.ts` | Done |
| Runtime Preview *content* | — | User application | **not recoloured** — PreBase chrome stops at the iframe boundary | verified by inspection | Intentional |
| Magnus (agent) request block | unset → `transparent(editor.background, .62)` | Raised in-flow | Raised | `chat.requestBackground` `#2B2B2B` | Done |
| Magnus agent response area | unset | In flow, no card | **deliberately unstyled** — avoids "every agent operation is a `#303030` card" | — | Intentional |
| Magnus code blocks | unset | Content well | Deep | `textCodeBlock.background` `#1B1C1E` | Done |
| Magnus avatar | unset → `#1f1f1f` | Chip | Overlay | `#303030` | Done |
| Magnus / agents panel borders | `#303031` opaque | Separator | Subtle / default border | `#ffffff14` / `#ffffff2e` | Done |
| Magnus input focus ring | `#007ACC` (VS Code blue — wrong product accent) | Focus | Accent | `#2dd4bf` | Fixed |
| Inline chat widget / input | unset | Raised / input well | Raised / deep | `#2B2B2B` / `#1B1C1E` | Done |

## Pure-black classification

Every remaining `#000000` / `black` / `rgb(0,0,0)` occurrence in PreBase-owned,
non-archived, non-test code:

| Location | Value | Classification | Action |
| -------- | ----- | -------------- | ------ |
| `prebase_dark.json` `widget.shadow` | `#00000066` | (9) Transparent-black shadow | Keep |
| `prebaseHomeEditor.ts:552` `box-shadow` | `rgba(0,0,0,0.45)` | (9) Transparent-black shadow | Keep |
| `graphs/src/preserved/**` (3 occurrences) | various | (6) Preserved archive, excluded from the active runtime | Keep, excluded from typecheck and from the verifier |
| Upstream `scrollbar.shadow`, `hcDark` defaults across `src/vs/**` | `#000000` | (6) Upstream / (7) High Contrast semantic requirement | Keep — overriding these would break High Contrast |

There are **zero** opaque pure-black surfaces in the PreBase theme, and the
verifier fails the build if one is reintroduced.

## Regression protection

`scripts/theme/verify-surfaces.mjs`, wired into `npm run assurance:quick`:

1. Every literal in `prebase_dark.json` must be one of the four surfaces, the
   accent ramp, the foreground ramp, a translucent border, or an explicitly
   documented exception. All four surfaces must actually be used.
2. Opaque pure black is rejected as a theme value.
3. 42 foreground/background pairs are asserted against WCAG 2.2 AA (4.5:1 body,
   3.0:1 non-text). Ratios are truncated.
4. PreBase-owned UI source (`src/vs/workbench/contrib/prebase/browser`,
   `.../electron-browser`, `graphs/src/host`) is scanned for the 17 retired
   slate/navy literals and for opaque pure-black backgrounds. Shadows,
   translucent overlays, the preserved archive and tests are exempt.
5. `hc_black.json` / `hc_light.json` must not contain any PreBase surface, and
   `prebase_dark.json` must not `include` a High Contrast theme.
