# Dark Surface Audit — PreBase Night

**Date:** 2026-08-01  
**Branch:** `main`  
**Baseline commit (near-black):** `efabd9ed4abde12e0f79055cd63f0e5681c40abe`  
**Working-tree note (2026-08-01, Checkpoint 12):** Night ladder is implemented in WT `prebase_dark.json` + synced `COLOR_THEME_DARK_INITIAL_COLORS` (shared keys match). Table “Current color” columns below still describe the **committed baseline** for before/after audit; Status `WT WIP` / `Implemented` tracks the working tree.

Legend — Implementation status: `Audited` | `Mapped` | `Implemented` | `Verified` | `Deferred` | `Intentional black` | `WT WIP`

---

## Workbench (PreBase Night theme JSON)

| Subsystem | Component | Current color (committed) | Current token | Owning file | Area | Current role | Proposed role | Proposed value | Rationale | Text contrast | UI boundary | HC | Screenshot | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Shell | Activity Bar | `#0a0a0b` | `activityBar.background` | `prebase_dark.json` | Large | Near-black chrome | Default | `#1F1F1F` | Lift void; separate from editor | Primary `#f4f4f5` OK | Border → Raised | Inherit HC theme | TBD | Mapped / WT WIP |
| Shell | Side Bar | `#0a0a0b` | `sideBar.background` | same | Large | Near-black | Raised | `#2B2B2B` | Distinct from editor well | OK | Border must not pretend to be a visible rule if fill===border | Inherit | TBD | Mapped / WT WIP |
| Shell | Title Bar | `#0a0a0b` | `titleBar.activeBackground` | same | Medium | Near-black | Default | `#1F1F1F` | Match shell | OK | Border Raised | Inherit | TBD | Mapped / WT WIP |
| Shell | Status Bar | `#0a0a0b` | `statusBar.background` | same | Medium | Near-black | Default | `#1F1F1F` | Match shell | Secondary `#a1a1aa` | Border Raised | Inherit | TBD | Mapped / WT WIP |
| Editor | Canvas | `#101012` | `editor.background` | same | Dominant | Near-black content | Deep | `#1B1C1E` | Calm content well | OK vs `#f4f4f5` | vs sidebar Raised | Inherit | TBD | Mapped / WT WIP |
| Editor | Tabs strip | `#0a0a0b` | `editorGroupHeader.tabsBackground` | same | Medium | Flat black | Default | `#1F1F1F` | Chrome under tabs | OK | Border Raised | Inherit | TBD | Mapped / WT WIP |
| Tabs | Active | `#101012` | `tab.activeBackground` | same | Small | Matches old canvas | Deep | `#1B1C1E` | Connect to editor | OK | Top accent teal | Inherit | TBD | Mapped / WT WIP |
| Tabs | Inactive | `#0a0a0b` | `tab.inactiveBackground` | same | Small | Flat | Default | `#1F1F1F` | Recede vs active | Secondary fg | Border Raised | Inherit | TBD | Mapped / WT WIP |
| Tabs | Hover | `#101012` | `tab.hoverBackground` | same | Small | Flat | Overlay | `#303030` | Hover ≠ Default shell | OK | vs inactive Default | Inherit | TBD | Mapped / WT WIP |
| Panel | Body | `#0a0a0b` | `panel.background` | same | Large | Flat black | Default | `#1F1F1F` | Distinguish from editor Deep | OK | Border Raised | Inherit | TBD | Mapped / WT WIP |
| Terminal | Body | (inherit panel/editor) | `terminal.background` unset @ baseline | dark_plus inherit | Large | Often blackish | Deep | `#1B1C1E` | Content well | ANSI preserved | vs panel Default | Inherit | TBD | Mapped / WT WIP |
| Peek | Results list | `#101012` | `peekViewResult.background` | same | Medium | Same as peek editor | Raised | `#2B2B2B` | Elevate results vs peek editor Deep | OK | vs peek editor | Inherit | TBD | Mapped (adjust if WT left Deep) |
| Widgets | Input/dropdown | `#161618` | `input.background` etc. | same | Controls | Crushed | Overlay | `#303030` | Identifiable controls | OK | Control border `#3C3C3C` | Inherit | TBD | Mapped / WT WIP |
| Overlays | Menu / notifications | `#101012` | `menu.background` etc. | same | Overlay | Too close to chrome | Overlay | `#303030` | True elevation | OK | Border Raised | Inherit | TBD | Mapped / WT WIP |
| Borders | Many | `#242428` | `*.border` | same | Hairlines | Low on black | Raised / Control | `#2B2B2B` panes; `#3C3C3C` controls | Match Dark Modern discipline | N/A | ≥3:1 where needed | Inherit | TBD | Mapped / WT WIP |

