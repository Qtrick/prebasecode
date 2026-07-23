# Graphify → PreBase Network / Code Graph merge plan

**Branch:** `One-Graph-Type` (alias ONE-GRAPH-TYPE)  
**Status:** Concepts adapted in native TypeScript under `graphs/` — **no** Graphify Python runtime, **no** branding copy.  
**Companion research:** [GRAPHIFY_RESEARCH.md](./GRAPHIFY_RESEARCH.md) · attribution [../GRAPHIFY_ATTRIBUTION.md](../GRAPHIFY_ATTRIBUTION.md)  
**Examined archive:** Graphify **0.9.23** (`graphifyy` MIT) — see research/attribution for SHA + upstream HEAD.

## Goal

Fold Graphify-inspired analysis/query UX into PreBase’s **single Code Graph** (former Network canvas), while Architecture Graph stays **unavailable in-app** and **preserved on disk** under `graphs/src/preserved/architecture/` (including `legacy-first-test/` from First-Test zip).

## What is already adapted (native TS)

| Concept | PreBase location | Notes vs Graphify 0.9.23 |
|---|---|---|
| Edge confidence / evidence | `graphTypes.ts` + `graphGenerator.ts` | `EXTRACTED` / `INFERRED` / `AMBIGUOUS`; import line → `sourceLine` (call-site evidence deferred — no `calls` edges yet) |
| Canvas confidence dashes + legend | `graphEditor.ts` webview | Solid / dashed / dotted by confidence; legend section |
| Node popup structure + confidence | `graphEditor.ts` + `explainNode` | Local explain in popup (pre-wrap); AI description separate |
| Communities | `core/analysis/communities.ts` | Label propagation (**not** Leiden/Louvain); stable ids |
| Community canvas hide | `prebaseGraphService` → webview `hiddenCommunityIds` | Maps toggles hide on canvas + explorer |
| Important / hub nodes | `core/analysis/importantNodes.ts` | Degree + exclusions (not a `god_nodes` port) |
| Bridge nodes | `core/analysis/bridgeNodes.ts` + `showBridgeNodes` | Cross-community hubs; Maps + F1 + Magnus + Output channel |
| Surprising connections | `core/analysis/surprisingConnections.ts` | One edge per community pair (no betweenness fallback) |
| Path / neighbors / affected / search | `core/query/graphQuery.ts` | Deterministic neighbor order; hops carry `confidence` / `sourceFile` / `sourceLine` / `reason`; truncation / `budgetExceeded` notices |
| Maps Find Path | `prebaseMapsView.ts` | Two-step selection → directed BFS; hop confidence in notification |
| Explain node | `core/analysis/explainNode.ts` | Structured neighborhood + confidence counts (no AI) |
| Community Force layout | `layouts/network/communityForceLayout.ts` | Wired as `networkLayoutMode: 'community'` (default) |
| Magnus tools | `extensions/prebase-magnus` + `graphContribution.ts` | search / node / deps / overview / path / affected / explain / important / communities / bridges / surprising |

## Explicit non-goals (rejected)

- Graphify Python package / CLI sidecar
- vis-network / Graphify HTML exporter
- Graphify name, logos, purple identity in UI
- Restoring Architecture as a second product type on this branch

## Merge rules (Network → Code Graph)

1. **One open path:** `prebase.graph.open` (+ aliases `openArchitecture` / `openNetwork`) → Code Graph only.
2. **One layout family:** `graphs/src/layouts/network/*` only; Arch layouts live under `preserved/architecture/` and must not be imported by active sources (enforced by `verify:graphs-boundary`).
3. **Settings honesty:** Reserved / unconsumed keys use `included: false` and stay out of Settings TOC / PreBase Settings UI until wired (force/link/alphaDecay, Arch layout keys, etc.).
4. **Determinism:** Community ids, query neighbor expansion, and Community Force positions must be stable across runs for the same graph.
5. **License:** Concepts only today — if any Graphify source is later adapted, update `GRAPHIFY_ATTRIBUTION.md` and BETA-025 notices.

## Remaining gaps (block Phase B/C polish)

| Gap | Why it blocks |
|---|---|
| GUI acceptance evidence (OGT-010) | Arch-gone + Code Graph smoke not filled in ACCEPTANCE.md |
| Call graph / `calls` edges | Deferred (needs symbol LOD); Graphify 0.9.23 cites call-sites — PreBase only tags import lines today |
| Community quality | Label-prop only; no oversized-community split / Leiden upgrade |
| No-op reserved keys | Hidden (`included: false`); still need real wiring or permanent removal later |
| Preserved Architecture restore path | Optional `typecheck:graphs-preserved` is green for VS Code-era layouts; not in `assurance` until product decision; `legacy-first-test/` stays archive-only |
| Main-branch dual-graph acceptance (BETA-003/004) | Experiment must not claim main beta Complete |

## Duplicate systems / honesty

| Item | Status |
|---|---|
| Active `layouts/architecture/` / `architecture/` | Must stay empty (boundary + ownership tests) |
| Preserved tree | On disk only; active runtime must not import |
| Dual open commands | Aliases coerce → Code Graph (`f1: false`) |
| Physics / force settings | Registered, `included: false`, ignored by layouts (no-op by design) |
| Minimap toggle | Explicit “not available” notification |

## Validation (this branch)

```bash
npm run verify:graphs-boundary
npm run test:graphs
npm run verify:icons
npm run typecheck:graphs-preserved   # optional; VS Code-era preserved layouts only
```

Do **not** merge to `main` from this experiment without a separate product decision.
