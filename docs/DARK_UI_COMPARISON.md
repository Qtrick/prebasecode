# Dark UI Comparison — Before / After

**Date:** 2026-08-01  
**Branch:** `main`  
**Baseline commit:** `efabd9ed4abde12e0f79055cd63f0e5681c40abe`

## Method

- Before: theme values from committed `prebase_dark.json` (`#0a0a0b` / `#101012` / `#161618`)
- After: semantic ladder `#1B1C1E` / `#1F1F1F` / `#2B2B2B` / `#303030` + CSS-variable custom panes
- Evidence dir: `/tmp/prebase-dark-ui-baseline/screenshots/` (GUI capture in progress)
- Onboarding preview SVG updated in-repo (not Dock icons)

## Source-level before → after (canonical Night)

| Surface | Before | After role | After value |
|---|---|---|---|
| Activity / title / status / panel / inactive tabs | `#0a0a0b` | Default | `#1F1F1F` |
| Editor / terminal / active tab | `#101012` | Deep | `#1B1C1E` |
| Sidebar | `#0a0a0b` | Raised | `#2B2B2B` |
| Inputs / menus / widgets / notifications | `#161618`–`#101012` | Overlay | `#303030` |
| Borders | `#242428` | Raised / input | `#2B2B2B` / `#3C3C3C` |

## Contrast (after)

| Pair | Ratio | Result |
|---|---|---|
| `#f4f4f5` on deep/default/raised/overlay | 15.5 / 15.0 / 12.9 / 12.0 | AA pass |
| `#a1a1aa` on deep/raised | 6.65 / 5.52 | AA pass |
| Placeholder `#a1a1aa` on overlay | ~5.5 | AA pass (fixed from 2.73) |
| Surface-to-surface luminance | ~1.1–1.2 | Rely on borders + adjacency (Open CLN-014) |

## Required screenshot matrix

| # | Scene | Before | After | Changed surfaces | Roles | Rationale | Text | Non-text | HC | Remaining |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Empty window | pending | pending | shell | default/deep | Lift voids | TBD | TBD | TBD | Capture |
| 2 | Project open | pending | pending | sidebar+editor | raised/deep | Hierarchy | TBD | TBD | TBD | Capture |
| 3 | Explorer+editor | pending | pending | sidebar | raised | Distinct chrome | TBD | TBD | TBD | Capture |
| 4 | Code editor | pending | pending | canvas | deep | Calm well | TBD | TBD | TBD | Capture |
| 5 | Split editor | pending | pending | groups | deep | Borders | TBD | TBD | TBD | Capture |
| 6 | Terminal | pending | pending | panel+term | default/deep | Well vs chrome | TBD | TBD | TBD | Capture |
| 7–10 | Architecture/Network + inspectors | pending | pending | graph chrome | deep/overlay | Theme-aware webview | TBD | TBD | TBD | Capture |
| 11–20 | Magnus, RP, Settings, menus, Home, SCM, Ext | pending | pending | custom+native | mixed | Token migration | TBD | TBD | TBD | Capture |

## Hierarchy checklist (post-GUI)

- [ ] Not gray-box soup
- [ ] Editor calmer than prior near-black
- [ ] Sidebar distinct from editor
- [ ] Overlays visibly elevated
- [ ] Inputs identifiable
- [ ] Teal accent retained
- [ ] Both graph types available
- [ ] Icons unchanged

## Notes

- App launch succeeded (Electron PreBase process + renderer helpers) with `VSCODE_SKIP_PRELAUNCH=1` and fresh user-data-dir; `workbench.colorTheme` set to `PreBase Dark`.
- **Screenshot capture from this agent environment failed** (`screencapture`: “could not create image from display”; Apple Events unauthorized). Visual GUI matrix remains **Needs Verification** on a local interactive display.
- Source + contrast evidence already support the redesign claim; do **not** mark visual Done without human screenshots.
- Fill image paths under `/tmp/prebase-dark-ui-baseline/screenshots/` after manual capture.
