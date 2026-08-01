# Cleanup Audit — Dark UI Checkpoints 4 + 5

**Date:** 2026-08-01  
**Branch:** `main`  
**Scope:** PreBase Night native theme + PreBase custom UI CSS-variable migration  
**Icons:** Application / Dock icons and `build/icons/icon-integrity.sha256` were **not** modified.

---

## Files inspected

| Path | Role |
|---|---|
| `extensions/theme-defaults/themes/prebase_dark.json` | Night theme ladder |
| `src/vs/workbench/services/themes/common/workbenchThemeService.ts` | `COLOR_THEME_DARK_INITIAL_COLORS` startup sync |
| `src/vs/workbench/contrib/welcomeOnboarding/browser/media/theme-preview-prebase-dark.svg` | Theme picker preview (not Dock icons) |
| `src/vs/workbench/contrib/prebase/browser/prebaseHomeEditor.ts` | Home custom UI |
| `src/vs/workbench/contrib/prebase/browser/prebaseOnboardingEditor.ts` | Onboarding custom UI |
| `src/vs/workbench/contrib/prebase/browser/prebaseSettingsEditor.ts` | Settings custom UI |
| `graphs/src/host/workbench/graphEditor.ts` | Graph webview chrome CSS + node fill |
| `graphs/src/host/workbench/prebaseMapsView.ts` | Graph explorer pane surfaces |
| `graphs/src/host/workbench/settings/graphSettingsUi.ts` | Graph advanced settings panel |
| `src/vs/workbench/contrib/prebase/browser/runtimeEditor.ts` | Runtime Preview chrome fallbacks (Checkpoint 12) |
| `docs/DARK_SURFACE_TOKENS.md` / `docs/DARK_SURFACE_AUDIT.md` | Role reference + Checkpoint 12 doc sync |

---

## Defects found and fixed

| ID | Severity | Finding | Fix |
|---|---|---|---|
| CU-001 | High | `peekViewResult.background` left at Deep `#1B1C1E` (same as peek editor) → no hierarchy | Raised `#2B2B2B` in theme JSON + `COLOR_THEME_DARK_INITIAL_COLORS` |
| CU-002 | High | Custom UI appended hex alpha to CSS vars (`${BORDER}99`, `${SURFACE}cc`) → invalid CSS after var migration | Replaced with `color-mix(...)` in Home + Maps |
| CU-003 | High | Leftover slate fills (`rgba(15,23,42…)`, `rgba(30,41,59…)`, `#e2e8f0` / `#cbd5e1`) fought Night and broke HC | Migrated to `--vscode-*` / accent washes |
| CU-004 | Medium | Card / control borders used `sideBar.border` which matched raised fills → invisible hairlines | Custom UI borders → `input-border` / `widget-border` (`#3C3C3C`) |
| CU-005 | Medium | Settings / graph advanced panels used translucent raised fills → gray-box soup + HC risk | Transparent card bodies; solid aside surface; border-only grouping |
| CU-006 | Medium | Secondary copy used `disabledForeground` for non-disabled text (paths/hints) | Use `descriptionForeground` |
| CU-007 | Medium | `statusBar.foreground` muted to `#a1a1aa`; placeholders `#71717a` too dim for chrome | Status → `#f4f4f5`; placeholders → `#a1a1aa` (theme + initial colors synced) |
| CU-008 | Low | INITIAL colors missing `menu.selectionForeground`, `panelSectionHeader.background`, statusBarItem hover keys; `button.border` casing drift | Synced with `prebase_dark.json` |
| CU-009 | Low | Graph popup primary button hardcoded Night-only ink | Use `--vscode-button-*` with Night fallbacks |
| CU-010 | Info | `sideBar.border` already corrected to `#1F1F1F` (groove vs Raised `#2B2B2B`); `terminal.background` already Deep | Confirmed; no further change |

---

## Remaining risks

1. **HC / light theme GUI smoke** — custom panes now prefer CSS vars, but accent chips still use teal hex (`#2dd4bf`, active theme chip `#155e75`). Verify High Contrast Dark/Light and PreBase Light.
2. **color-mix support** — used for translucent chrome; Electron Chromium OK, but if a surface looks flat, check computed styles.
3. **Graph viz colors** — file-type strokes, import swatch `#94a3b8`, network canvas strokes remain intentional viz tokens (not chrome).
4. **Runtime Preview** — `runtimeEditor.ts` Night fallbacks aligned (Checkpoint 12); toolbar accent chips still teal hex (`#155e75`). Full Runtime Preview chrome pass still a follow-up if more slate surfaces remain outside this file.
5. **Token doc** — `docs/DARK_SURFACE_TOKENS.md` synced (Checkpoint 12) for placeholders `#a1a1aa`, `sideBar.border` groove `#1F1F1F`, and `widget.border` as control border.
6. **Contrast** — Raised `#2B2B2B` vs Deep `#1B1C1E` adjacency is subtle (~low non-text contrast). Relies on `sideBar.border` `#1F1F1F` groove + control borders `#3C3C3C`. GUI verify sidebar|editor split.

---

## Contrast concerns (manual verify)

| Pair | Concern |
|---|---|
| `#a1a1aa` on `#1F1F1F` / `#2B2B2B` | Secondary text — aim ≥4.5:1 |
| `#71717a` line numbers on `#1B1C1E` | Intentionally muted; do not use for body copy |
| Badge `#f4f4f5` on `#2B2B2B` | OK |
| Teal button `#2dd4bf` + fg `#1B1C1E` | OK |
| Peek results Raised vs peek editor Deep | Fixed (CU-001) |

---

## Retest list (focused)

1. Reload window with **PreBase Night** — confirm no startup chrome flash vs final theme (`COLOR_THEME_DARK_INITIAL_COLORS`).
2. Sidebar | editor | panel | terminal adjacency; peek view editor vs results.
3. Status bar text readability; input placeholders.
4. PreBase Home / Onboarding / Settings — card borders visible; no slate islands; light + HC switch.
5. Architecture + Network graphs — webview toolbar/popup/empty state follow theme; node fills match editor; both graph types still present.
6. Graph explorer (`prebaseMapsView`) — search, chips, tree text readable; borders valid.
7. `npm run verify:icons` — expect unchanged (icons frozen).
8. Optional: `npm run verify:graphs-boundary` after graph host edits.

---

## Explicit non-goals (this pass)

- No application / Dock icon changes  
- No ONE-GRAPH-TYPE / Architecture+Network merge  
- No mass refactor of Runtime Preview or unrelated editors  
- No claim of beta readiness without GUI evidence  
