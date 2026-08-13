# Graph Layout CPU Baseline — 2026-08-12

## Environment

| Field | Value |
| --- | --- |
| Branch / SHA | `main` / `4ce3093dc3e56b3466b58d1749f4c39e61aa3d44` before this pass |
| OS / architecture | macOS Darwin 25.6.0 / arm64 |
| Node / npm | v24.17.0 / 11.18.0 |
| Electron declaration | 42.8.0 |
| Hardware model and RAM | Not recorded: sandbox did not return the restricted `sysctl` fields. |

## Method

`node --experimental-strip-types --import=./graphs/scripts/graphs-test-register.mjs graphs/scripts/benchmark-network-layouts.mjs`

Synthetic chain-plus-shortcut graph; median of five layout invocations.  This
measures layout CPU only, not workbench startup, paint, FPS, JS heap, or process
RSS.

| Mode | 100 nodes median (ms) | 500 nodes median (ms) |
| --- | ---: | ---: |
| organic | 12.41 | 365.72 |
| sphere | 0.13 | 0.20 |
| constellation | 0.12 | 0.53 |
| clustered | 0.18 | 0.67 |
| radial | 0.13 | 0.46 |

## Interpretation

Organic remains the dominant algorithmic layout cost. This pass improves graph
scan and selection asymptotics, not the organic force-layout algorithm; no FPS
or startup improvement is claimed without launched-workbench measurements.

## Re-run after the scan-path patch

The same command completed after the graph changes with organic at **12.18 ms**
(100 nodes) and **360.41 ms** (500 nodes). Layout itself was not changed, so
this small run-to-run variance is not reported as an optimization result.
