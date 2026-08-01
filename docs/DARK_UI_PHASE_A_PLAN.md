# Dark UI Phase A Plan — Semantic Surface Redesign

**Status:** Checkpoints 2–3 — cleanup priorities + token architecture sign-off (docs). Theme JSON may already be WIP in the working tree; **initial colors + custom UI still unfinished**.  
**Branch baseline (committed):** `main` @ `efabd9ed4abde12e0f79055cd63f0e5681c40abe` (near-black Night)  
**Diff snapshot:** `/tmp/prebase-dark-ui-baseline/`  
**Canonical theme file:** `extensions/theme-defaults/themes/prebase_dark.json`  
**Theme settings ID (stable):** `PreBase Dark`  
**Display label:** PreBase Night (`prebaseDarkThemeLabel`)

---

## Architecture verdict

PreBase already uses the **native VS Code color-theme stack**. There is **no** second PreBase theme framework to adopt or invent.

| Layer | Role | Source of truth |
|---|---|---|
| Theme contribution | Registers built-in themes | `extensions/theme-defaults/package.json` → `id: "PreBase Dark"` → `prebase_dark.json` |
| Default dark theme | First-run / preferred dark | `ThemeSettingDefaults.COLOR_THEME_DARK = 'PreBase Dark'` in `src/vs/workbench/services/themes/common/workbenchThemeService.ts` |
| Startup flash colors | Pre-theme paint | `COLOR_THEME_DARK_INITIAL_COLORS` (same file; WT synced to Night ladder — GUI flash still Needs Verification) |
| Onboarding picker | Product catalog | `product.json` → `onboardingThemes` (`themeId: "PreBase Dark"`) |
| Settings / onboarding UI | Sets `workbench.colorTheme` | `prebaseSettingsEditor.ts`, `prebaseOnboardingEditor.ts` |
| Workbench chrome | Consumes theme tokens | VS Code color registry + theme JSON `colors` |
| PreBase custom panes | Mostly **hardcoded slate hex**, not tokens | `prebaseHomeEditor.ts`, `prebaseSettingsEditor.ts`, graph host webviews |

**Where defaults belong**

1. **Phase B (chrome):** semantic surface roles → VS Code workbench tokens in `prebase_dark.json` (includes `./dark_plus.json` for syntax; do not fork a parallel theme format).
2. **Phase B (flash sync):** update `COLOR_THEME_DARK_INITIAL_COLORS` to the same surface map so cold-start matches Night.
3. **Phase B (preview):** update `theme-preview-prebase-dark.svg` only (onboarding swatch)—not application Dock/installer icons.
4. **Phase C (custom UI):** replace hardcoded slate backgrounds in PreBase Home / Settings / graph **chrome** with `var(--vscode-*)` / `asCssVariable(...)` / `IThemeService`. Do **not** invent a parallel CSS design system.
5. **Out of scope for surface redesign:** Architecture/Network **semantic** colors (file-type, layer bands, entry gold)—those are data viz, not chrome.

Do **not** create a custom PreBase color registry for chrome unless a token truly does not exist (unlikely for surfaces). Prefer existing workbench keys.

---

## Current defect (research finding)

**Committed** PreBase Night is harsh and flat (values below = `HEAD` / baseline; working-tree theme JSON may already be on the ladder):

| Current role | Hex (committed) | Problem |
|---|---|---|
| Chrome (activity/side/title/status/panel) | `#0a0a0b` | Near-black void; little hierarchy |
| Editor / menus / notifications | `#101012` | Barely distinct from chrome |
| Controls (input/dropdown/widget) | `#161618` | Still crushed toward black |
| Borders | `#242428` | Low-contrast hairlines on black |

Accent teal (`#2dd4bf` / `#5eead4`) is fine and should remain the brand accent. Do not “cleanse” it into gray.

`Dark Modern` already uses `#1F1F1F` / `#2B2B2B` with chrome `#181818`. PreBase Night must **not** become a teal-accented clone of Dark Modern; it should use the approved four-step ladder below with PreBase accent + typography retained from current Night.

---

## Approved palette → semantic roles → tokens

**Corrected after research (2026-08-01):** content wells are deepest (Atlassian sunken + product brief); shell is default; sidebar is raised; overlays/controls are lightest. See `docs/DARK_UI_RESEARCH.md` and `docs/DARK_SURFACE_TOKENS.md`.

Map **roles first**, then assign hex once. Avoid scattering the four hex values inconsistently across tokens.

