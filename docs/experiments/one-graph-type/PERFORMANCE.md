# Performance — One Graph Type

Branch: `One-Graph-Type`. Rollback: `efabd9ed4abde12e0f79055cd63f0e5681c40abe`.

## Status

**Not Complete (OGT-011).** Unit tests exist; **no** fresh render/FPS/memory GUI measurements for Code Graph on this branch yet.

## Environment (fill when measuring)

| Field | Value |
|---|---|
| Date | |
| Branch / SHA | One-Graph-Type |
| Platform | |
| Node / Electron | See `docs/TECHNOLOGY_VERSIONS.md` |

## Baseline references (not Code Graph acceptance)

- Network layout CPU micro-benchmark: [`docs/GRAPH_PERFORMANCE.md`](../../GRAPH_PERFORMANCE.md) (organic ~307 ms @ 500 synthetic nodes) — layout CPU only.
- Communities label-propagation: unit stability only; not timed for large n.

## Required measurements

| Scenario | Nodes | Scan | Community | Layout | First paint | Selection | Search | Idle CPU | Memory | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| Small TS | ~100 | | | | | | | | | |
| Medium | ~500–1k | | | | | | | | | |
| Large / aggregated | 5k–10k queryable | | | | | | | | | |

## Known risks

- Idle auto-rotate can keep CPU warm if enabled.
- Community pass is O(passes×(n+m)); may need aggregation (OGT-006) for very large graphs.
- Enabling functions/calls without LOD will explode node count.
- Architecture SVG/React sources are preserved under `graphs/src/preserved/architecture/` and must not re-enter the active bundle.

## Claims allowed

- Automated `test:graphs` may pass — cite exact count from the run.
- Do **not** claim interactive performance targets met without filled rows above.
