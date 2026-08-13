# Graph performance notes (Phase I)

This document tracks **algorithm CPU time** and memory investigation for graphs. It does **not** claim end-to-end Maps FPS, webview paint time, or Electron GPU metrics until measured in-product.

## Scope

| In scope | Out of scope (until instrumented in GUI) |
|---|---|
| Network layout functions under `graphs/src/layouts/network/` | Canvas draw loop frame time |
| Architecture hierarchy layout (`computeHierarchyLayout`) — future benchmark | WebGL/DOM node count at 60 FPS |
| Unit-test graph generators | Full-repo scan + layout pipeline |

## Procedure: network layout micro-benchmark

From repository root (same loader as graph unit tests):

```bash
node --experimental-strip-types \
  --import=./graphs/scripts/graphs-test-register.mjs \
  ./graphs/scripts/benchmark-network-layouts.mjs
```

- Synthetic chain + shortcut edges (see `graphs/src/tests/unit/networkLayout.test.ts` `makeGraph`).
- Median of 5 iterations per mode.
- Node counts: **100**, **280**, **500**, **1,000**, and **2,000**. The
  script uses five samples through 500 nodes and three above that size.

Re-run after layout changes and update the table below with date and `node -v`.

## Results (CPU layout only)

**Run date:** 2026-08-13
**Environment:** local dev, Node v24.17.0, median ms per layout invocation

| Nodes | Organic | Sphere | Constellation | Clustered | Radial |
|---:|---:|---:|---:|---:|---:|
| 100 | 16.79 | 0.26 | 0.10 | 0.13 | 0.93 |
| 280 | 93.80 | 0.12 | 0.21 | 0.21 | 11.37 |
| 500 | 331.25 | 0.14 | 0.29 | 0.37 | 5.73 |
| 1,000 | 1352.00 | 0.29 | 0.61 | 0.91 | 34.55 |
| 2,000 | 7135.92 | 0.56 | 1.25 | 2.08 | 144.04 |

**Interpretation:** These are milliseconds per synthetic layout invocation on
Node v24.17.0, not GUI FPS or memory. The 1,000- and 2,000-node rows are stress
inputs, not the workbench cap: the current scan flow limits Network layout work
to 600 nodes before rendering. The structure-first Radial layout is materially
cheaper than Organic at all measured sizes, but its final exact collision
validation is quadratic and reaches 144ms at 2,000 nodes. The normal 280-node
render cap measured 11ms. GUI FPS, heap, and idle CPU still need in-product
evidence before BETA-024 can close.

## Procedure: architecture layout (planned)

| Step | Status |
|---|---|
| Add `benchmark-hierarchy-layout.mjs` with `GraphNode`/`GraphEdge` fixtures | Not Started |
| Record `computeHierarchyLayout` / pyramid / scatter at 100/500 nodes | Not Started |

## Product limits (configuration)

Review caps in `PreBaseGraphConfigKeys` (`maxRenderedNodes`, `maxRenderedEdges`, etc.) during manual large-repo smoke ([GRAPH_ACCEPTANCE.md](GRAPH_ACCEPTANCE.md) A9). Keys marked **Reserved** in settings schema (e.g. `networkSimulationTicks`, `renderThrottleMs`) are not consumed by the webview yet.

## Related backlog

- [BETA_READINESS.md](BETA_READINESS.md) — BETA-024