| Semantic role | Hex | Intent | Primary VS Code tokens |
|---|---|---|---|
| `deep` | `#1B1C1E` | Content wells (editor, terminal, active tab) | `editor.background`, `terminal.background`, `tab.activeBackground`, `tab.activeBorder`, `peekViewEditor.background`, `editorGroup.emptyBackground` |
| `default` | `#1F1F1F` | App shell chrome | `activityBar.background`, `titleBar.activeBackground`, `titleBar.inactiveBackground`, `statusBar.background`, `statusBar.noFolderBackground`, `panel.background`, `editorGroupHeader.tabsBackground`, `tab.inactiveBackground`, `debugToolBar.background`, `dropdown.listBackground` |
| `raised` | `#2B2B2B` | Sidebar + major separators + secondary fills | `sideBar.background`, `sideBarSectionHeader.background`, `peekViewResult.background` (results list elevated vs peek editor); borders: `*.border` on activity/side/panel/title/status/tab/notifications; fills: `textBlockQuote.background`, `textCodeBlock.background`, `welcomePage.tileBackground`, `button.secondaryHoverBackground`, `badge.background` (only if fg contrast OK) |
| `overlay` | `#303030` | Floating UI + interactive wells + tab hover | `menu.background`, `notifications.background`, `notificationCenterHeader.background`, `input.background`, `dropdown.background`, `checkbox.background`, `editorWidget.background`, `quickInput.background`, `settings.dropdownBackground`, `textPreformat.background`, `tab.hoverBackground`, `tab.unfocusedHoverBackground` |

**Borders:** prefer `raised` (`#2B2B2B`) for major chrome separators (matches Dark Modern discipline). **Do not** set `sideBar.border` identical to `sideBar.background` and then expect a visible intra-sidebar rule — adjacency must come from neighboring pane fills (editor **deep**, panel **default**) or a documented control-border step. If input borders disappear against `overlay`, use control border `#3C3C3C` (recorded in `DARK_SURFACE_TOKENS.md`).

**Foregrounds (keep Night hierarchy; do not gray-wash text):**

- Primary: `#f4f4f5` (or keep current Night foregrounds)
- Secondary: `#a1a1aa`
- Muted / line numbers: `#71717a`
- Accent / focus: keep `#2dd4bf`, hover `#5eead4`, link `#22d3ee`

**Contrast rule:** every adjacent pair (`chrome`↔`canvas`, `canvas`↔`control`, `control`↔ text) must remain visually distinguishable in a side-by-side screenshot. If two roles look identical, stop and remap—do not add more hex noise.

---

## Phased execution

### Phase A (checkpoints 1–3) — research + plan + cleanup priorities

- [x] Inspect theme architecture and PreBase custom hex usage
- [x] Confirm native VS Code tokens are the right place (no second framework)
- [x] Write corrected role map (content wells deepest)
- [x] Token architecture review + `docs/CLEANUP_AUDIT.md` priorities (checkpoints 2–3)
- [ ] Phase B complete only when theme JSON **and** `COLOR_THEME_DARK_INITIAL_COLORS` match the role table (working-tree theme-only edits are incomplete)

### Phase B — theme tokens only (smallest safe chrome win)

1. Edit `prebase_dark.json` `colors` only (keep `"include": "./dark_plus.json"`; do not rewrite `tokenColors` unless a contrast bug appears).
2. Sync `COLOR_THEME_DARK_INITIAL_COLORS` to the same surface map.
3. Update onboarding preview SVG `theme-preview-prebase-dark.svg` to match (not Dock icons).
4. Manual visual pass: editor, sidebar, tabs, panel, quick input, notifications, menus.
5. Smoke HC themes untouched: switching to Default High Contrast must still work (do not edit `hc_*.json` for this redesign).
6. Run `npm run verify:icons` (expect 101/101; **no** manifest rewrite).

### Phase C — PreBase custom UI token migration (after Phase B looks right)

Priority order:

1. `prebaseSettingsEditor.ts` — `COLORS` slate block → `--vscode-editor-background`, `--vscode-sideBar-background`, `--vscode-panel-border`, `--vscode-foreground`, `--vscode-descriptionForeground`, `--vscode-focusBorder` / accent from theme.
2. `prebaseHomeEditor.ts` — same; remove `#0b1220` / `#0f172a` shell that fights Night.
3. Graph **chrome** only: `graphs/src/host/workbench/graphEditor.ts` embedded CSS, `prebaseMapsView.ts` surface constants — backgrounds/borders/text for toolbars/empty states/popups.
4. Leave alone unless broken: `fileTypeColors.ts`, `architectureLayers.ts` band colors, entry-node gold, selection accent if still on-brand.

