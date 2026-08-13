# Graph acceptance (Phase I)

Manual acceptance templates for Architecture and Network graphs. **Do not mark a row Complete without dated evidence** (screenshot, screen recording, or signed test log with build ID).

Automated gates (not a substitute for GUI smoke): `npm run assurance:graphs`, `npm run verify:graphs-boundary`.

Settings registration lives under `graphs/` (`registerPreBaseGraphConfiguration`). The **PreBase Settings** graph panel UI remains in allowlisted `prebaseSettingsEditor.ts` — see [`graphs/src/settings/README.md`](../graphs/src/settings/README.md).

## Evidence standard

| Field | Required |
|---|---|
| Date | ISO date |
| Build | `product.json` commit SHA or `code-oss-dev` version from About |
| Tester | Name or handle |
| Result | Pass / Fail / Blocked |
| Notes | Steps, regressions, linked issue |

## Architecture Graph

| # | Scenario | Steps | Expected | Status | Evidence |
|---|---|---|---|---|---|
| A1 | Open Maps / Architecture | Open folder workspace → PreBase Maps → Architecture view | Graph loads; no blank webview | Needs Verification | — |
| A2 | Hierarchy layout | Default or switch to hierarchy | Nodes on depth rings; entry near center | Needs Verification | — |
| A3 | Pyramid / scatter modes | Toggle architecture layout modes in toolbar or settings | Positions update; no throw in devtools | Needs Verification | — |
| A4 | Selection | Click node | Inspector/sidebar highlights file; selection visible on canvas | Needs Verification | — |
| A5 | Zoom / pan | Wheel + drag | Smooth navigation; settings sensitivities apply when wired | Needs Verification | — |
| A6 | Edge labels setting | Toggle `prebase.graph.showEdgeLabels` | Labels show/hide per setting | Needs Verification | — |
| A7 | Minimap setting | Toggle `prebase.graph.showMinimap` | **Known stub** (BETA-020); no false promise of minimap UI | Needs Verification | — |
| A8 | Reduce motion | Enable `prebase.graph.reduceMotion` | Animations reduced where implemented | Needs Verification | — |
| A9 | Large project smoke | Repo with 500+ source files | Graph remains usable; caps from `maxRenderedNodes` respected | Needs Verification | — |

## Network Graph

| # | Scenario | Steps | Expected | Status | Evidence |
|---|---|---|---|---|---|
| N1 | Open Network view | Maps → Network | 3D graph visible | Needs Verification | — |
| N2 | Layout modes | organic, sphere, constellation, clustered, radial | Deterministic relayout; mode persists in session | Needs Verification | — |
| N3 | Rotate | Drag on background / orbit controls | Camera rotates; no stuck pointer | Needs Verification | — |
| N4 | Node drag | Drag node | Position updates; `networkDragDirection` respected | Needs Verification | — |
| N5 | Idle auto-rotate | Wait with `networkIdleAutoRotate` enabled | Idle rotation when configured | Needs Verification | — |
| N6 | Physics settings | Adjust force/link/charge in settings | Simulation behavior changes | Needs Verification | — |
| N7 | Pick hit test | Click small node while zoomed out | Node picked (see unit tests `architecturePick`) | Needs Verification | — |
| N8 | Sphere vs Radial semantics | Switch between Sphere and Radial at the same node/edge budget | Sphere is one even shell; Radial has an entry/central root and visible BFS radius layers | Needs Verification | Unit metrics cover semantic distinction; GUI front/side/oblique evidence still required |
| N9 | Radial spacing and settings | Change Node spacing and preferred link length; rotate and zoom Radial | No obvious central pile; larger spacing increases center distance; larger link length changes layout | Needs Verification | Deterministic unit coverage; GUI screen-space inspection required |
| N10 | Selected-node idle lock | Enable idle rotation, select node, close popup, drag, wait, then deselect | Camera stays fixed for the entire selection; manual drag works; only deselection resumes after idle delay | Needs Verification | Webview lifecycle tests; GUI timing evidence required |

## Automated coverage (2026-07-20)

| Check | Command | Result |
|---|---|---|
| Unit tests | `npm run test:graphs` | Pass — architecture pick (7), network layout (6) |
| Boundary | `npm run verify:graphs-boundary` | Pass |
| Typecheck | `npm run typecheck:graphs` + `typecheck-client` | Pass |

## Related backlog

- [BETA_READINESS.md](BETA_READINESS.md) — BETA-003, BETA-004, BETA-005, BETA-024
- [GRAPH_PERFORMANCE.md](GRAPH_PERFORMANCE.md) — layout CPU micro-benchmarks (not FPS)
