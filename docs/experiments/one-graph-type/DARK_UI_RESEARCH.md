# Dark UI Research — PreBase layered dark surface system

Branch: `One-Graph-Type` (working branch `cursor/dark-surface-system-and-cleansing-7041`).

This document records the primary-source research behind the PreBase dark surface
system and the decisions taken from it. It is the rationale companion to
[`DARK_SURFACE_TOKENS.md`](./DARK_SURFACE_TOKENS.md) (the token map) and
[`DARK_SURFACE_AUDIT.md`](./DARK_SURFACE_AUDIT.md) (the surface inventory).

## Scope and honest framing

The objective is **visual comfort and hierarchy**, not a health claim. Dark mode
is not an "eye strain guarantee". What this work claims:

- fewer very large maximum-contrast (near-black against bright white) fields,
- a readable depth order so the eye can locate content versus chrome,
- accessibility preserved or improved (measured, not asserted).

What it does **not** claim: any medical or ophthalmic benefit.

## Sources

| # | Source | Consulted |
| - | ------ | --------- |
| 1 | Apple Human Interface Guidelines — Dark Mode (`developer.apple.com/design/human-interface-guidelines/dark-mode`) | Yes (page is JS-rendered; content retrieved via the indexed mirror and Apple WWDC19 session 808 "What's New in iOS Design", which states the same base/elevated model) |
| 2 | Apple Human Interface Guidelines — Color | Yes |
| 3 | Atlassian Design System — Elevation (`atlassian.design/foundations/elevation/`) | Yes (full page) |
| 4 | GitHub Primer — Color usage (`primer.style/product/getting-started/foundations/color-usage/`) | Yes (full page) |
| 5 | VS Code — Theme Color Reference (`code.visualstudio.com/api/references/theme-color`) plus the authoritative in-repo registry (`src/vs/platform/theme/common/colors/*.ts`, `src/vs/workbench/common/theme.ts`) | Yes |
| 6 | W3C WCAG 2.2 (`w3.org/TR/WCAG22/`) — 1.4.3, 1.4.11, 2.4.7, 2.4.11 | Yes (full spec text) |
| 7 | Comparable applications: VS Code Dark Modern / Dark+ (in-repo theme JSON, directly inspectable), GitHub Primer dark scale (documented), Atlassian dark elevation (documented) | Yes |

Applications that are **not** directly inspectable (Xcode, JetBrains, Linear,
Figma, Discord, Notion, Slack) were deliberately not reverse-engineered. Only
published principles were used; no palette was copied.

## Findings and decisions

### 1. Apple HIG — base vs elevated backgrounds

**Principle.** "In Dark Mode, the system uses two sets of background colors —
called *base* and *elevated* — to enhance the perception of depth when one dark
interface is layered above another. The base colors are dimmer, making
background interfaces appear to recede, and the elevated colors are brighter,
making foreground interfaces appear to advance." Apple also insists on
*semantic* colors (`labelColor`, `controlColor`, `separator`) over hard-coded
values, and on re-checking legibility with **Increase Contrast** and **Reduce
Transparency** enabled, because both can *reduce* perceived contrast between
dark text and dark backgrounds.

**Relevance to PreBase.** The workbench layers content wells (editor, terminal,
graph canvas) under chrome (sidebar, tabs, panel) under transient surfaces
(menus, hovers, quick input).

**Decision.**
- Two "base" values, not one: `#1B1C1E` for content wells and `#1F1F1F` for the
  structural chrome frame. Content recedes below chrome rather than matching it.
- Two "elevated" values: `#2B2B2B` (raised, in-flow) and `#303030` (overlay,
  out-of-flow / transient).
- No raw hex in component code. Every PreBase custom editor reads
  `--vscode-*` theme variables through
  `src/vs/workbench/contrib/prebase/browser/prebaseSurfaces.ts`.
- High Contrast themes are explicitly excluded from the palette and this is
  enforced by `npm run verify:theme-surfaces`.

**Rationale.** Apple's model maps cleanly onto a four-step palette and it is the
model macOS users already read subconsciously, which matters because PreBase
ships on macOS.

### 2. Atlassian — four elevation levels, and restraint

**Principle.** Atlassian defines exactly four levels — *sunken*, *default*,
*raised*, *overlay* — plus an overflow shadow. In dark theme, "shadows can be
harder to see, so dark mode elevations also rely on different surface colors …
the higher the elevation, the lighter the surface looks." Crucially: "Raised
elevations can create visual noise, so don't use to group content when a border
or white space would suffice", "Only use sunken surfaces on the default surface
level", and "Avoid excessive use of raised and overlay elevations".

**Relevance to PreBase.** This is the direct antidote to the "gray box soup"
failure mode: four grays used indiscriminately produce a field of disconnected
rectangles.

**Decision.**
- The four supplied colours are mapped 1:1 onto Atlassian's four levels
  (`#1B1C1E` sunken, `#1F1F1F` default, `#2B2B2B` raised, `#303030` overlay).