Optional later: thin shared helper under `graphs/` or `contrib/prebase/` that reads theme CSS variables—only if duplication remains after two call sites. Prefer CSS variables first.

### Explicit non-goals

- No import / merge from ONE-GRAPH-TYPE (or any experimental graph branch).
- No deletion or collapse of Architecture Graph + Network Graph.
- No application icon / `resources/darwin|win32|linux` / `build/icons/icon-integrity.sha256` changes.
- No lockfile / toolchain upgrades for theming.
- No new theme JSON format, no Tailwind, no parallel “design tokens” package.
- No mass refactor of upstream VS Code chrome CSS.

---

## Risks / must-avoid

| Risk | Why | Mitigation |
|---|---|---|
| Gray-box soup | Four close grays on every surface → flat mush | Strict role→token table; screenshot chrome vs canvas vs control before merge |
| HC breakage | Editing shared registry defaults or HC themes | Only touch `prebase_dark.json` + dark initial colors + preview SVG; leave `hc_black` / `hc_light` alone |
| Icon touch | Packaging / “make preview match Dock” temptation | Icons frozen; preview SVG ≠ app icon; run `verify:icons` after any resource touch |
| ONE-GRAPH import | Experimental branch contamination | Stay on `main`; no cherry-picks from experiment trees |
| Over-refactor | Rewriting graph viz + Home + Settings + theme in one PR | Phase B theme-only; Phase C chrome-only; semantic node colors out of scope |
| Flash mismatch | Theme JSON updated but `COLOR_THEME_DARK_INITIAL_COLORS` stale | Always update both in Phase B |
| ID rename | Renaming `PreBase Dark` → `PreBase Night` breaks settings / sync | Keep settings ID; label already “PreBase Night” |
| Custom UI fights theme | Slate `#0b1220` panes ignore Night | Phase C required for product coherence; do not claim “done” after JSON-only if Home/Settings still look like a different product |

---

## Recommended Phase B / C priorities

**Phase B (do next):**

1. Apply role→token map in `prebase_dark.json`.
2. Mirror into `COLOR_THEME_DARK_INITIAL_COLORS`.
3. Refresh `theme-preview-prebase-dark.svg`.
4. Visual QA + `verify:icons`.

**Phase C (after B accepted):**

1. Settings + Home slate → VS Code CSS variables.
2. Graph editor/maps chrome CSS → variables (preserve Architecture + Network behavior).
3. Spot-check light theme + HC: custom panes must not hardcode dark-only backgrounds without a light/HC path (use tokens so themes flow).

---

## Code smells already visible (tracked in CLEANUP_AUDIT)

1. **CU-001 Hardcoded product UI palette** — Settings/Home/Onboarding slate (`#0b1220`, `#0f172a`, …); Home uses theme only for `focusBorder`.
2. **CU-004 Graph webview CSS island** — `graphEditor.ts` + `prebaseMapsView.ts` slate/navy chrome independent of Night.
3. **CU-008 Duplicated viz constants** — file-type / entry colors vs host embeds (out of scope for surface redesign).
4. **CU-007 Naming split** — settings ID `PreBase Dark` vs label `PreBase Night` vs file `prebase_dark.json` (intentional; do not rename ID).
5. **CU-003 Initial colors drift** — `COLOR_THEME_DARK_INITIAL_COLORS` diverges from theme JSON (fg/borders/secondary button/tab accents). Phase B must re-sync from the role table, not blind copy.

---

## Verification checklist (later checkpoints)

- Fresh profile opens on PreBase Night (settings ID `PreBase Dark`).
- Chrome / canvas / control visually distinct.
- Architecture Graph + Network Graph still open and function.
- `npm run verify:icons` → 101/101.
- `npm run verify:graphs-boundary` unchanged green.
- HC Dark / HC Light still selectable and usable.
- No files from experimental one-graph worktrees.

---

## Checkpoint 1–3 sign-off

- Research complete; plan corrected toward **semantic roles → native VS Code tokens**.
- Role map locked: Deep content wells → Default shell → Raised sidebar → Overlay controls (see `DARK_SURFACE_TOKENS.md`).
- Cleanup priorities filed in `CLEANUP_AUDIT.md` (CU-001–CU-008).
- Token architecture: **approve with adjustments** (tab hover → Overlay; peek results → Raised; control border `#3C3C3C`; gray-box guards).
- Checkpoints 2–3: **docs only** for this reviewer pass (no icon/lockfile/experimental-branch edits). Theme JSON may already be WIP from parent — Phase B incomplete until initial colors sync + visual QA.
- Icons / lockfiles / experimental branches untouched by this sign-off.
