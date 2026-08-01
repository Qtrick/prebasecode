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

## 8 — High Contrast Dark

`screenshots/11-high-contrast.png`

Switched at runtime through the normal `Preferences: Color Theme` picker, not
by editing settings, so this exercises the path a user takes.

* The workbench renders pure black with the High Contrast border treatment on
  every control, exactly as upstream intends.
* The PreBase Onboarding editor — a PreBase custom UI — follows: its card is
  black with a white outline and its buttons get High Contrast borders. This
  is the payoff from moving those editors off their own slate palette and onto
  workbench theme tokens; before this pass they would have painted their own
  greys over High Contrast.
* Pixel audit of the full frame: 920,298 pure-black pixels, and 176 pixels
  total matching any of the four PreBase surface values — all of them
  antialiasing fringes on text and borders, not surfaces.

## 9 — PreBase Home and keyboard focus

`screenshots/12-keyboard-focus.png`

* Changed surfaces: body `#1B1C1E`, recent-project card `#2B2B2B`, primary
  action on the `#2dd4bf` accent with `#1B1C1E` text (9.16:1), secondary
  actions on the raised surface.
* The screenshot was taken after five `Tab` presses with no mouse input. The
  focused recent-project card carries the `#2dd4bf` focus ring, which is
  7.6:1 against the `#2B2B2B` card behind it and comfortably clears the WCAG
  2.2 1.4.11 non-text contrast floor of 3:1. Focus rings were not softened
  anywhere in this pass; the accent ring is asserted against the editor,
  sidebar and menu surfaces by `verify:theme-surfaces`.
* Home is one of the editors that previously painted its own slate palette;
  the card here is a theme token, not a hardcoded value.

## 10 — Maps view controls, and what the review caught

`screenshots/14-maps-accent-ring.png`

* Changed surfaces: sidebar `#1F1F1F`, inactive filter chips and layout rows
  `#2B2B2B` with a `#ffffff14` boundary, the selected chip and the selected
  layout on the accent-tinted `list.activeSelectionBackground` with a `#22d3ee`
  ring.
* This screenshot exists because the whole-diff review found the ring was
  **not** being painted. Migrating the accent from a literal to a theme
  variable left two call sites appending an alpha suffix, producing
  `box-shadow: 0 0 0 1px var(--vscode-textLink-foreground)55`. That is invalid
  CSS, so the browser dropped the declaration and the active layout lost its
  ring silently. Measured in the running product after the fix, the selected
  layout reports `box-shadow: rgb(34, 211, 238) 0px 0px 0px 1px`; before it
  reported `none`.
* The same review found eight semantic roles in `prebaseSurfaces.ts` mapping to
  native tokens that are registered with a `null` default for at least one
  theme kind. Confirmed in the running product by switching to a theme that
  does not define `input.border`: the bare `var()` is invalid at
  computed-value time, so the `border` shorthand resets every longhand and
  nothing is painted, while the fallback chain resolves to `panel.border`
  (`rgba(128, 128, 128, 0.35)`) and paints the boundary the input needs.
  (Reading `borderColor` back reports `rgb(204, 204, 204)` in the broken case,
  but that is `currentColor` on a border whose style is now `none` — a red
  herring, not a visible outline.) Both behaviours are invisible under PreBase
  Night, which defines every one of those tokens, which is exactly why a
  screenshot audit of the default theme could not have caught it. The
  invariant is now a build gate rather than a comment: `verify:theme-surfaces`
  resolves all 916 `registerColor` defaults — including the inherited ones,
  where a colour's default is another colour, and wrappers like
  `transparent(x, .5)` — finds the 310 that are null under at least one theme
  kind, and walks every `var()` chain in PreBase-owned UI to check it bottoms
  out somewhere defined. Pointing that gate at the graph webview immediately
  found five more live High Contrast defects that no amount of reading had:
  the graph toolbar hover, the node-inspector buttons and their hover, and two
  widget shadows.

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
