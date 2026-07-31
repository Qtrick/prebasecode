# PreBase Dark Surface Token Map

Canonical definition of the PreBase layered dark surface system. Rationale lives
in [`DARK_UI_RESEARCH.md`](./DARK_UI_RESEARCH.md); the per-surface inventory
lives in [`DARK_SURFACE_AUDIT.md`](./DARK_SURFACE_AUDIT.md).

Three tiers, following the GitHub Primer structure:

1. **Base values** — the four supplied hex values plus the accent, foreground and
   border ramps. These may only appear in
   `extensions/theme-defaults/themes/prebase_dark.json`.
2. **Functional tokens** — native VS Code theme tokens. This is the only layer a
   theme author, a `workbench.colorCustomizations` entry, or a High Contrast
   theme interacts with.
3. **Component roles** — `src/vs/workbench/contrib/prebase/browser/prebaseSurfaces.ts`,
   which exposes each role as a `var(--vscode-*)` string for PreBase's custom
   editors and webviews.

`npm run verify:theme-surfaces` (part of `npm run assurance:quick`) enforces
tiers 1 and 3 and asserts 42 contrast pairs.

## Surface roles

| Role | Component role (`prebaseSurfaces.ts`) | Hex | Primary native tokens | Usage | Must **not** be used for |
| ---- | ------------------------------------- | --- | --------------------- | ----- | ------------------------ |
| **Deep / sunken** | `PreBaseSurface.deep` → `--vscode-editor-background` | `#1B1C1E` | `editor.background`, `editorPane.background`, `editorGroup.emptyBackground`, `terminal.background`, `peekViewEditor.background`, `tab.activeBackground`, `input.background`, `settings.textInputBackground`, `breadcrumb.background`, `textCodeBlock.background`, `welcomePage.background`, `inlineChatInput.background`, `walkThrough.embeddedEditorBackground` | Content wells: editor canvas, graph canvas, terminal body, code blocks, input wells, the active tab (so it reads as part of the content) | Chrome, cards, menus, popovers, or anything nested inside a raised/overlay surface |
| **Default chrome** | `PreBaseSurface.chrome` → `--vscode-sideBar-background` | `#1F1F1F` | `sideBar.background`, `sideBarSectionHeader.background`, `activityBar.background`, `activityBarTop.background`, `titleBar.activeBackground`, `titleBar.inactiveBackground`, `statusBar.background`, `panel.background`, `editorGroupHeader.tabsBackground`, `tab.inactiveBackground`, `editorStickyScroll.background`, `peekViewResult.background`, `editor.inactiveLineHighlightBackground` | The structural frame around content: activity bar, sidebar, tab strip, panel body, title bar, status bar | Content wells, floating surfaces, or hover feedback |
| **Raised** | `PreBaseSurface.raised` → `--vscode-editorWidget-background` | `#2B2B2B` | `editorWidget.background`, `quickInput.background`, `notifications.background`, `notificationCenterHeader.background`, `dropdown.background`, `panelSectionHeader.background`, `peekViewTitle.background`, `badge.background`, `banner.background`, `keybindingLabel.background`, `commandCenter.background`, `welcomePage.tileBackground`, `list.hoverBackground`, `tab.hoverBackground`, `toolbar.hoverBackground`, `chat.requestBackground`, `inlineChat.background`, `multiDiffEditor.headerBackground`, `tab.selectedBackground`, `button.secondaryBackground` | In-flow elevation: find widget, notifications, quick input body, cards and tiles, panel section headers, the agent request block, and hover feedback on a chrome surface | Grouping that could be expressed with a border or whitespace; page-level backgrounds |
| **Overlay** | `PreBaseSurface.overlay` → `--vscode-editorHoverWidget-background` | `#303030` | `menu.background`, `dropdown.listBackground`, `editorHoverWidget.background`, `editorSuggestWidget.background`, `quickInputTitle.background`, `breadcrumbPicker.background`, `debugToolBar.background`, `toolbar.activeBackground`, `commandCenter.activeBackground`, `statusBarItem.prominentBackground`, `welcomePage.tileHoverBackground`, `list.dropBackground`, `actionBar.toggledBackground`, `profileBadge.background`, `chat.avatarBackground`, `button.secondaryHoverBackground` | Out-of-flow, transient surfaces: context menus, dropdown lists, hovers, suggest widget, floating toolbars, the floating graph inspector; and pressed/active feedback on a raised surface | Persistent page chrome; large static regions; "every card" |

### Interaction states

