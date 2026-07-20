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
| Settings extract → `graphs/src/settings/` | **Not started** (keys remain in `prebaseConfiguration.ts`) |
| Commands extract → `graphs/src/commands/` | **Not started** (actions remain in `prebase.contribution.ts`) |
| Unit tests | `graphs/src/tests/unit/` (runner via workbench node harness) |
| On-disk core layout | Flat `graphs/src/core/*.ts` (planned `layouts/` subfolders deferred) |

### Symlink + `out/` mirror (soundness checklist)

| Check | Requirement |
|---|---|
| Symlink depth | `prebase/graphs` → `../../../../../graphs/src` (verify with `readlink` after create) |
| `preserveSymlinks` | Add to `src/tsconfig.json` `compilerOptions` before first compile of symlinked sources |
| `rootDir` / include | Symlinked `.ts` must appear under `src/vs/**` in the project `include` glob (`./vs/**/*.ts`) |
| Realpath trap | Default TS/node realpath = repo `graphs/src` → **fatal** without `preserveSymlinks` |
| Git / CI | Commit symlink as symlink; Windows devs may need `git config core.symlinks true` or directory junction documented in runbook |
| Media | `prebaseMaps.svg` must remain loadable from emitted `out/vs/.../graphs/host/media/` (symlink or gulp static copy) |
| Tests (BETA-005) | Moving tests to `graphs/tests/unit/` requires updating the browser unit-test runner globs — interim option: keep tests under `src/vs/.../test/browser/` until runner moves |

### `graphs/tsconfig.json` vs main compile

- **Main workbench compile** (`src/tsconfig.json` + gulp): authoritative for host modules under `prebase/graphs/**` (symlink) including all `vs/**` relative imports.
- **`graphs/tsconfig.json`**: package-scoped `noEmit` lane for core/layout sources without pulling the full workbench graph; not a replacement for gulp after host moves.

### Import path changes

| Old prefix (from `browser/` or `common/`) | New prefix (after move) |
|---|---|
| `../common/graph/<file>.js` | `../graphs/core/<file>.js` or mapped layout path per inventory table |
| `./graphEditor.js` (contribution) | `../graphs/host/workbench/graphEditor.js` |
| `../../common/graph/*` (unit tests) | `../../../graphs/layouts/...` or `../../../graphs/core/...` (per module) |

**Cross-contrib consumers** (not moved; update imports only):

| Path | Graph dependency |
|---|---|
| `browser/prebaseSettingsEditor.ts` | `LayoutMode` from `types.ts` |
| `browser/prebase.contribution.ts` | types, services, editors (becomes thin bootstrap) |

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

Initial move keeps a flatter layout under `graphs/src/core` + `graphs/src/host` to preserve behavior; subfolders above are filled as files land.

## Inventory table

