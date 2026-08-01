# Dark Surface Tokens — PreBase Night

**Date:** 2026-08-01  
**Applies to:** Default PreBase dark appearance (`PreBase Dark` / label PreBase Night)  
**Mechanism:** Native VS Code theme JSON + CSS variables — **not** a parallel token framework

---

## Palette (role defaults)

| Role | Dark default | Notes |
|---|---|---|
| Deep | `#1B1C1E` | Content wells |
| Default | `#1F1F1F` | App shell |
| Raised | `#2B2B2B` | Sidebar / separators / secondary fills |
| Overlay | `#303030` | Controls & floating UI |

Accent (unchanged): `#2dd4bf` focus/primary, `#5eead4` hover, `#22d3ee` links.

Foreground (Night hierarchy): primary `#f4f4f5`, secondary `#a1a1aa` (also placeholders), muted `#71717a` (line numbers / decorative only).

Control border (not a page surface): `#3C3C3C` on Overlay inputs/dropdowns.

---

## Token table

| Semantic role | Conceptual token | Dark default | Intended use | Prohibited misuse | Native VS Code mapping | Webview / CSS mapping | A11y |
|---|---|---|---|---|---|---|---|
| Deep Surface | `prebase.surface.deep` | `#1B1C1E` | Editor, terminal, empty wells, graph canvas, peek **editor** | Large chrome panels; peek **results** list | `editor.background`, `terminal.background`, `tab.activeBackground`, `tab.activeBorder`, `peekViewEditor.background`, `editorGroup.emptyBackground` | `var(--vscode-editor-background)` | Text ≥4.5:1 |
| Default Surface | `prebase.surface.default` | `#1F1F1F` | Activity/title/status/panel, tab strip, inactive tabs | Floating menus; tab hover | `activityBar.background`, `titleBar.activeBackground`, `titleBar.inactiveBackground`, `statusBar.background`, `statusBar.noFolderBackground`, `panel.background`, `editorGroupHeader.tabsBackground`, `tab.inactiveBackground`, `debugToolBar.background`, `dropdown.listBackground` | `var(--vscode-panel-background)` / activityBar | Text ≥4.5:1 |
| Raised Surface | `prebase.surface.raised` | `#2B2B2B` | Sidebar, section headers, tiles, secondary fills, major borders, peek results | Page-wide background; every Settings row as a card | `sideBar.background`, `sideBarSectionHeader.background`, `peekViewResult.background`, `*.border` (many), `welcomePage.tileBackground`, `badge.background` (only if fg contrast OK) | `var(--vscode-sideBar-background)` | Boundary ≥3:1 where required |
| Overlay Surface | `prebase.surface.overlay` | `#303030` | Menus, notifications, quick input, widgets, tab hover | Editor canvas / large chrome | `menu.background`, `notifications.background`, `quickInput.background`, `editorWidget.background`, `editorHoverWidget.background`, `editorSuggestWidget.background`, `tab.hoverBackground`, `tab.unfocusedHoverBackground` | `var(--vscode-editorWidget-background)` / menu | Text ≥4.5:1 |
| Hover Surface | `prebase.surface.hover` | Overlay `#303030` or low-alpha on Raised | List/toolbar/tab hover | Sole selection indicator; page bg | `list.hoverBackground`, `toolbar.hoverBackground`, `tab.hoverBackground` | theme list hover var | Non-text ≥3:1 |
| Active Surface | `prebase.surface.active` | pressed delta | Pressed toolbar/buttons | Resting page bg | `toolbar.activeBackground`, button active | theme vars | Distinguish from hover |
| Selected Surface | `prebase.surface.selected` | accent + list selection | Lists, tabs active top border | Color-only without focus | `list.activeSelectionBackground`, `tab.activeBorderTop` (`#5eead4`) | list selection vars | Not color-only |
| Input Surface | `prebase.surface.input` | `#303030` (= Overlay) | Inputs, dropdowns, checkboxes | Matching parent with no border | `input.background`, `dropdown.background`, `checkbox.background`, `settings.dropdownBackground` | `var(--vscode-input-background)` | Visible vs parent |
| Subtle Border | `prebase.border.subtle` | low-alpha / `#2B2B2B` | Soft separators | Focus rings | `widget.border`, restrained separators | `var(--vscode-widget-border)` | Optional |
| Default Border | `prebase.border.default` | `#2B2B2B` (= Raised) on default/deep fills; sidebar groove `#1F1F1F` | Pane separators against a **different** fill | Same-as-fill “borders”; decorative grids | `panel.border`, `tab.border`, `titleBar.border`, `activityBar.border`, `notifications.border`, `sideBar.border` (`#1F1F1F`) | `var(--vscode-panel-border)` / `var(--vscode-sideBar-border)` | ≥3:1 when sole boundary |
| Control Border | `prebase.border.control` | `#3C3C3C` | Input/dropdown/checkbox/widget edges on Overlay | Large pane separators | `input.border`, `dropdown.border`, `checkbox.border`, `settings.dropdownBorder`, `pickerGroup.border`, `widget.border` | `var(--vscode-input-border)` / `var(--vscode-widget-border)` | Visible vs `#303030` parent |
| Focus Border | `prebase.border.focus` | `#2dd4bf` | Keyboard focus | Decorations only | `focusBorder`, `statusBar.focusBorder` | `var(--vscode-focusBorder)` | Always visible |
| Primary Foreground | `prebase.foreground.primary` | `#f4f4f5` | Body text, status bar | Decorative chrome | `foreground`, `editor.foreground`, `statusBar.foreground` | `var(--vscode-foreground)` | ≥4.5:1 |
| Secondary Foreground | `prebase.foreground.secondary` | `#a1a1aa` | Descriptions, inactive tabs, input placeholders | Primary labels | `descriptionForeground`, `tab.inactiveForeground`, `input.placeholderForeground` | `var(--vscode-descriptionForeground)` | ≥4.5:1 preferred |
| Muted Foreground | `prebase.foreground.muted` | `#71717a` | Line numbers (decorative) | Essential body text / placeholders | `editorLineNumber.foreground` | line-number vars | Do not use for required copy |
| Disabled Foreground | `prebase.foreground.disabled` | theme disabled | Disabled controls | Active labels / hints | VS Code disabled tokens | disabled vars | Distinguishable from muted |

Conceptual names are documentation aids. **Implementation uses native VS Code color IDs**; do not register a second PreBase color registry for these surfaces unless a gap is proven.

---

## High Contrast

- Do not override HC themes with Night grays.
- Custom PreBase panes must read CSS variables so HC/light themes flow through.
- Opaque surfaces preferred over transparency for critical boundaries.

## Gray-box / adjacency guards

1. **Four roles max for large planes** — Deep / Default / Raised / Overlay. `#3C3C3C` is a **control border** only, not a fifth page surface.
2. **Sparse Raised** — sidebar + real secondary fills + major separators; do not card-wrap every Settings/Home row.
3. **Same hex twice is OK only with role discipline** — e.g. Input = Overlay (`#303030`); Default Border = Raised (`#2B2B2B`) when separating against a different fill.
4. **Hover ≠ Default** — `tab.hoverBackground` must read as Overlay (or documented alpha), never Default shell.
5. **Peek hierarchy** — peek editor Deep; peek results Raised (avoid two Deep panes side by side).
6. **HC / light** — never hardcode Night ladder hex in custom panes; use `--vscode-*` so themes flow.
