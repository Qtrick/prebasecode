# Graph Migration Inventory

Research/migration date: **2026-07-20**

## Strategy

1. Authoritative sources live under repository root `graphs/src/`.
2. Workbench resolves them via a **symlinked package root** at  
   `src/vs/workbench/contrib/prebase/graphs` → `../../../../../graphs/src`  
   (six `..` segments from `prebase/` to repo root) so gulp/`out/vs/workbench/contrib/prebase/graphs/**` mirrors `src/vs/...` depth.
3. **TypeScript `preserveSymlinks: true`** is required on the **main** `src/tsconfig.json` compile lane (not only `graphs/tsconfig.json`). Without it, the compiler follows the real path under `graphs/src/`, which is **outside** `rootDir: src/` and breaks `out/vs/**` emission and duplicate-module resolution.
4. **Import rewrites are mandatory** — a symlink does not preserve the old `../common/graph/*` paths. Update consumers to `../graphs/core/*`, `../graphs/layouts/*`, etc. (see [Import path changes](#import-path-changes)).
5. **Host files** under `graphs/src/host/workbench/` sit two directories deeper than today’s `browser/` tree; every relative import into `vs/**` and `prebase/common/**` must be recalculated (typically +2 `../` to reach `vs/` from `graphs/host/workbench/`).
6. After move, delete `common/graph/` and graph-only files from `browser/` (no duplicate authoritative implementations).
7. Minimal bootstrap remains in `prebase.contribution.ts` / desktop contribution (register only).

### Checkpoint 3+4 (2026-07-20)

| Item | Status |
|---|---|
| `git mv` sources to `graphs/src/` (core + host) | Done |
| Delete legacy `common/graph/` and graph-only `browser/*` | Done |
| Symlink `prebase/graphs` → `../../../../../graphs/src` | Done |
| `preserveSymlinks: true` on `src/tsconfig.json` | Done |
| Import rewrites to `../graphs/...` from bootstrap | Done |
| Settings extract → `graphs/src/settings/` + `graphConfigurationContribution.ts` | **Done** (Phase B, 2026-07-20) |
| Commands extract → `graphs/src/commands/` + `graphContribution.ts` | **Done** (Phase C, 2026-07-20) |
| Unit tests | `graphs/src/tests/unit/` (runner via workbench node harness) |
| On-disk core layout | Phase D: `common/`, `core/*/` subdirs, `layouts/`, `architecture/interaction/` (2026-07-20) |
| `hierarchyLayout.ts` split | **Intentionally single file** under `layouts/architecture/hierarchy/` — hierarchy, pyramid, and scatter share depth bands, ring guides, and `layoutConstraints` finalize helpers; extracting modes would duplicate private placement logic or change behavior |

### Checkpoint 1 — pre-extraction plan (2026-07-20)

Baselines verified before Phase B settings extraction: `verify:graphs-boundary` (9 allowlist exceptions), `verify:typescript`, `typecheck:graphs`, `typecheck-client`. Icon gate: **101/101** OK via `npm run verify:icons` against [`build/icons/icon-integrity.sha256`](../../build/icons/icon-integrity.sha256).

**Recommended sequencing (must before beta):**

| Phase | Work | Depends on |
|---|---|---|
| B | Extract graph settings registration → `graphs/src/host/workbench/graphConfigurationContribution.ts` | — |
| C | Extract graph commands + editor/view registrations → `graphs/src/commands/` | Phase B (shared `PreBaseConfigKeys` / channel constants) |
| D | Reorganize flat `graphs/src/core/` into `layouts/*`, `common/`, domain subfolders | Phases B–C stable |
| E | Renamed `build/lib/typescriptCompiler.ts` (was `tsgo.ts`); expand `assurance`/CI (BETA-027) | Toolchain docs |
| F | Static privacy checklist (BETA-014) | — |

**Phase B settings extraction — do not break:**

| Risk | Mitigation |
|---|---|
| **Stable setting IDs** | Never rename `prebase.graph.*` strings or `configurationRegistry` section id `prebaseGraph`. User `settings.json` and `settingsLayout.ts` TOC lists depend on them. |
| **Duplicate registry** | **Move** `registerConfiguration({ id: 'prebaseGraph', … })` (and related properties) out of `prebaseConfiguration.ts`; do not call `registerConfiguration` twice for the same keys. |
| **`GraphReduceMotion` in Appearance block** | Key is `prebase.graph.reduceMotion` but registered under `prebaseAppearance` today. Either move property with the graph block or document intentional split; do not drop registration. |
| **`PREBASE_RESETTABLE_CONFIG_KEYS`** | `Object.values(PreBaseConfigKeys)` drives “Reset all” in `prebaseSettingsEditor.ts`. If enum members move to `graphs/`, re-export or compose the reset list so graph keys are still reset. |
| **`PreBaseConfigKeys` imports** | Host code under `graphs/src/host/**` imports enum from `prebase/common/prebaseConfiguration.js` via symlink-relative path. Keep a single canonical enum export until imports are updated in one pass. |
| **Channel constants** | `PREBASE_GRAPH_CHANNEL_ID` / `LABEL` stay stable for output/diagnostics. |

**`prebase.interaction.*` ownership (settings Phase B scope):**

| Key | Owner | Extract with graph settings? |
|---|---|---|
| `prebase.interaction.panSensitivity` | Graph canvas (reserved — not wired in webview yet) | **Yes** — graph-owned |
| `prebase.interaction.zoomSensitivity` | Graph canvas (reserved) | **Yes** |
| `prebase.interaction.networkDragDirection` | Network graph (`graphEditor.ts` reads it) | **Yes** |
| `prebase.interaction.nodeDragDelayMs` | Graph node drag (reserved) | **Yes** |
| `prebase.interaction.terminalVisibility.graph` | Workbench shell / terminal panel per active view | **No** — keep in `prebaseConfiguration.ts` |
| `prebase.interaction.terminalVisibility.runtime` | Runtime Preview shell | **No** |
| `prebase.interaction.terminalVisibility.settings` | PreBase Settings editor shell | **No** |

Registry section `prebaseInteraction` is mixed today; Phase B should **split registration** (graph interaction properties → `graphs/src/settings/`, terminal visibility → allowlisted mixed file) without renaming keys.

**Phase C commands — stable IDs (do not rename):** defined in `graphs/src/commands/graphCommandIds.ts` and registered from `graphs/src/host/workbench/graphContribution.ts`. Magnus bridge commands remain the same strings; invokers stay in `extensions/prebase-magnus` and onboarding/getting-started.

### Symlink + `out/` mirror (soundness checklist)

| Check | Requirement |
|---|---|
| Symlink depth | `prebase/graphs` → `../../../../../graphs/src` (verify with `readlink` after create) |
| `preserveSymlinks` | Add to `src/tsconfig.json` `compilerOptions` before first compile of symlinked sources |
| `rootDir` / include | Symlinked `.ts` must appear under `src/vs/**` in the project `include` glob (`./vs/**/*.ts`) |
| Realpath trap | Default TS/node realpath = repo `graphs/src` → **fatal** without `preserveSymlinks` |
| Git / CI | Commit symlink as symlink; Windows devs may need `git config core.symlinks true` or directory junction documented in runbook |
| Media | `prebaseMaps.svg` must remain loadable from emitted `out/vs/.../graphs/host/media/` (symlink or gulp static copy) |
| Tests (BETA-005) | `graphs/src/tests/unit/` via `graphs/scripts/run-unit-tests.mjs` (strip-types; no `out/` required) |

### `graphs/tsconfig.json` vs main compile

- **Main workbench compile** (`src/tsconfig.json` + gulp): authoritative for host modules under `prebase/graphs/**` (symlink) including all `vs/**` relative imports.
- **`graphs/tsconfig.json`**: package-scoped `noEmit` lane for core/layout sources without pulling the full workbench graph; not a replacement for gulp after host moves.

### Import path changes

| Old prefix (from `browser/` or `common/`) | New prefix (after move) |
|---|---|
| `../common/graph/<file>.js` | See [Phase D inventory](#inventory-table) — e.g. `../graphs/common/types/graphTypes.js`, `../graphs/core/analysis/dependencyDepth.js`, `../graphs/layouts/network/index.js` |
| `./graphEditor.js` (contribution) | `../graphs/host/workbench/graphEditor.js` |
| `../../common/graph/*` (unit tests) | `../../../graphs/layouts/...` or `../../../graphs/core/...` (per module) |

**Cross-contrib consumers** (not moved; update imports only):

| Path | Graph dependency |
|---|---|
| `browser/prebaseSettingsEditor.ts` | Routes to `graphs/host/workbench/settings/graphSettingsUi.ts` (no direct graph key binds) |
| `browser/prebase.contribution.ts` | Thin bootstrap → `registerPreBaseGraphContribution()` |

## Planned layout (adapted to real code)

```
graphs/
  README.md
  OWNERSHIP.md
  package.json
  tsconfig.json
  docs/MIGRATION.md          # this file
  scripts/verify-boundary/
  src/
    index.ts                 # public surface
    browser.ts
    node.ts
    core/                    # former common/graph (shared)
    layouts/
      architecture/          # hierarchy*, architecture*, layout*
      network/               # networkLayout*
      shared/                # layoutConfig, constraints, depth colors, org
    host/
      workbench/             # graphEditor*, prebaseGraph*, prebaseMaps*
      media/                 # prebaseMaps.svg
    settings/                # graph configuration registration (extracted)
    commands/                # graph command registration (extracted)
    diagnostics/
    magnus-tools/            # host-side Magnus bridges if any
    descriptions/            # description service
  tests/unit/
```

Initial move kept a flatter `graphs/src/core/*.ts` layout; **Phase D (2026-07-20)** reorganized into the tree below. Subfolders `diagnostics/`, `magnus-tools/`, `descriptions/` remain placeholders for later extraction.

## Inventory table

| Old path | New path | Responsibility | Import consumers | Build consumer | Tests | Migration status | Deletion status | Verification |
|---|---|---|---|---|---|---|---|---|
| `.../common/graph/types.ts` | `graphs/src/common/types/graphTypes.ts` | Shared types | Graph service, maps, tests | transpile via symlink | — | Complete | Deleted | Pass |
| `.../common/graph/architectureLayers.ts` | `graphs/src/core/analysis/architectureLayers.ts` | Arch layers | Graph service | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/architecturePick.ts` | `graphs/src/architecture/interaction/architecturePick.ts` | Hit testing | tests, editor | symlink | architecturePick.test | Complete | Deleted | Pass |
| `.../common/graph/hierarchyLayout.ts` | `graphs/src/layouts/architecture/hierarchy/hierarchyLayout.ts` | Hierarchy/pyramid/scatter | layoutEngine, service | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/hierarchyDepthVisuals.ts` | `graphs/src/layouts/architecture/hierarchy/hierarchyDepthVisuals.ts` | Depth bands | hierarchy | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/dependencyDepth.ts` | `graphs/src/core/analysis/dependencyDepth.ts` | Depth BFS | layouts | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/layoutOrganization.ts` | `graphs/src/layouts/shared/layoutOrganization.ts` | Org layering | layouts | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/layoutDepthColors.ts` | `graphs/src/layouts/shared/layoutDepthColors.ts` | Colors | layouts, service | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/layoutEngine.ts` | `graphs/src/layouts/architecture/layoutEngine.ts` | Layout dispatch | service | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/layoutConstraints.ts` | `graphs/src/layouts/shared/layoutConstraints.ts` | Constraints | hierarchy | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/layoutConfig.ts` | `graphs/src/layouts/shared/layoutConfig.ts` | Runtime knobs | layouts | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/networkLayout.ts` | `graphs/src/layouts/network/` (index + mode modules) | Network 3D layouts | service, tests | symlink | networkLayout.test | Complete | Deleted | Pass |
| `.../common/graph/graphGenerator.ts` | `graphs/src/core/generation/graphGenerator.ts` | Build graph | service | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/parserEngine.ts` | `graphs/src/core/parsing/parserEngine.ts` | Parse orchestration | generator | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/importExtractors.ts` | `graphs/src/core/parsing/importExtractors.ts` | Import extract | parser | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/importResolution.ts` | `graphs/src/core/resolution/importResolution.ts` | Resolve imports | generator | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/tsconfigPaths.ts` | `graphs/src/core/resolution/tsconfigPaths.ts` | Path aliases | resolution | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/projectFiles.ts` | `graphs/src/core/scanning/projectFiles.ts` | File filters | many | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/ignorePatterns.ts` | `graphs/src/core/scanning/ignorePatterns.ts` | Ignores | service | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/entryDetector.ts` | `graphs/src/core/analysis/entryDetector.ts` | Entry nodes | service | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/pathUtils.ts` | `graphs/src/core/resolution/pathUtils.ts` | Path helpers | core | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/paths.ts` | `graphs/src/core/resolution/paths.ts` | Path/id helpers | core | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/parseHooks.ts` | `graphs/src/core/parsing/parseHooks.ts` | Native parse hook | parser | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/graphCompleteness.ts` | `graphs/src/core/generation/graphCompleteness.ts` | Completeness | service | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/fileDescription.ts` | `graphs/src/core/analysis/fileDescription.ts` | Heuristic desc | description svc | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/fileTypeColors.ts` | `graphs/src/common/constants/fileTypeColors.ts` | Colors | service, UI | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/languageStats.ts` | `graphs/src/core/analysis/languageStats.ts` | Lang stats | maps view | symlink | — | Complete | Deleted | Pass |
| `.../browser/graphEditor.ts` | `graphs/src/host/workbench/graphEditor.ts` | Webview UI | contribution | symlink | — | Complete | Deleted | Pass |
| `.../browser/graphEditorInput.ts` | `graphs/src/host/workbench/graphEditorInput.ts` | Editor input | contribution | symlink | — | Complete | Deleted | Pass |
| `.../browser/prebaseGraphService.ts` | `graphs/src/host/workbench/prebaseGraphService.ts` | Scan/layout host | contribution, maps | symlink | — | Complete | Deleted | Pass |
| `.../browser/prebaseGraphDescriptionService.ts` | `graphs/src/host/workbench/prebaseGraphDescriptionService.ts` | AI descriptions | contribution | symlink | — | Complete | Deleted | Pass |
| `.../browser/prebaseMapsView.ts` | `graphs/src/host/workbench/prebaseMapsView.ts` | Maps sidebar | contribution | symlink | — | Complete | Deleted | Pass |
| `.../browser/media/prebaseMaps.svg` | `graphs/src/host/media/prebaseMaps.svg` | Maps icon | icons/view | copy/symlink | — | Complete | Deleted | Pass |
| `.../test/browser/architecturePick.test.ts` | `graphs/src/tests/unit/architecturePick.test.ts` | Unit | mocha node harness | transpile | self | Complete | Deleted | Pass |
| `.../test/browser/networkLayout.test.ts` | `graphs/src/tests/unit/networkLayout.test.ts` | Unit | mocha node harness | transpile | self | Complete | Deleted | Pass |
| Graph keys in `prebaseConfiguration.ts` | `graphs/src/host/workbench/graphConfigurationContribution.ts` + `graphs/src/settings/index.ts` | Settings | registry | bootstrap import | — | **Extracted** (Phase B) | Allowlisted mixed file retains terminal/runtime keys only | Pass |
| Graph interaction keys (pan/zoom/network drag/node drag delay) | `graphConfigurationContribution.ts` under `prebaseGraph` | Interaction | graphEditor, settings UI | bootstrap | — | **Extracted** (Phase B) | Terminal visibility keys remain in mixed file | Pass |
| Graph cmds in `prebase.contribution.ts` | `graphs/src/host/workbench/graphContribution.ts` + `graphs/src/commands/graphCommandIds.ts` | Commands | contribution | bootstrap | — | **Extracted** (Phase C) | `verify:graphs-boundary` Action2 scan | Done |
| `.../browser/prebaseSettingsEditor.ts` | Graph panels → `graphs/src/host/workbench/settings/graphSettingsUi.ts` | Settings shell routes only | Host bridge | — | graphOwnershipBoundary.test | **Extracted** (Phase A, 2026-07-21) | Shell retained; no `PreBaseGraphConfigKeys` binds | Pass |
| Phase D flat `graphs/src/core/*.ts` shims | Deleted; canonical paths under `core/*/` subdirs | Compatibility | — | — | boundary + ownership test | **Removed** (Phase A) | Deleted | Pass |

`...` = `src/vs/workbench/contrib/prebase`

**Inventory coverage (2026-07-21):** sources under `graphs/src/` with Phase D layout; settings registration/commands (Phases B–C) and Settings UI + shim removal (Phase A) extracted. Remaining allowlist: mixed `prebaseConfiguration.ts` bootstrap + Settings **shell** only.

## Bootstrap allowlist (outside `graphs/`)

| Path | Reason | Owner | Review date | Removal plan |
|---|---|---|---|---|
| `src/vs/workbench/contrib/prebase/browser/prebase.contribution.ts` | Calls `registerPreBaseGraphContribution()`; runtime/home/settings/account only | PreBase | 2026-08-20 | Keep thin bootstrap |
| `src/vs/workbench/contrib/prebase/electron-browser/prebase.desktop.contribution.ts` | Desktop entry | PreBase | 2026-08-20 | Keep as import-only |
| `src/vs/workbench/workbench.common.main.ts` | Entrypoint import | PreBase | 2026-08-20 | Keep |
| `src/vs/workbench/workbench.desktop.main.ts` | Entrypoint import | PreBase | 2026-08-20 | Keep |
| `src/vs/workbench/contrib/prebase/graphs` (symlink) | Build integration bridge | PreBase | 2026-08-20 | Keep while vs-relative imports required |
| `src/vs/workbench/contrib/prebase/browser/prebaseSettingsEditor.ts` | Settings shell; routes graph panels to `graphs/.../settings/graphSettingsUi.ts`; owns terminal visibility UI | PreBase | 2026-08-20 | Keep shell; do not reintroduce graph panel bodies |
| `src/vs/workbench/contrib/prebase/browser/prebaseIcons.ts` | Shared icons incl. Maps/Architecture/Network | PreBase | 2026-08-20 | Optional split later |
| `src/vs/workbench/contrib/prebase/common/prebaseConfiguration.ts` | Mixed bootstrap: calls `registerPreBaseGraphConfiguration()`; terminal visibility + runtime/home keys only | PreBase | 2026-08-20 | Keep thin; graph registry lives under `graphs/` |
| Settings TOC / getting-started references | Shell wiring to command IDs | PreBase | 2026-08-20 | Keep keys/IDs only |
| `extensions/prebase-magnus` graph tools | Extension host; calls commands | Magnus | 2026-08-20 | Optional later move of tool defs |

## Non-graph (do not move)

- Runtime Preview, Home, Onboarding, Account services
- `prebaseIcons.ts` mixed icons — split Maps icons only when safe
- Application icons under `resources/`
