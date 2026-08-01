# Dark UI Research — PreBase Night Surface Redesign

**Date researched:** 2026-08-01  
**Branch:** `main` @ `efabd9ed4abde12e0f79055cd63f0e5681c40abe`  
**Task:** Semantic dark-surface redesign + deep cleansing (not a product-direction change)

Language note: goals are **visual comfort**, reduced harshness, and clearer hierarchy — not medical claims.

---

## Official sources

| Source | URL | Date | Relevant principle |
|---|---|---|---|
| Apple HIG — Dark Mode | https://developer.apple.com/design/human-interface-guidelines/dark-mode | 2026-08-01 | Base vs elevated backgrounds; darker base recedes, lighter elevated advances; prefer semantic system colors over hardcoding |
| Apple WWDC19-808 | https://developer.apple.com/videos/play/wwdc2019/808/ | 2026-08-01 | Layered dark UIs use luminance for depth; shadows alone are weak in dark mode |
| Atlassian Elevation | https://atlassian.design/foundations/elevation | 2026-08-01 | Four planes: sunken → default → raised → overlay; higher elevation = lighter in dark mode; do not stack sunken on raised; avoid gray-box soup |
| Atlassian Design tokens | https://atlassian.design/foundations/tokens/design-tokens | 2026-08-01 | Semantic tokens, not raw hex scatter; themes (incl. HC) swap values under stable roles |
| GitHub Primer — Color usage | https://primer.style/product/getting-started/foundations/color-usage | 2026-08-01 | Functional tokens (`bgColor-default`, muted, emphasis); inverted neutral scales for light/dark; pair emphasis bg with on-emphasis fg |
| Primer primitives guide | https://github.com/primer/primitives/blob/main/DESIGN_TOKENS_GUIDE.md | 2026-08-01 | Never use raw hex in components; WCAG AA 4.5:1 text / 3:1 UI |
| VS Code Theme Color Reference | https://code.visualstudio.com/api/references/theme-color | 2026-08-01 | Workbench tokens are the native customization surface; `workbench.colorCustomizations` must keep working |
| VS Code Color Theme guide | https://code.visualstudio.com/api/extension-guides/color-theme | 2026-08-01 | Theme JSON `colors` + include chain; do not invent a parallel theme framework |
| WCAG 2.2 Contrast Minimum (1.4.3) | https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html | 2026-08-01 | Normal text ≥ 4.5:1; large text ≥ 3:1 |
| WCAG 2.2 Non-text Contrast (1.4.11) | https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html | 2026-08-01 | UI components / graphical objects ≥ 3:1 against adjacent colors |

### Additional products inspected (principles only; no branding copy)

| Product | Principle extracted |
|---|---|
| VS Code Dark Modern | Chrome slightly darker than editor (`#181818` / `#1F1F1F`); borders `#2B2B2B`; inputs lighter (`#313131`); active tab matches editor |
| GitHub (Primer dark) | Semantic surfaces (default/muted/inset/overlay); restrained borders; accessible fg hierarchy |
| Linear / JetBrains / Discord (spot) | Content wells deeper or equal; overlays distinctly lighter; avoid every panel as a card |

---

## Resulting design principles for PreBase

1. **Semantic roles, not hex scatter** — four supplied values are role defaults for PreBase Night only.
2. **Luminance hierarchy in dark mode** — deeper = recede (content wells); lighter = elevate (chrome structure / overlays).
3. **Native VS Code tokens** — change `prebase_dark.json` + `COLOR_THEME_DARK_INITIAL_COLORS`; custom panes consume `--vscode-*` / `asCssVariable`.
4. **Preserve accent** — teal `#2dd4bf` / `#5eead4` stays brand focus; do not gray-wash.
5. **Preserve syntax** — keep `"include": "./dark_plus.json"`; do not recolor TextMate tokens for chrome work.
6. **Preserve High Contrast** — do not edit `hc_*.json` or force Night grays over HC.
7. **Avoid gray-box soup** — raised/overlay only for real elevation or interaction; prefer spacing + restrained borders.
8. **Theme customization remains** — users keep `workbench.colorCustomizations` and alternate themes.
9. **Both graph types remain** on main; no ONE-GRAPH-TYPE import.
10. **Icons frozen** — no Dock/app icon changes.

---

## Current PreBase issue → decision

| Current issue | Decision | Rationale | A11y implication | Test required |
|---|---|---|---|---|
| Night chrome `#0a0a0b` / canvas `#101012` feel like pure-black voids | Map to semantic ladder `#1B1C1E`–`#303030` | Lift harshness; create adjacency contrast | Keep primary text ≥ 4.5:1 on all surfaces | Screenshot + contrast samples |
| Custom Home/Settings/graph CSS hardcode slate `#0b1220` | Migrate to theme CSS variables | Theme switches + HC must flow | Don’t hardcode dark-only without token path | Switch Night / Light / HC |
| Initial flash colors drift from theme JSON | Sync `COLOR_THEME_DARK_INITIAL_COLORS` | Cold start must match Night | N/A | Fresh profile launch |
| Risk of cloning Dark Modern | Keep PreBase teal + Night fg hierarchy | Product identity | N/A | Side-by-side vs Dark Modern |
| Risk of gray-box soup | Strict role→token table; sparse raised use | Visual comfort | Borders ≥ 3:1 where required | GUI acceptance |

---

## Approved semantic mapping (hypothesis → adopted for implementation)

Hypothesis from product brief adjusted after Checkpoint 1 + VS Code Dark Modern comparison:

| Role | Value | Primary uses | Prohibited misuse |
|---|---|---|---|
| **Deep / sunken** | `#1B1C1E` | Editor canvas, terminal body, empty editor wells, peek editor, graph canvas clear | Do not use for every chrome pane |
| **Default** | `#1F1F1F` | Activity bar, title bar, status bar, panel body, tab strip bg, inactive tabs | Do not use for floating overlays |
| **Raised** | `#2B2B2B` | Sidebar, section headers, major borders, secondary fills, welcome tiles | Do not card-wrap every Settings row |
| **Overlay / control** | `#303030` | Menus, quick input, editor widgets, inputs, dropdowns, notifications, popovers | Do not paint large page backgrounds |

**Active tab** matches **deep** (editor) so the tab connects to the canvas.  
**Inactive tab** sits on **default** chrome.  
**Tab hover** uses **overlay** (`#303030`), not default shell (avoids hover disappearing into the tab strip).  
**Peek results** use **raised**; peek editor stays **deep**.  
**Control borders** on overlay inputs use `#3C3C3C` (not a fifth page surface).

Deviation note vs early Checkpoint 1 draft: chrome was temporarily listed as deepest; research + brief prefer **content wells deepest**, chrome one step up, sidebar raised — closer to Atlassian sunken wells + user brief. Checkpoints 2–3 locked this mapping in `DARK_SURFACE_TOKENS.md` / Phase A plan.

---

## Related docs

- [DARK_UI_PHASE_A_PLAN.md](DARK_UI_PHASE_A_PLAN.md) — architecture + execution order (updated by checkpoints)
- [DARK_SURFACE_AUDIT.md](DARK_SURFACE_AUDIT.md) — surface inventory
- [DARK_SURFACE_TOKENS.md](DARK_SURFACE_TOKENS.md) — token map
- [DARK_UI_COMPARISON.md](DARK_UI_COMPARISON.md) — before/after screenshots
- [CLEANUP_AUDIT.md](CLEANUP_AUDIT.md) — non-visual cleansing tracker
