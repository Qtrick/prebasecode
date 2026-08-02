# Graph acceptance (Phase I)

Manual acceptance for the **Code Graph** (Network-based single product). Architecture Graph product scenarios below are **historical** — the Architecture Graph is no longer exposed; assets live under `graphs/src/preserved/architecture/`.

**Do not mark a row Complete without dated evidence** (screenshot, screen recording, or signed test log with build ID).

Automated gates (not a substitute for GUI smoke): `npm run assurance:graphs`, `npm run verify:graphs-boundary`.

See also: [MAIN_ONE_GRAPH_MIGRATION.md](MAIN_ONE_GRAPH_MIGRATION.md), [GRAPH_NODE_MORPH_RESEARCH.md](GRAPH_NODE_MORPH_RESEARCH.md).

## Evidence standard

| Field | Required |
|---|---|
| Date | ISO date |
| Build | `product.json` commit SHA or `code-oss-dev` version from About |
| Tester | Name or handle |
| Result | Pass / Fail / Blocked |
| Notes | Steps, regressions, linked issue |

## Architecture Graph (historical / superseded)

> Product surface removed 2026-08-01 (BETA-003 Deferred). Rows kept for audit history only.

| # | Scenario | Steps | Expected | Status | Evidence |
|---|---|---|---|---|---|
| A1 | Open Maps / Architecture | Open folder workspace → PreBase Maps → Architecture view | Graph loads; no blank webview | Superseded | Product removed |
| A2–A9 | Legacy Arch scenarios | — | — | Superseded | See preserved assets |

## Code Graph (primary — was Network Graph)

| # | Scenario | Steps | Expected | Status | Evidence |
|---|---|---|---|---|---|
| N1 | Open Code Graph | Maps → Open Code Graph / `prebase.graph.open` | One Code Graph tab; 3D canvas | Needs Verification | — |
| N2 | Layout modes | Community Force, Organic, Sphere, Constellation, Clustered, Radial | Deterministic relayout; mode persists | Needs Verification | — |
| N3 | Rotate | Drag on background | Camera rotates; no stuck pointer | Needs Verification | — |
| N4 | Node morph select | Click idle dot | Dot morphs to ~64×62 Architecture-style card from center | Needs Verification | — |
| N5 | Rapid switch | Select A then B mid-expand | A contracts from current t; B expands; no snap/duplicate | Needs Verification | — |
| N6 | Deselect / Escape | Background click or Escape | Card contracts to dot; inspector clears | Needs Verification | — |
| N7 | Reduced motion | Enable reduceMotion | Immediate or non-spatial swap; still clear selection | Needs Verification | — |
| N8 | Idle RAF | After morph + no rotate | CPU idle; no permanent 60 Hz loop | Needs Verification | — |
| N9 | Legacy restore | Restore Arch/Net tab | Opens single Code Graph; no loop/dup | Needs Verification | — |
| N10 | Large project | 500+ files | Usable; caps respected | Needs Verification | — |

| N5 | Idle auto-rotate | Wait with `networkIdleAutoRotate` enabled | Idle rotation when configured | Needs Verification | — |
| N6 | Physics settings | Adjust force/link/charge in settings | Simulation behavior changes | Needs Verification | — |
| N7 | Pick hit test | Click small node while zoomed out | Node picked (see unit tests `architecturePick`) | Needs Verification | — |

## Automated coverage (2026-07-20)

| Check | Command | Result |
|---|---|---|
| Unit tests | `npm run test:graphs` | Pass — architecture pick (7), network layout (6) |
| Boundary | `npm run verify:graphs-boundary` | Pass |
| Typecheck | `npm run typecheck:graphs` + `typecheck-client` | Pass |

## Related backlog

- [BETA_READINESS.md](BETA_READINESS.md) — BETA-003, BETA-004, BETA-005, BETA-024
- [GRAPH_PERFORMANCE.md](GRAPH_PERFORMANCE.md) — layout CPU micro-benchmarks (not FPS)