Pure black policy — intentional leave-alone candidates:

| Use | Classification | Action |
|---|---|---|
| `button.secondaryBackground: #00000000` | Transparent / shadow role | Keep |
| `rgba(0,0,0,.45)` box-shadows | Shadow | Keep |
| Syntax / token colors | Theme content | Do not retokenize for chrome |
| Icon artwork | Product branding (FROZEN) | Never touch |
| Language color `#000080` (lua) | Viz / semantic | Leave |

---

## PreBase custom UI (hardcoded)

| Subsystem | Component | Current color | Token | Owning file | Area | Role | Proposed | Value | Rationale | Contrast | HC | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Home | Root bg | `#0b1220` + gradient | none | `prebaseHomeEditor.ts` | Large | Hardcoded slate | Default/Deep via CSS vars | `var(--vscode-editor-background)` + restrained accent wash | Theme-aware | TBD | Must follow theme | Mapped |
| Home | Surface/cards | `#0f172a` | none | same | Medium | Hardcoded | Raised/Overlay vars | `--vscode-sideBar-background` / widget | Avoid second palette | TBD | Theme | Mapped |
| Onboarding | Root/panel | `#0b1220` / `#0f172a` | none | `prebaseOnboardingEditor.ts` | Large | Hardcoded | Theme vars | same pattern | Coherence | TBD | Theme | Mapped |
| Settings | COLORS.bg | `#0b1220` | none | `prebaseSettingsEditor.ts` | Large | Hardcoded | Theme vars | `--vscode-editor-background` | Coherence | TBD | Theme | Mapped |
| Settings | surface/overlay | `#0f172a` / `#111827` | none | same | Medium | Hardcoded | Raised/Overlay | sideBar / widget vars | Avoid cards soup | TBD | Theme | Mapped |
| Graph editor | html/body | `#070b14` | none | `graphs/.../graphEditor.ts` | Dominant | Near-black island | Deep | `--vscode-editor-background` | Match Night canvas | TBD | Theme | Mapped |
| Graph maps pane | SURFACE / overlay | `#1e293b` / `#0f172a` | none | `graphs/.../prebaseMapsView.ts` | Medium | Hardcoded slate | Raised/Overlay vars | sideBar / widget vars | Chrome only | TBD | Theme | Mapped |
| Graph popup | slate overlay | `rgba(15,23,42,.96)` | none | `graphEditor.ts` | Overlay | Hardcoded | Overlay | `--vscode-editorWidget-background` | Elevation | TBD | Theme | Mapped |
| Graph node fill | `#0b1220` | none | `graphEditor.ts` | Nodes | Viz-adjacent chrome | Theme-aware fill **or** defer with viz colors | Prefer chrome token only if fill is UI chrome | Keep category strokes / file-type colors out of Phase C | TBD | Theme | Mapped (chrome vs viz decision in Phase C) |
| Runtime Preview | shadow `#0006` | none | `runtimeEditor.ts` | Small | Shadow | Intentional black | Keep alpha shadow | OK | N/A | Intentional black |

---

## Startup flash

| Component | Current | Proposed | File | Status |
|---|---|---|---|---|
| `COLOR_THEME_DARK_INITIAL_COLORS` | Synced to Night ladder (Checkpoint 12: 0 shared-key mismatches vs `prebase_dark.json`) | Same semantic map as `prebase_dark.json` role table | `workbenchThemeService.ts` | Implemented — GUI flash still Needs Verification |

---

## Evidence paths

- Baseline snapshot: `/tmp/prebase-dark-ui-baseline/`
- Icons: 101/101 OK before edits
- Screenshots: see `docs/DARK_UI_COMPARISON.md` (filled during GUI pass)