| State | On chrome (`#1F1F1F`) | On raised (`#2B2B2B`) | Token |
| ----- | --------------------- | --------------------- | ----- |
| Hover | `#2B2B2B` | `#303030` | `list.hoverBackground`, `tab.hoverBackground`, `toolbar.hoverBackground`, `welcomePage.tileHoverBackground` |
| Hover (surface-agnostic icon buttons) | `#ffffff1a` wash | `#ffffff1a` wash | `statusBarItem.hoverBackground`, `inputOption.hoverBackground` |
| Active / pressed | `#303030` | `#303030` | `toolbar.activeBackground`, `commandCenter.activeBackground`, `actionBar.toggledBackground` |
| Selected | `#134e4a` (accent tinted) | `#134e4a` | `list.activeSelectionBackground`, `quickInputList.focusBackground`, `editorSuggestWidget.selectedBackground`, `peekViewResult.selectionBackground` |
| Keyboard focus (no selection) | `#2B2B2B` | `#2B2B2B` | `list.focusBackground` |
| Focus ring | `#2dd4bf` | `#2dd4bf` | `focusBorder`, `sash.hoverBorder`, `statusBarItem.focusBorder`, `agentsChatInput.focusBorder`, `inlineChatInput.focusBorder` |

Selection is deliberately accent-tinted rather than "one gray lighter", so a
selected row can never be mistaken for a hovered row.

### Input surfaces

| Role | Hex | Tokens | Note |
| ---- | --- | ------ | ---- |
| Input well | `#1B1C1E` | `input.background`, `settings.textInputBackground`, `settings.numberInputBackground`, `checkbox.background`, `inlineChatInput.background` | Always one step **darker** than its container, so the field is identifiable by fill, not only by border |
| Input border | `#ffffff2e` | `input.border`, `settings.textInputBorder`, `panelInput.border`, `checkbox.border` | Supporting affordance; see the WCAG 1.4.11 note in `DARK_UI_RESEARCH.md` |
| Placeholder | `#8b8b93` | `input.placeholderForeground` | 5.04:1 on the input well |
| Dropdown (closed) | `#2B2B2B` | `dropdown.background` | Raised, because a closed select is in flow |
| Dropdown (open list) | `#303030` | `dropdown.listBackground` | Overlay, because the list is out of flow |

## Border roles

| Role | Hex | Tokens | Usage | Must **not** be used for |
| ---- | --- | ------ | ----- | ------------------------ |
| Subtle border | `#ffffff14` (8% white) | `activityBar.border`, `sideBar.border`, `sideBarSectionHeader.border`, `panel.border`, `panelSectionHeader.border`, `statusBar.border`, `titleBar.border`, `tab.border`, `editorGroup.border`, `editorGroupHeader.tabsBorder`, `editorStickyScroll.border`, `pickerGroup.border`, `welcomePage.tileBorder`, `chat.requestBorder`, `agentsPanel.border`, `tree.inactiveIndentGuidesStroke`, `tree.tableColumnsBorder`, `window.inactiveBorder` | Structural separation between large regions, and grouping that must not become a surface change | Control boundaries; anything the user must be able to see at a glance |
| Default border | `#ffffff2e` (18% white) | `widget.border`, `editorWidget.border`, `editorHoverWidget.border`, `editorSuggestWidget.border`, `menu.border`, `menu.separatorBackground`, `notifications.border`, `notificationToast.border`, `dropdown.border`, `input.border`, `checkbox.border`, `keybindingLabel.border`, `debugToolBar.border`, `textSeparator.foreground`, `tree.indentGuidesStroke`, `window.activeBorder`, `agentsChatInput.border` | Boundaries that identify a control or a floating surface | Region separators (too heavy — produces a gray grid) |
| Focus border | `#2dd4bf` | `focusBorder`, `inputOption.activeBorder`, `statusBar.focusBorder`, `statusBarItem.focusBorder`, `sash.hoverBorder` | Keyboard focus, active input options, sash hover | Decoration, or anything non-interactive |

Borders are translucent white, not opaque gray, so one value composites
correctly on all four surfaces and stays correct if a user overrides a surface.

## Foreground roles

