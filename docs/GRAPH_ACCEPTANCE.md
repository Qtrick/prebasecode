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
| N2 | Layout modes | organic, sphere, constellation, clustered, radial | Deterministic relayout; mode persists in session | Needs Verification | — |
| N3 | Rotate | Drag on background / orbit controls | Camera rotates; no stuck pointer | Needs Verification | — |
| N4 | Node drag | Drag node | Position updates; `networkDragDirection` respected | Needs Verification | — |
| N5 | Idle auto-rotate | Wait with `networkIdleAutoRotate` enabled | Idle rotation when configured | Needs Verification | — |
| N6 | Physics settings | Adjust force/link/charge in settings | Simulation behavior changes | Needs Verification | — |
| N7 | Pick hit test | Click small node while zoomed out | Node picked (see unit tests `architecturePick`) | Needs Verification | — |
| N8 | Sphere vs Radial semantics | Switch between Sphere and Radial at the same node/edge budget | Sphere is one even shell; Radial has an entry/central root and visible BFS radius layers | Needs Verification | Unit metrics cover semantic distinction; GUI front/side/oblique evidence still required |
| N9 | Radial spacing and settings | Change Node spacing and preferred link length; rotate and zoom Radial | No obvious central pile; larger spacing increases center distance; larger link length changes layout | Needs Verification | Deterministic unit coverage; GUI screen-space inspection required |
| N10 | Selected-node idle lock | Enable idle rotation, select node, close popup, drag, wait, then deselect | Camera stays fixed for the entire selection; manual drag works; only deselection resumes after idle delay | Needs Verification | Webview lifecycle tests; GUI timing evidence required |

## Preserved Architecture assets

Architecture Graph assets are dormant reference material, not a public beta surface. Their historical acceptance rows remain superseded rather than Complete; do not execute them as active-product acceptance. See [`graphs/PRESERVED_ARCHITECTURE.md`](../graphs/PRESERVED_ARCHITECTURE.md) and BETA-003.

## Automated coverage (2026-07-20)

| Check | Command | Result |
|---|---|---|
| Unit tests | `npm run test:graphs` | Pass — architecture pick (7), network layout (6) |
| Boundary | `npm run verify:graphs-boundary` | Pass |
| Typecheck | `npm run typecheck:graphs` + `typecheck-client` | Pass |

## Related backlog

- [BETA_READINESS.md](BETA_READINESS.md) — BETA-003, BETA-004, BETA-005, BETA-024
- [GRAPH_PERFORMANCE.md](GRAPH_PERFORMANCE.md) — layout CPU micro-benchmarks (not FPS)
