# Comparison to main — One Graph Type

Honest branch comparison of the **Code Graph** experiment on `One-Graph-Type` versus dual-graph **main** (Architecture Graph + Network Graph).

| Item | Value |
|---|---|
| Experiment branch | `One-Graph-Type` |
| Compare baseline | `main` @ rollback `efabd9ed4abde12e0f79055cd63f0e5681c40abe` (when branch tip equals main, use uncommitted worktree + experiment docs) |
| Date | 2026-07-22 |
| Merge claim | **None** — do not merge; do not treat as main beta readiness |

Related: [README.md](./README.md) · [BETA_IMPACT.md](./BETA_IMPACT.md) · [BETA_READINESS.md](./BETA_READINESS.md) · main [`docs/BETA_READINESS.md`](../../BETA_READINESS.md)

## Recommendation

**Continue experimenting.**

Evidence is not sufficient to merge or to claim parity with (much less superiority over) dual-graph main for shipping. Static gates on this branch can pass while GUI acceptance, Magnus agent smoke, and perf samples remain open. Keep iterating on `One-Graph-Type` until OGT-010 evidence and a deliberate merge PR exist.

## Comparison table

| Area | Dual-graph main | One-Graph-Type (this branch) | Verdict |
|---|---|---|---|
| Product surface | Architecture Graph + Network Graph (two types) | Single **Code Graph** (`prebase.graph.open`); Arch/Net open aliases `f1:false` | Experiment goal landed in commands/UI chrome — **GUI smoke still open** |
| Data model | Arch hierarchy + Network 3D snapshots | Unified `schemaVersion: 2` file+import graph + community/degree meta | Progress; no call graph yet |
| Architecture layouts | `layouts/architecture/**` + Arch SVG path | Sources deleted on branch (Phase F); `architectureLayers` metadata kept | Irreversible without restore from rollback SHA — **higher merge risk** |
| Communities | Not a first-class product feature on main | Label-propagation + Maps list + canvas hide wiring | Win for analysis; quality ≠ Leiden |
| Important / bridges / surprising | Absent on main | `importantNodes`, `bridgeNodes`, `surprisingConnections` + Maps Analysis shortcuts | Clear analysis upside; **GUI not verified** |
| Queries | Limited Magnus graph tools historically | `graphQuery` path/affected/search + explain | Better agent surface on branch; agent session smoke open |
| Confidence | Weak / absent | EXTRACTED/INFERRED/AMBIGUOUS on edges | Good foundation; UI surfacing weak |
| Default layout | Network modes (organic, etc.) | Community Force default in schema (stored user value may still be organic) | Needs honest UX check |
| Settings | Arch + Network keys | Code Graph + deprecated Arch keys (`included: false`) | Migration debt remains |
| Magnus tools | Selection / search / deps / overview (+ branch extras if merged) | + path, affected, explain, important, communities, bridges, surprising | Better on paper; **BETA-012 / OGT-008 unverified** |
| Graph ownership | `graphs/` + allowlisted bootstrap | Same boundary rules; Arch product trees rejected by verifier | Boundary OK if `verify:graphs-boundary` green |
| Perf evidence | Layout micro-benchmark on main docs | Community Force not in micro-benchmark; OGT-011 Not Started | **No ship evidence** |
| Acceptance | BETA-003 / BETA-004 Needs Verification | OGT-010 Not Started; ACCEPTANCE rows empty | **Neither side proven ready** |
| Main beta Complete rows | Only BETA-006 / BETA-007 Complete with evidence | Unchanged — experiment must not rewrite main Complete claims | Honesty intact |
| Icons | Frozen sheened monogram | Untouched on this work | OK |

## What improved on the experiment

1. One primary Code Graph entrypoint instead of Arch vs Net product split.
2. Structural analysis stack: communities, important hubs, bridge nodes, surprising cross-community edges.
3. Deterministic local queries + richer Magnus tool surface (still needs agent smoke).
4. Explicit experiment backlog (`OGT-*`) and Graphify concept research without vendoring Graphify.

## What regressed or remains risky

1. Architecture hierarchy layouts removed from sources — dual-graph main still has them; merge would drop that product path unless restored.
2. No GUI acceptance matrix evidence (OGT-010).
3. No Code Graph perf sample for Community Force (OGT-011).
4. Community detection is coarse label-propagation, not production-grade clustering.
5. Deprecated Arch settings and aliases still present — incomplete cleanup.
6. Surprising/bridge/explain UX is Maps/output/Magnus oriented — canvas storytelling unfinished.

## Merge advice (non-binding)

| Condition | Status |
|---|---|
| OGT-010 GUI rows filled with real evidence | Not met |
| Phase E/F Arch deletion accepted with product sign-off | Sources deleted; product sign-off open |
| OGT-011 at least one measured sample | Not met |
| Main BETA honesty preserved in merge PR | Required later |
| Icons / privacy / packaging gates green on candidate | Separate from this experiment |

Until those land, **stay on the experiment branch**. A future merge is a separate decision with a dedicated PR — this document is **not** a merge approval.

## Verification snapshot (this write-up)

Run on the experiment worktree before citing readiness:

```bash
git branch --show-current   # One-Graph-Type
npm run verify:icons
npm run test:graphs
npm run typecheck:graphs
```

Do **not** claim beta-ready or merge-ready from a green static suite alone.
