# Architecture asset manifest

Preserved from git `HEAD` / rollback baseline `efabd9ed4abde12e0f79055cd63f0e5681c40abe` via `git checkout` + `git mv` (rename history retained), plus a First-Test zip recovery for older React/pyramid UI snapshots.

| Original active path | Preserved path | Role |
|---|---|---|
| `graphs/src/architecture/interaction/architecturePick.ts` | `interaction/architecturePick.ts` | Arch hit-testing / pick |
| `graphs/src/core/analysis/dependencyDepth.ts` | `analysis/dependencyDepth.ts` | Arch depth BFS (layout-only) |
| `graphs/src/layouts/architecture/layoutEngine.ts` | `layouts/layoutEngine.ts` | Arch layout dispatch |
| `graphs/src/layouts/architecture/hierarchy/hierarchyLayout.ts` | `layouts/hierarchy/hierarchyLayout.ts` | Hierarchy / **pyramid** / **scattered** modes (same file) |
| `graphs/src/layouts/architecture/hierarchy/hierarchyDepthVisuals.ts` | `layouts/hierarchy/hierarchyDepthVisuals.ts` | Depth band visuals |
| `graphs/src/layouts/shared/layoutConfig.ts` | `layouts/shared/layoutConfig.ts` | Arch layout knobs |
| `graphs/src/layouts/shared/layoutConstraints.ts` | `layouts/shared/layoutConstraints.ts` | Arch constraints (incl. pyramid helpers) |
| `graphs/src/layouts/shared/layoutDepthColors.ts` | `layouts/shared/layoutDepthColors.ts` | Depth colors |
| `graphs/src/layouts/shared/layoutOrganization.ts` | `layouts/shared/layoutOrganization.ts` | Org layering |
| `graphs/src/tests/unit/architecturePick.test.ts` | `tests/architecturePick.test.ts` | Arch pick unit tests (archive only; not run by `test:graphs`) |

## First-Test zip recovery (`legacy-first-test/`)

Recovered from `/Users/qunyingfan/Downloads/PreBase First Test main.zip` into `legacy-first-test/` (not originally under `graphs/src/` on the dual-graph baseline). Snapshot of older Architecture/Network React UI + helpers for reactivation research — **never import from the active runtime**.

Representative contents:

| Preserved path | Role |
|---|---|
| `legacy-first-test/components/graph/GraphCanvas.tsx` | Legacy shared canvas |
| `legacy-first-test/components/graph/PyramidLabels.tsx` | Pyramid depth labels |
| `legacy-first-test/components/graph/HierarchyLabels.tsx` | Hierarchy labels |
| `legacy-first-test/components/graph/ArchitectureOverview.tsx` | Arch overview chrome |
| `legacy-first-test/components/nodes/ArchitectureNode.tsx` | Arch node component |
| `legacy-first-test/components/edges/ArchitectureEdge.tsx` | Arch edge component |
| `legacy-first-test/features/architecture-graph/ArchitectureGraphLegend.tsx` | Arch legend |
| `legacy-first-test/features/network-graph/*` | Legacy Network sidebar/layout |
| `legacy-first-test/utils/architecture-*.ts` | Modes / edges / legend utils |
| `legacy-first-test/core/*`, `state/`, `native/graph.rs` | Older graph builder / store / native stubs |

**Note:** Pyramid and scattered were never separate layout *files* on the dual-graph baseline — they are `case` branches inside `hierarchyLayout.ts` / `layoutEngine.ts`. Styles for the current workbench Architecture SVG were inlined in the host editor (not a standalone `styles/` tree under `layouts/architecture/`).

## Intentionally kept active (not preserved)

| Path | Reason |
|---|---|
| `graphs/src/core/analysis/architectureLayers.ts` | Layer metadata enrichment used by Code Graph |
| Command aliases `prebase.graph.openArchitecture` / `openNetwork` | Coerce → Code Graph |
| Deprecated Arch settings (`included: false`) | Migration / stored preference coerce |

## Not a separate active product path

- Architecture SVG / dual-canvas webview branch (was inlined in host editor; product path removed).
- Active Settings UI controls for hierarchy/pyramid/scatter (hidden; keys remain deprecated — see LEGACY_SETTINGS.md).
