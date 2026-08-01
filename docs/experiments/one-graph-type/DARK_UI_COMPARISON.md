# PreBase dark surface redesign — before / after

Captured from the running product, not from theme source. Both runs used the
same build, the same workspace (`/workspace`), the same window size
(1440×900) and a fresh throwaway profile; only
`extensions/theme-defaults/themes/prebase_dark.json` differed. Colours quoted
below are the dominant pixel value of a sampled region of the screenshot, so
they are what the compositor actually painted.

Screenshots live in `screenshots/`.

## The problem the pass was solving

The pre-pass theme was not "pure black everywhere", but it was close enough to
behave like it. Chrome was `#0a0a0b` and content was `#101012` — a three-point
separation that reads as one undifferentiated dark mass — and every elevated
surface (menus, dropdowns, notifications, peek views) was painted `#101012`
too, so elevation was communicated *only* by a hard `#454545` outline. Primary
text at `#f4f4f5` on `#0a0a0b` is a 19.4:1 luminous step.

## Surface measurements

| Surface | Before | After | Role after |
| --- | --- | --- | --- |
| Title bar | `#0A0A0B` | `#1F1F1F` | default chrome |
| Activity Bar | `#0A0A0B` | `#1F1F1F` | default chrome |
| Side Bar | `#0A0A0B` | `#1F1F1F` | default chrome |
| Auxiliary bar (Agents) | `#0A0A0B` | `#1F1F1F` | default chrome |
| Status bar | `#0A0A0B` | `#1F1F1F` | default chrome |
| Tab strip | `#0A0A0B` | `#1F1F1F` | default chrome |
| Panel header row | `#0A0A0B` | `#1F1F1F` | default chrome |
| Editor canvas | `#101012` | `#1B1C1E` | deep well |
| Active tab | `#101012` | `#1B1C1E` | deep well (continuous with canvas) |
| Breadcrumbs | `#101012` | `#1B1C1E` | deep well |
| Terminal body | `#101012` | `#1B1C1E` | deep well |
| Graph canvas | `#101012` | `#1B1C1E` | deep well |
| Graph legend / toolbar / status pill | `#0f172a` family | `#2B2B2B` | raised |
| Command Center pill | `#161618` | `#2B2B2B` | raised |
| Quick input / command palette | `#161618` | `#2B2B2B` | raised |
| Context menu | `#101012` | `#303030` | overlay |

## 1 — Workbench, project open

`screenshots/00-before-workbench.png` → `screenshots/02-workbench-after.png`

* Changed surfaces: every chrome surface moved from `#0a0a0b` to `#1F1F1F`;
  the editor well moved from `#101012` to `#1B1C1E`.
* Rationale: the whole interface now sits above the "near-black" band, which
  cuts the luminous step to primary text from 19.4:1 to 15.0:1 while staying
  far above the WCAG 2.2 AA 4.5:1 floor. The chrome/content relationship is
  preserved (chrome lighter, content deeper) rather than inverted.
* Accessibility: `foreground` on `sideBar.background` 14.99:1;
  `descriptionForeground` 6.43:1; `activityBar.inactiveForeground` 4.87:1
  (AA for body text, not just the 3:1 non-text floor).
* Remaining: the chrome band is a single value across title bar, Activity Bar,
  Side Bar and status bar. This is deliberate — see "Rejected: lighter
  sidebar" below.

## 2 — Editor with a TypeScript file

`screenshots/06-editor.png`

* Changed surfaces: canvas `#1B1C1E`, active tab `#1B1C1E` (flush with the
  canvas), inactive tabs `#1F1F1F`, tab strip `#1F1F1F`.
* Rationale: the active tab is continuous with the document it opens, so the
  tab strip reads as a cut-out rather than a row of buttons. Inactive tabs sit
  on the chrome plane and are separated from the active one by a 4-point
  surface step plus the `#5eead4` top border, not by brightness alone.
* Syntax highlighting is inherited unchanged from `dark_plus`; comments,
  strings, keywords and numbers were checked against the new canvas and all
  remain legible. No token colour was modified.
* Remaining: none observed.

## 3 — Terminal panel

`screenshots/07-panel-terminal.png`

* Changed surfaces: panel header row `#1F1F1F`, terminal body `#1B1C1E`.
* Rationale: the terminal is a content well like the editor, so it gets the
  deep surface; the panel's own header stays on the chrome plane so the panel
  reads as attached to the workbench rather than floating.
* ANSI colours are untouched. Prompt, hyperlink and dim text were checked
  against `#1B1C1E`.
