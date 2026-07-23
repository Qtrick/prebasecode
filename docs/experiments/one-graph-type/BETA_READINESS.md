# Beta Readiness — One Graph Type (branch backlog)

Branch-specific tracker for the unified **Code Graph** experiment on `One-Graph-Type`.

Do **not** mark main-branch BETA items Complete because of this experiment.  
Do **not** mark GUI acceptance Complete without evidence.

Statuses: `Not Started` | `In Progress` | `Blocked` | `Needs Verification` | `Complete` | `Deferred`

Related: [README.md](./README.md) · [MIGRATION_PLAN.md](./MIGRATION_PLAN.md) · [GRAPHIFY_RESEARCH.md](./GRAPHIFY_RESEARCH.md) · [COMPARISON_TO_MAIN.md](./COMPARISON_TO_MAIN.md) · rollback `efabd9ed4abde12e0f79055cd63f0e5681c40abe`

Legacy IDs `OG-001…OG-014` map 1:1 to `OGT-001…OGT-014`. **OGT-015** is new (analysis/UX polish).

Last review: **2026-07-22** (final whole-diff defect review — dynamic-import honesty, settings fallback, perf, a11y partial)

## Main beta honesty

| Main ID | Experiment stance |
|---|---|
| BETA-003 | Superseded on branch by OGT-010 — **not Complete** on main |
| BETA-004 | Network open ≠ Code Graph acceptance — **not Complete** on main |
| BETA-006 / BETA-007 | Remain the only main **Complete** toolchain rows (prior evidence) |
| BETA-014 / 015 / 023 / 033 / 034 | Remain open |
| BETA-035 | Remains Deferred / disabled |

## Items OGT-001…OGT-015

| ID | Description | Severity | Status | Phase | Notes |
|---|---|---|---|---|---|
| OGT-001 | Single Code Graph command/UI surface | Blocker | Needs Verification | D | `open` registered; Home/Maps/Onboarding single CTA; Arch/Net aliases `f1:false`; **GUI smoke still open** |
| OGT-002 | Architecture Graph removal (migrate then delete sources) | Blocker | Needs Verification | F | **Sources deleted** (+ Arch-only `layouts/shared` + `dependencyDepth`). Kept: `architectureLayers.ts` (metadata enrich), openArchitecture/openNetwork aliases, deprecated settings `included:false`, empty `ringBands`/`pyramidBands` back-compat, serializer coerce. Service no longer reads Arch layout settings for view state. Boundary + unit test reject restore. **GUI Arch-gone proof still open via OGT-010**. |
| OGT-003 | Unified graph data model | Blocker | Needs Verification | F–H | `schemaVersion: 2` + community/degree meta; file+import first (no call graph) |
| OGT-004 | Confidence / provenance on edges | High | Needs Verification | F | EXTRACTED/INFERRED/AMBIGUOUS; parser now marks real `import()` as dynamic; fake `specifiers:['dynamic']` heuristic removed; explain confidence counts unit-tested; **UI surfacing still weak** |
| OGT-005 | Communities + canvas filter | High | Needs Verification | G | Label-propagation; Maps list + explorer filter; canvas hide via `hiddenCommunityIds` + webview skip; **GUI smoke still open** |
| OGT-006 | Progressive detail (LOD) | High | Not Started | D–F | Reserved settings unwired |
| OGT-007 | Graph queries (path/affected/search) | Critical | Needs Verification | H | `graphQuery.ts` + budgets; `explainNode.ts` local explain wired; community hide is render/explorer only (queries still see full snapshot) |
| OGT-008 | Magnus Code Graph tools | Critical | Needs Verification | D–H | path/affected/explain/important/communities/bridges/surprising registered; **agent GUI smoke open** |
| OGT-009 | Settings/state migration | Blocker | Needs Verification | C–D | `defaultType`→`code`; Arch keys kept deprecated/ignored; Settings TOC uses `networkLayoutMode`; Settings UI fallback fixed to `community` (was wrongly `organic`); **layout default `community` is schema-only** (does not overwrite stored `organic`) |
| OGT-010 | GUI acceptance matrix | Critical | Not Started | F+ | [ACCEPTANCE.md](./ACCEPTANCE.md) — includes Arch-gone canvas rows; evidence empty |
| OGT-011 | Performance measurements | High | Not Started | C–F | [PERFORMANCE.md](./PERFORMANCE.md) TBD; code path now batches importance (O(edges) once) — still no measured sample |
| OGT-012 | Accessibility for Code Graph | Medium | In Progress | F | Maps community aria + search/analysis aria partial; full matrix open |
| OGT-013 | Graphify license/attribution | Blocker | Needs Verification | B / F–H | Concepts only; no source copied — see attribution doc |
| OGT-014 | Branch vs main comparison / merge advice | High | Needs Verification | Final | [COMPARISON_TO_MAIN.md](./COMPARISON_TO_MAIN.md) — recommendation **Continue experimenting**; **no merge claim**; revisit after OGT-010 |
| OGT-015 | Analysis/UX polish: explain, bridge/surprising nodes, Community Force layout, Maps analysis sections | High | Needs Verification | I | explain + bridgeNodes + surprisingConnections + Community Force + Maps Analysis (incl. Cross-community → Output) with unit coverage; **GUI not verified** |

