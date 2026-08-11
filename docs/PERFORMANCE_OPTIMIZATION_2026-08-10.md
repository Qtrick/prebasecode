# Performance evidence — 2026-08-10

## Organic Network layout

| Metric | Result |
|---|---:|
| Host | macOS arm64; Node v24.17.0 |
| Method | `node --experimental-strip-types --import=./graphs/scripts/graphs-test-register.mjs graphs/scripts/benchmark-network-layouts.mjs` |
| Samples | 5 per layout and graph size; median reported |
| Organic, 100 nodes | 11.62 ms |
| Organic, 500 nodes | 344.78 ms |

The change is a correctness repair: Organic's solver now applies repulsion, links, and radial bounds across X/Y/Z. It is not presented as a performance optimization. The old documented 500-node reference was approximately 307 ms on a prior run, so renderer FPS, memory, idle CPU, and larger-graph profiling remain open.

No continuous layout simulation or permanent RAF was introduced; the existing renderer remains parked while static.