- Sunken is only used **inside** default chrome (editor inside the editor group,
  terminal inside the panel, inputs inside a raised widget). It is never nested
  inside raised or overlay surfaces.
- Grouping that does not represent elevation uses a border
  (`#ffffff14`) or spacing, never a surface change. Concretely:
  `sideBarSectionHeader.background` stays equal to `sideBar.background` and is
  separated by a 1px translucent border, instead of becoming a third gray.
- Overlay (`#303030`) is reserved for genuinely out-of-flow UI: menus,
  dropdown lists, hovers, suggest/quick-input title, debug toolbar, breadcrumb
  picker, the floating graph inspector.

**Rationale.** Restraint is what makes elevation legible. If every container is
raised, nothing is.

### 3. Atlassian — interaction states come from surface deltas

**Principle.** Atlassian drives hover/pressed from *surface* tokens
(`elevation.surface.hovered` / `.pressed`) rather than ad-hoc opacity per
component, and warns against combining elevation transitions *and* hover tokens.

**Decision.** One consistent hover ladder rather than per-component opacity:

| Rest | Hover | Active / pressed |
| ---- | ----- | ---------------- |
| `#1F1F1F` (chrome) | `#2B2B2B` | `#303030` |
| `#2B2B2B` (raised) | `#303030` | accent-tinted `#134e4a` |

Small icon buttons that sit on an unknown surface use a translucent wash
(`#ffffff1a`) instead of a fixed gray, so one value reads correctly on all four
surfaces. Selection is an accent-tinted surface (`#134e4a`), not "a brighter
gray", so selected is never confused with hovered.

### 4. GitHub Primer — token layering, and "never raw values in components"

**Principle.** Primer separates *base* tokens (raw scale values, "should never
be used directly in code or design"), *functional* tokens (`bgColor-default`,
`bgColor-muted`, `borderColor-*`, `fgColor-*`), and *component* tokens. The
first six steps of the neutral scale are backgrounds, steps 7–8 are borders and
dividers, steps 9–10 are text and icons. Contrast is calculated against
`bgColor-muted` so both `muted` and `default` pass. High-contrast themes shift
the whole window up the scale and target 7:1.

**Decision.**
- PreBase mirrors the three-tier structure but implements it with the mechanism
  the product already has, rather than a parallel framework: the *base* tier is
  the four hex values, the *functional* tier is the VS Code theme token set in
  `extensions/theme-defaults/themes/prebase_dark.json`, and the *component*
  tier is `prebaseSurfaces.ts`, which exposes `PreBaseSurface`, `PreBaseBorder`,
  `PreBaseForeground` and `PreBaseControl` as `var(--vscode-*)` strings.
- Contrast is measured against the **lightest** surface a foreground can land on
  (`#303030`), not the darkest, so every pair passes everywhere. This is
  Primer's `bgColor-muted` rule restated for a dark-only palette.
- Borders are translucent white (`#ffffff14` subtle, `#ffffff2e` default) rather
  than opaque grays. One value then reads correctly on all four surfaces and
  cannot invert when a user overrides a surface.
- Three foreground steps only: `#f4f4f5` primary, `#a1a1aa` secondary,
  `#8b8b93` muted, plus `#71717a` for disabled (which WCAG 1.4.3 exempts).

**Rationale.** Primer's "never use base tokens in components" is exactly the
constraint that keeps this from degenerating into scattered hex; it is now a
machine-checked rule, not a convention.

### 5. VS Code — the theme token registry is the integration surface

**Principle.** VS Code resolves a colour by looking, in order, at
`workbench.colorCustomizations`, the active theme JSON (including its `include`
chain), and then the registered default for the current theme kind
(`dark` / `light` / `hcDark` / `hcLight`). Any token the theme does not set
falls back to an upstream default that knows nothing about the PreBase palette.

**Relevance to PreBase.** Getting the surface system "right" is therefore not
about how many tokens are set, but about which *unset* tokens leak a foreign
value into a large surface.

**Decision.**
- `prebase_dark.json` sets 235 tokens and `include`s `dark_plus.json`. A script
  (`scripts/theme/verify-surfaces.mjs`) resolves the full `include` chain and
  the upstream registry, and the residual leakage was driven down to seven
  inherited values, all of which are *content* markers rather than surfaces:
  `editor.inactiveSelectionBackground`, `editor.selectionHighlightBackground`,
  `editorIndentGuide.background1` / `.activeBackground1`,
  `terminal.inactiveSelectionBackground`, `tab.lastPinnedBorder`,
  `ports.iconRunningProcessForeground`.