## Verification this pass (2026-07-22 — final whole-diff defect review)

| Check | Result |
|---|---|
| `npm run verify:icons` | **101/101 OK** (no icon edits) |
| `npm run verify:graphs-boundary` | **OK** — rejects Arch product trees + orphan shared helpers |
| `npm run test:graphs` | **Pass** (**46** tests; +static-named-dynamic confidence guard) |
| `npm run typecheck:graphs` | **Pass** |
| `npm run typecheck-client` | **Pass** |

**Not claimed:** OGT-010 GUI acceptance, Magnus agent session smoke, beta-ready / merge to main.

## Defects fixed this pass (code)

1. Dynamic-import AMBIGUOUS confidence no longer treats a local binding named `dynamic` as `import()`; parser emits `isDynamic` for real dynamic imports.
2. Service stopped seeding `layoutMode` from deprecated Arch layout settings (legacy field is a fixed sentinel only).
3. Settings host fallback for network layout was `organic` while schema default is `community` — aligned to `community`.
4. Webview legend dropped stale “Composition” Arch row; layout rebuild keys ignore dead `layoutMode`.
5. Importance scoring in pick/enrich/layout is batched O(edges) once (was O(nodes×edges)).
6. Maps search + Analysis buttons gained aria-labels; stale “sources retained” comment corrected.
7. `GRAPH_SETTINGS_MAP.md` no longer claims Arch layout keys are Wired.

## Remaining OGT open items (honest continuation)

1. **OGT-010** — Fill Arch-gone + Code Graph GUI evidence rows ([ACCEPTANCE.md](./ACCEPTANCE.md)) — **blocks any merge advice change**
2. **OGT-002** — Keep Needs Verification until GUI proves no blank/SVG/Arch chrome
3. **OGT-001 / OGT-009** — Surface + settings migration GUI smoke (incl. users with stored `organic`)
4. **OGT-005** — Canvas community hide GUI smoke
5. **OGT-007 / OGT-008** — Query + Magnus agent GUI smoke
6. **OGT-004 / OGT-015** — Confidence UI + surprising-nodes polish
7. **OGT-006** — LOD still Not Started
8. **OGT-011** — Perf sample on a large repo
9. **OGT-012** — Full a11y matrix (keyboard/HC/reduced motion)
10. **OGT-013** — Attribution final check before any merge discussion
11. **OGT-014** — Keep **Continue experimenting**; update only after OGT-010 evidence
12. Optional: remove empty `ringBands`/`pyramidBands` once no external consumers; drop `'architecture'` type arm after GUI proof

## Definition of Done (experiment — not main beta)

- OGT-010 evidence filled from real launches
- OGT-002 sources deleted **and** GUI Arch-gone rows evidenced
- OGT-005 canvas visibility honest (works or checkboxes downgraded)
- OGT-011 at least one large-repo sample
- OGT-014 written recommendation (draft exists; finalize after acceptance)
- `verify:icons` still PASS with **no** icon edits
- Main BETA Complete rows unchanged unless separately evidenced

**Current recommendation: Continue experimenting until GUI.** Do not merge to `main`.