* Remaining: none observed.

## 4 — Command palette / quick input

`screenshots/04-command-palette.png`, `screenshots/04b-quick-open.png`

* Changed surfaces: widget body `#161618` → `#2B2B2B`; the search field inside
  it is the deep surface `#1B1C1E`, i.e. a sunken input on a raised container.
* Rationale: this is the one place where an input is guaranteed to be
  surrounded by a raised surface, so sinking it is both the clearest
  affordance and what keeps `input.placeholderForeground` (`#8b8b93`) at
  5.04:1 — it would fall to 4.18:1 on `#2B2B2B` and fail AA.
* Selected row uses the accent-tinted `#134e4a` rather than "a lighter grey",
  so selection is a semantic state, not another elevation step.

## 5 — Context menu

`screenshots/00-before-context-menu.png` → `screenshots/10-context-menu.png`

This is the clearest single improvement.

* Before: menu `#101012` over a `#0A0A0B` sidebar — a 6-point step. The menu
  only read as a separate object because of a hard `#454545` outline, so it
  looked like a hole punched in the sidebar.
* After: menu `#303030` over `#1F1F1F` — a 17-point step, plus a translucent
  `#ffffff2e` border and the existing shadow. The menu reads as floating and
  the border can be subtle instead of load-bearing.

## 6 — Code Graph

`screenshots/08-graph.png`

* Changed surfaces: canvas `#1B1C1E` (measured), legend / zoom toolbar /
  status pill `#2B2B2B` (measured).
* Rationale: the graph canvas is the deepest content in the product, so node
  and edge colours have the most room. The overlays sit two steps above it,
  which is what lets them be read as controls floating over the scene without
  needing opaque panels or heavy outlines.
* Node community colours and edge colours were not changed. Edge styles
  (extracted solid / inferred dashed / ambiguous dotted) and the legend
  swatches now come from one shared constant, so the legend cannot drift from
  what the canvas draws — previously the legend hardcoded `#94a3b8` while the
  canvas drew something else.
* Remaining: the legend is a tall fixed panel that overlaps the scene at small
  window sizes. That is pre-existing layout behaviour, not a colour problem,
  and is out of scope here.

## 7 — Settings

`screenshots/09-settings.png`

* Changed surfaces: body `#1B1C1E`, floating-window title bar `#1F1F1F`,
  text/number inputs `#1B1C1E` with a `#ffffff2e` border, dropdowns `#2B2B2B`.
* Rationale: settings render on the editor plane, so the body is the deep
  surface. Inputs keep the sunken model for placeholder contrast (above);
  because the body is also the deep surface they rely on their border, which
  is why the border role is `#ffffff2e` (the stronger of the two) rather than
  the subtle `#ffffff14`.
* Remaining: an input and its container share a value here. It is compliant
  (there is a border) but it is the weakest affordance in the product. Raising
  the input is blocked on the placeholder contrast result above; the honest
  fix is a lighter muted foreground, which is a separate change.

## Rejected: lighter sidebar

The starting hypothesis put the sidebar on `#2B2B2B`. It was tried and
reverted:

* `#2B2B2B` over a large area collides with the raised role. Once the sidebar
  is `#2B2B2B`, quick input, notifications, the Command Center pill and the
  graph overlays are no longer visibly raised relative to what is behind them,
  and the only remaining elevation step is `#303030` — which then has to carry
  both "raised" and "overlay". That is the "gray box soup" failure mode.
* Both Apple's dark-mode guidance and Atlassian's elevation guidance treat
  elevation as something a *few* surfaces earn, not a property of large
  structural areas. Primer likewise keeps `canvas.default` and
  `canvas.inset` close together and reserves `canvas.overlay` for popovers.

The same reasoning was applied to `sideBarSectionHeader.background`: raising
collapsed section headers to `#2B2B2B` was tried and reverted, because it puts
a band of raised surface on every collapsed view in the Explorer for no
elevation meaning. The headers keep their `#ffffff14` border instead.

## What did not change

* Syntax highlighting: inherited from `dark_plus`, unmodified.
* High Contrast Dark / Light: untouched, and `verify:theme-surfaces` fails the
  build if any PreBase surface value appears in `hc_black.json` /
  `hc_light.json`.
* Runtime Preview page content: PreBase only themes the chrome around the
  preview; nothing is injected into the previewed application.
* `workbench.colorCustomizations` and third-party themes keep working — every
  value in this pass is a standard theme token, and no PreBase component
  hardcodes a surface any more (enforced by `verify:theme-surfaces`).