| Old path | New path | Responsibility | Import consumers | Build consumer | Tests | Migration status | Deletion status | Verification |
|---|---|---|---|---|---|---|---|---|
| `.../common/graph/types.ts` | `graphs/src/core/types.ts` | Shared types | Graph service, maps, tests | transpile via symlink | — | Complete | Deleted | Pass |
| `.../common/graph/architectureLayers.ts` | `graphs/src/core/architectureLayers.ts` | Arch layers | Graph service | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/architecturePick.ts` | `graphs/src/core/architecturePick.ts` | Hit testing | tests, editor | symlink | architecturePick.test | Complete | Deleted | Pass |
| `.../common/graph/hierarchyLayout.ts` | `graphs/src/core/hierarchyLayout.ts` | Hierarchy/pyramid/scatter | layoutEngine, service | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/hierarchyDepthVisuals.ts` | `graphs/src/core/hierarchyDepthVisuals.ts` | Depth bands | hierarchy | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/dependencyDepth.ts` | `graphs/src/core/dependencyDepth.ts` | Depth BFS | layouts | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/layoutOrganization.ts` | `graphs/src/core/layoutOrganization.ts` | Org layering | layouts | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/layoutDepthColors.ts` | `graphs/src/core/layoutDepthColors.ts` | Colors | layouts, service | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/layoutEngine.ts` | `graphs/src/core/layoutEngine.ts` | Layout dispatch | service | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/layoutConstraints.ts` | `graphs/src/core/layoutConstraints.ts` | Constraints | hierarchy | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/layoutConfig.ts` | `graphs/src/core/layoutConfig.ts` | Runtime knobs | layouts | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/networkLayout.ts` | `graphs/src/core/networkLayout.ts` | Network 3D layouts | service, tests | symlink | networkLayout.test | Complete | Deleted | Pass |
| `.../common/graph/graphGenerator.ts` | `graphs/src/core/graphGenerator.ts` | Build graph | service | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/parserEngine.ts` | `graphs/src/core/parserEngine.ts` | Parse orchestration | generator | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/importExtractors.ts` | `graphs/src/core/importExtractors.ts` | Import extract | parser | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/importResolution.ts` | `graphs/src/core/importResolution.ts` | Resolve imports | generator | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/tsconfigPaths.ts` | `graphs/src/core/tsconfigPaths.ts` | Path aliases | resolution | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/projectFiles.ts` | `graphs/src/core/projectFiles.ts` | File filters | many | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/ignorePatterns.ts` | `graphs/src/core/ignorePatterns.ts` | Ignores | service | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/entryDetector.ts` | `graphs/src/core/entryDetector.ts` | Entry nodes | service | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/pathUtils.ts` | `graphs/src/core/pathUtils.ts` | Path helpers | core | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/paths.ts` | `graphs/src/core/paths.ts` | Path/id helpers | core | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/parseHooks.ts` | `graphs/src/core/parseHooks.ts` | Native parse hook | parser | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/graphCompleteness.ts` | `graphs/src/core/graphCompleteness.ts` | Completeness | service | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/fileDescription.ts` | `graphs/src/core/fileDescription.ts` | Heuristic desc | description svc | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/fileTypeColors.ts` | `graphs/src/core/fileTypeColors.ts` | Colors | service, UI | symlink | — | Complete | Deleted | Pass |
| `.../common/graph/languageStats.ts` | `graphs/src/core/languageStats.ts` | Lang stats | maps view | symlink | — | Complete | Deleted | Pass |
| `.../browser/graphEditor.ts` | `graphs/src/host/workbench/graphEditor.ts` | Webview UI | contribution | symlink | — | Complete | Deleted | Pass |
| `.../browser/graphEditorInput.ts` | `graphs/src/host/workbench/graphEditorInput.ts` | Editor input | contribution | symlink | — | Complete | Deleted | Pass |
| `.../browser/prebaseGraphService.ts` | `graphs/src/host/workbench/prebaseGraphService.ts` | Scan/layout host | contribution, maps | symlink | — | Complete | Deleted | Pass |
| `.../browser/prebaseGraphDescriptionService.ts` | `graphs/src/host/workbench/prebaseGraphDescriptionService.ts` | AI descriptions | contribution | symlink | — | Complete | Deleted | Pass |
| `.../browser/prebaseMapsView.ts` | `graphs/src/host/workbench/prebaseMapsView.ts` | Maps sidebar | contribution | symlink | — | Complete | Deleted | Pass |
| `.../browser/media/prebaseMaps.svg` | `graphs/src/host/media/prebaseMaps.svg` | Maps icon | icons/view | copy/symlink | — | Complete | Deleted | Pass |
| `.../test/browser/architecturePick.test.ts` | `graphs/src/tests/unit/architecturePick.test.ts` | Unit | mocha node harness | transpile | self | Complete | Deleted | Pass |
| `.../test/browser/networkLayout.test.ts` | `graphs/src/tests/unit/networkLayout.test.ts` | Unit | mocha node harness | transpile | self | Complete | Deleted | Pass |
| Graph keys in `prebaseConfiguration.ts` | `graphs/src/settings/graphConfiguration.ts` (planned) | Settings | registry | bootstrap import | — | **Not extracted** | Retain in allowlisted mixed file | Pending |
| Graph cmds in `prebase.contribution.ts` | `graphs/src/commands/registerGraphCommands.ts` (planned) | Commands | contribution | bootstrap | — | **Not extracted** | Retain in allowlisted contribution | Pending |
| `.../browser/prebaseSettingsEditor.ts` | _(no move — import-only)_ | Settings UI | `LayoutMode` type import | — | — | Complete | Retain file | Pass |

`...` = `src/vs/workbench/contrib/prebase`

**Inventory coverage (2026-07-20):** sources moved to `graphs/src/`; settings/commands extraction **outstanding** (see rows above).

## Bootstrap allowlist (outside `graphs/`)

| Path | Reason | Owner | Review date | Removal plan |
|---|---|---|---|---|
| `src/vs/workbench/contrib/prebase/browser/prebase.contribution.ts` | Registers graph views, editors, **and graph commands** (not thin yet) | PreBase | 2026-08-20 | Extract commands to `graphs/src/commands/` |
| `src/vs/workbench/contrib/prebase/electron-browser/prebase.desktop.contribution.ts` | Desktop entry | PreBase | 2026-08-20 | Keep as import-only |
| `src/vs/workbench/workbench.common.main.ts` | Entrypoint import | PreBase | 2026-08-20 | Keep |
| `src/vs/workbench/workbench.desktop.main.ts` | Entrypoint import | PreBase | 2026-08-20 | Keep |
| `src/vs/workbench/contrib/prebase/graphs` (symlink) | Build integration bridge | PreBase | 2026-08-20 | Keep while vs-relative imports required |
| `src/vs/workbench/contrib/prebase/browser/prebaseSettingsEditor.ts` | Settings shell; graph category UI | PreBase | 2026-08-20 | Keep; import graph types from `../graphs/` |
| `src/vs/workbench/contrib/prebase/browser/prebaseIcons.ts` | Shared icons incl. Maps/Architecture/Network | PreBase | 2026-08-20 | Optional split later |
| `src/vs/workbench/contrib/prebase/common/prebaseConfiguration.ts` | **All `prebase.graph.*` registry entries** (mixed file) | PreBase | 2026-08-20 | Extract to `graphs/src/settings/graphConfiguration.ts` |
| Settings TOC / getting-started references | Shell wiring to command IDs | PreBase | 2026-08-20 | Keep keys/IDs only |
| `extensions/prebase-magnus` graph tools | Extension host; calls commands | Magnus | 2026-08-20 | Optional later move of tool defs |

## Non-graph (do not move)

- Runtime Preview, Home, Onboarding, Account services
- `prebaseIcons.ts` mixed icons — split Maps icons only when safe
- Application icons under `resources/`