| Role | Hex | Tokens | Worst measured contrast | Usage | Must **not** be used for |
| ---- | --- | ------ | ----------------------- | ----- | ------------------------ |
| Primary | `#f4f4f5` | `foreground`, `editor.foreground`, `sideBar.foreground`, `tab.activeForeground`, `menu.foreground`, `notifications.foreground`, `input.foreground`, `dropdown.foreground`, `editorWidget.foreground` | 12.0:1 (on `#303030`) | Body text, active labels, values | Large decorative fills; it is not `#FFFFFF` on purpose |
| Secondary | `#a1a1aa` | `descriptionForeground`, `icon.foreground`, `breadcrumb.foreground`, `statusBar.foreground`, `tab.inactiveForeground`, `panelTitle.inactiveForeground`, `commandCenter.foreground`, `titleBar.inactiveForeground` | 5.14:1 (on `#303030`) | Descriptions, metadata, inactive labels, default icon colour | Primary reading text |
| Muted | `#8b8b93` | `input.placeholderForeground`, `editorLineNumber.foreground`, `activityBar.inactiveForeground` | 4.87:1 (on `#1F1F1F`) | Placeholders, gutter line numbers, inactive activity-bar icons | Anything a user must read continuously |
| Disabled | `#71717a` | `disabledForeground` | below 4.5:1 — **WCAG 1.4.3 exempt** | Genuinely disabled controls only | Enabled-but-quiet text; use *muted* instead |
| On accent | `#1B1C1E` | `button.foreground`, `menu.selectionForeground`, `activityBarBadge.foreground`, `statusBar.debuggingForeground`, `statusBarItem.remoteForeground` | 9.16:1 on `#2dd4bf` | Text on accent fills | Text on any gray surface |
| Link | `#22d3ee` | `textLink.foreground`, `tab.selectedBorderTop`, `editorGutter.modifiedBackground` | 7.83:1 (on `#2B2B2B`) | Links, modified indicators | Body text |
| Error | `#ff7b72` | `errorForeground` | 5.23:1 (on `#303030`) | Error text | Decorative red |

`prebaseSurfaces.ts` intentionally exposes only **primary**, **secondary**,
**disabled**, **onSelected**, **link** and **error**. There is no component-level
"muted" role: muted is a theme-level value attached to three specific native
tokens, and repurposing a placeholder colour as generic body text is exactly the
semantic drift Apple's HIG warns against.

## Accent ramp

| Hex | Role | Tokens |
| --- | ---- | ------ |
| `#2dd4bf` | Accent | `button.background`, `focusBorder`, `activityBarBadge.background`, `progressBar.background`, `menu.selectionBackground`, `statusBarItem.remoteBackground`, `statusBar.debuggingBackground` |
| `#5eead4` | Accent hover / active indicator | `button.hoverBackground`, `activityBar.activeBorder`, `tab.activeBorderTop`, `panelTitle.activeBorder`, `terminal.tab.activeBorder`, `textLink.activeForeground` |
| `#22d3ee` | Accent (links / modified) | `textLink.foreground`, `tab.selectedBorderTop` |
| `#134e4a` | Selected surface (accent tinted) | `list.activeSelectionBackground`, `quickInputList.focusBackground`, `editorSuggestWidget.selectedBackground`, `peekViewResult.selectionBackground` |

## Legitimate non-palette values

These are allowlisted in `scripts/theme/verify-surfaces.mjs` with a stated role
and must not be extended casually:

| Hex | Role |
| --- | ---- |
| `#00000066` | `widget.shadow` — translucent black shadow base. Opaque pure black as a surface is rejected by the verifier. |
| `#F85149` / `#2EA043` | Diff deleted / added gutter markers (semantic, inherited meaning) |
| `#9E6A03`, `#BB800966` | Find match and match highlight |
| `#E2C08D` | Modified-file indicator |
| `#2dd4bf82`, `#134e4a66` | Accent washes (active input option, slash command) |
| `#ffffff1a`, `#ffffff38` | Scrollbar slider rest / active, surface-agnostic hover wash |

## Pure black policy

Opaque `#000000` is rejected as a theme surface by the verifier and does not
appear anywhere in `prebase_dark.json`. The only black remaining in PreBase-owned
UI source is `rgba(0,0,0,0.45)` in a `box-shadow`
(`src/vs/workbench/contrib/prebase/browser/prebaseHomeEditor.ts`), which is a
shadow base rather than a surface and is therefore legal.

## Deliberately inherited values

Seven tokens still resolve through the `dark_plus` → `dark_vs` chain. All are
content-level markers, not surfaces, and were left alone to avoid re-tuning
syntax highlighting:

`editor.inactiveSelectionBackground`, `terminal.inactiveSelectionBackground`,
`editor.selectionHighlightBackground`, `editorIndentGuide.background1`,
`editorIndentGuide.activeBackground1`, `tab.lastPinnedBorder`,
`ports.iconRunningProcessForeground`.

`editor.selectionBackground` (`#264F78`) is also inherited on purpose: Dark+
syntax colours are tuned against it, and re-tuning them was judged higher risk
than the benefit.

## Customisation and High Contrast

- Every surface is a real theme token, so `workbench.colorCustomizations` and
  third-party themes keep working unchanged.
- `prebase_dark.json` `include`s `dark_plus.json` only. The verifier fails the
  build if it ever `include`s a High Contrast theme, or if any of the four
  surfaces appears in `hc_black.json` / `hc_light.json`.
- No setting exposes the four hex values. That is intentional: colour
  customisation stays on the native mechanism.
