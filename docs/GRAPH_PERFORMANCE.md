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
- Node counts: **100** and **500**.

Re-run after layout changes and update the table below with date and `node -v`.

## Results (CPU layout only)

**Run date:** 2026-07-20  
**Environment:** local dev, Node v24.17.0, median ms per layout invocation

### 100 nodes

| Mode | Median (ms) |
|---|---|
| organic | 9.93 |
| sphere | 0.15 |
| constellation | 0.13 |
| clustered | 0.15 |
| radial | 0.11 |

### 500 nodes

| Mode | Median (ms) |
|---|---|
| organic | 306.81 |
| sphere | 0.17 |
| constellation | 0.46 |
| clustered | 0.63 |
| radial | 0.43 |

**Interpretation:** Organic layout dominates cost at larger N; other modes stay sub-millisecond to ~1 ms on this synthetic graph. Product performance with real imports, physics ticks, and rendering may differ.

## Procedure: architecture layout (planned)

| Step | Status |
|---|---|
| Add `benchmark-hierarchy-layout.mjs` with `GraphNode`/`GraphEdge` fixtures | Not Started |
| Record `computeHierarchyLayout` / pyramid / scatter at 100/500 nodes | Not Started |

## Product limits (configuration)

Review caps in `PreBaseGraphConfigKeys` (`maxRenderedNodes`, `maxRenderedEdges`, etc.) during manual large-repo smoke ([GRAPH_ACCEPTANCE.md](GRAPH_ACCEPTANCE.md) A9). Keys marked **Reserved** in settings schema (e.g. `networkSimulationTicks`, `renderThrottleMs`) are not consumed by the webview yet.

## Related backlog

- [BETA_READINESS.md](BETA_READINESS.md) — BETA-024
