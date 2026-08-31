# Code Graph acceptance (Phase I)

Manual acceptance template for the single active PreBase Code Graph. **Do not mark a row Complete without dated evidence** (screenshot, screen recording, or signed test log with build ID).

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

## Active Code Graph

| # | Scenario | Steps | Expected | Status | Evidence |
|---|---|---|---|---|---|
| N1 | Open Code Graph | Maps → Code Graph | 3D graph visible | Needs Verification | — |
| N2 | Layout modes | organic, sphere, constellation, clustered (4 active modes; legacy "radial" normalized to "organic") | Deterministic relayout; mode persists in session | Needs Verification | — |
| N3 | Rotate | Drag on background / orbit controls | Camera rotates; no stuck pointer | Needs Verification | — |
| N4 | Node drag | Drag node | Position updates; `networkDragDirection` respected | Needs Verification | — |
| N5 | Idle auto-rotate | Wait with `networkIdleAutoRotate` enabled | Idle rotation when configured | Needs Verification | — |
| N6 | Physics settings | Adjust force/link/charge in settings | Simulation behavior changes | Needs Verification | — |
| N7 | Pick hit test | Click small node while zoomed out | Node picked (see unit tests `architecturePick`) | Needs Verification | — |
| N8 | Layout mode distinctness | Switch between organic, sphere, constellation, clustered | Distinct structural projections; legacy persisted "radial" cleanly maps to organic | Needs Verification | Unit coverage across 4 active layouts + normalization tests |
| N9 | Node spacing and settings | Change node spacing and link length; rotate and zoom active layout | Spacing increases node separation; settings take effect deterministically | Needs Verification | Deterministic unit coverage; GUI screen-space inspection |
| N10 | Selected-node idle lock | Enable idle rotation, select node, close popup, drag, wait, then deselect | Camera stays fixed for the entire selection; manual drag works; only deselection resumes after idle delay | Needs Verification | Webview lifecycle tests; GUI timing evidence required |

## Preserved Architecture assets

Architecture Graph assets are dormant reference material, not a public beta surface. Their historical acceptance rows remain superseded rather than Complete; do not execute them as active-product acceptance. See [`graphs/PRESERVED_ARCHITECTURE.md`](../graphs/PRESERVED_ARCHITECTURE.md) and BETA-003.

## Automated coverage

| Check | Command | Result |
|---|---|---|
| Unit tests | `npm run test:graphs` | Pass — 58 test suites across core, network, temporal, and view models |
| Boundary | `npm run verify:graphs-boundary` | Pass |
| Typecheck | `npm run typecheck:graphs` + `typecheck-client` | Pass |

## Related backlog

- [BETA_READINESS.md](BETA_READINESS.md) — BETA-003, BETA-004, BETA-005, BETA-024
- [GRAPH_PERFORMANCE.md](GRAPH_PERFORMANCE.md) — layout CPU micro-benchmarks (not FPS)