- Foreign *surfaces* that would otherwise have leaked in were mapped onto the
  palette: `tab.selectedBackground` (`#222222` → `#2B2B2B`),
  `list.dropBackground` (`#383B3D` → `#303030`),
  `actionBar.toggledBackground` (`#383a49` → `#303030`),
  `multiDiffEditor.headerBackground` (`#262626` → `#2B2B2B`),
  `terminalStickyScroll.background` and `editorStickyScrollGutter.background`
  (`#2A2D2E` → `#1F1F1F`), `profileBadge.background` (`#4D4D4D` → `#303030`),
  `editor.inactiveLineHighlightBackground` (`#282828` → `#1F1F1F`), and the
  agent-panel borders (`#303031` → `#ffffff2e`) plus
  `agentsChatInput.focusBorder` (`#007ACC` → the PreBase accent).
- Syntax highlighting is inherited unchanged from Dark+. Only UI surfaces moved.

**Observation from Dark Modern (in-repo, directly inspectable).** VS Code's own
current default deliberately gives the activity bar, sidebar, title bar, status
bar and tab strip the *same* value and separates them with 1px borders, while
the editor sits one step darker. PreBase adopts that structural idea — a single
chrome slab at `#1F1F1F` around a `#1B1C1E` content well — instead of giving
every pane its own gray.

### 6. W3C WCAG 2.2

**Requirements applied.**
- **1.4.3 Contrast (Minimum), AA** — 4.5:1 for normal text, 3:1 for large text
  (≥18pt, or ≥14pt bold). Incidental and disabled text is exempt.
- **1.4.11 Non-text Contrast, AA** — 3:1 for the parts of UI components needed
  to identify them, and for meaningful graphics.
- **2.4.7 Focus Visible** and **2.4.11 Focus Not Obscured (Minimum)** — keyboard
  focus must stay visible and unobscured.

**Decision.**
- 42 measured foreground/background pairs are asserted in
  `scripts/theme/verify-surfaces.mjs` and run in `npm run assurance:quick`.
  Ratios are truncated, never rounded up. Lowest passing body-text pair is
  5.04:1 (`input.placeholderForeground` on `input.background`); the accent focus
  ring measures 7.09:1 against its worst case (`menu.background`).
- The disabled foreground `#71717a` is the only value below 4.5:1 and is
  documented as WCAG-1.4.3-exempt in the allowlist.
- Focus is a solid 2px accent ring (`focusBorder` `#2dd4bf`), unchanged in
  weight from before. Softening focus for aesthetics was explicitly rejected.
- High Contrast Dark and High Contrast Light are untouched, and
  `verify:theme-surfaces` fails the build if any of the four surfaces appears in
  `hc_black.json` / `hc_light.json`, or if `prebase_dark.json` ever `include`s
  a High Contrast theme.

**Note on input borders.** `input.border` (`#ffffff2e` over `#1B1C1E`) does not
by itself reach 3:1. That is acceptable under 1.4.11 because the border is not
the only means of identifying the control: the input fill (`#1B1C1E`) always
differs from its containing surface (`#1F1F1F`, `#2B2B2B` or `#303030`), and
focus adds the 7:1+ accent ring. The alternative — a 3:1 opaque outline on every
field — is precisely the "bright gray grid" the brief rules out.

### 7. Cross-application principles extracted

Only principles, never palettes:

| Principle | Source | Applied as |
| --------- | ------ | ---------- |
| Content is the darkest layer; chrome sits above it | Apple, VS Code Dark Modern | `editor`/`terminal`/graph canvas `#1B1C1E` under chrome `#1F1F1F` |
| Elevation is brightness in dark mode, not just shadow | Atlassian, Apple | `#2B2B2B` raised, `#303030` overlay, shadow retained but secondary |
| The active tab belongs to the content, not to the strip | VS Code Dark Modern | `tab.activeBackground` = `editor.background` = `#1B1C1E`; inactive tabs = strip `#1F1F1F` |
| Group with borders and whitespace before reaching for a surface | Atlassian, Primer | `sideBarSectionHeader` shares the sidebar surface + `#ffffff14` border |
| Never use base values directly in components | Primer | `prebaseSurfaces.ts` + a lint-style source scan in `verify-surfaces.mjs` |
| Measure contrast against the lightest surface the text can land on | Primer | 42 asserted pairs, worst case computed on `#303030` |
| Selection is semantic, not "lighter" | Primer, Atlassian | accent-tinted `#134e4a` for selection, gray only for hover |
| Re-test with Increase Contrast / Reduce Transparency | Apple | High Contrast themes excluded and guarded; no surface depends on translucency |

## Rejected options

- **Global `#000000` → `#1F1F1F` replacement.** Rejected: destroys hierarchy and
  would also rewrite shadows, syntax colours and third-party content.
- **A fifth or sixth gray** for section headers and list rows. Rejected under
  Atlassian's restraint guidance; borders and whitespace do that job.
- **Changing `editor.selectionBackground` to the teal accent.** Rejected: Dark+
  syntax colours are tuned against `#264F78` and re-tuning syntax was out of
  scope and higher risk than the benefit.
- **Exposing "PreBase Surface Color 1..4" settings.** Rejected per the brief;
  users customise through `workbench.colorCustomizations`, which still works
  because every surface is a real theme token.
