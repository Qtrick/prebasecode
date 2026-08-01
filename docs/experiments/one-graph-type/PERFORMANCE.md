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

## Repetition / resource-growth measurements (cleansing pass)

Measured against the built product running under Xvfb at 1440×900 on the
`/workspace` checkout (360 files, 280 nodes, 109 edges), driven over CDP.
Each round opens the target editor via the Command Palette, waits for it to
settle, closes it with `Ctrl+W`, then forces a GC before sampling
`Performance.getMetrics`. The harness fails loudly if the Command Palette does
not resolve the command, so a flat line cannot be produced by a no-op.

### Code Graph — 10 open/close cycles

| Round | JS heap (MB) | JS event listeners | DOM nodes |
|---|---|---|---|
| baseline | 102.9 | 2590 | 2467 |
| 2 | 101.6 | 2763 | 2533 |
| 4 | 100.9 | 2763 | 2533 |
| 6 | 101.1 | 2763 | 2533 |
| 8 | 101.3 | 2763 | 2533 |
| 10 | 101.5 | 2763 | 2533 |

### PreBase Settings — 10 open/close cycles

| Round | JS heap (MB) | JS event listeners | DOM nodes |
|---|---|---|---|
| baseline | 101.5 | 2763 | 2549 |
| 2 | 101.3 | 2796 | 2703 |
| 4 | 101.5 | 2796 | 2703 |
| 6 | 101.5 | 2796 | 2703 |
| 8 | 101.6 | 2796 | 2703 |
| 10 | 101.7 | 2796 | 2703 |

Reading: both editors take a one-time step on the first open (registering the
editor pane, its input serializer and the webview host) and are then exactly
flat for the remaining eight cycles — listener and DOM counts do not move at
all, and heap drifts 0.6 MB, which is within GC noise. Repeatedly opening and
closing the Code Graph or PreBase Settings does not accumulate listeners,
DOM or webviews.

Not measured here, and therefore not claimed: cold/warm startup timings,
graph scan/layout wall-clock on large repositories, interaction FPS, and
Runtime Preview lifecycle timings. The `Required measurements` table above is
still unfilled and remains the acceptance gate for Code Graph performance.
