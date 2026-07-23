# One Graph Type (Code Graph) experiment

**Canonical docs for this experiment live in this folder.**

| Item | Value |
|---|---|
| Branch | `One-Graph-Type` (user alias `ONE-GRAPH-TYPE`) |
| Product name | **Code Graph** (PreBase branding only) |
| Inspiration | Graphify 0.9.23 concepts — **not** Graphify branding, logos, purple UI, or product name |
| Rollback SHA | `efabd9ed4abde12e0f79055cd63f0e5681c40abe` |
| Snapshot patch | `.tmp/one-graph-type-snapshots/` (ignored; not committed) |
| Graphify archive | `.tmp/graphify-reference/0.9.23/graphify-0.9.23/` (ignored; MIT) |
| Main beta tracker | [`docs/BETA_READINESS.md`](../../BETA_READINESS.md) — **unchanged Complete claims** |

This experiment is **branch-isolated**. It must not be treated as main-branch beta readiness. Do **not** merge to `main`, force-push, or rewrite main BETA Complete rows from this work.

## Documents in this folder

| Doc | Purpose |
|---|---|
| [GRAPHIFY_RESEARCH.md](./GRAPHIFY_RESEARCH.md) | Feature matrix + honesty vs Graphify 0.9.23 |
| [GRAPHIFY_NETWORK_MERGE.md](./GRAPHIFY_NETWORK_MERGE.md) | How Graphify concepts map into Code Graph / Network renderer |
| [MIGRATION_PLAN.md](./MIGRATION_PLAN.md) | Phase order; Arch unavailable + preserved hard gates |
| [ACCEPTANCE.md](./ACCEPTANCE.md) | GUI acceptance matrix (evidence rows empty until run) |
| [PERFORMANCE.md](./PERFORMANCE.md) | Perf scenarios (measurements TBD) |
| [BETA_IMPACT.md](./BETA_IMPACT.md) | How this experiment reinterprets main beta graph items |
| [BETA_READINESS.md](./BETA_READINESS.md) | Branch backlog **OGT-001…OGT-015** |
| [COMPARISON_TO_MAIN.md](./COMPARISON_TO_MAIN.md) | Honest table vs dual-graph main; recommendation **Continue experimenting** (no merge claim) |

Archive / design notes (pointers only): parent `docs/experiments/ONE_GRAPH_TYPE_*.md` and `GRAPHIFY_*.md` redirect here.

## Branch isolation

1. Stay on `One-Graph-Type`. No `main` merge/push from this experiment.
2. Do **not** modify Dock/application/installer icons or `build/icons/icon-integrity.sha256`.
3. Do **not** mark main `BETA-*` **Complete** because of this branch.
4. Architecture Graph is **unavailable in the app**, but implementation assets are **preserved** under `graphs/src/preserved/architecture/` (not deleted). Active product paths (`layouts/architecture/`, `architecture/`, Arch-only `layouts/shared/`, …) must stay empty; do not import preserved code from the active runtime. GUI Arch-gone proof is still OGT-010.
5. Graphify is research inspiration only — reimplement concepts in TypeScript under `graphs/`. Graphify **0.9.23** remains the pinned reference (latest upstream noted as 0.9.24 — do not bump without a separate research pass).

## How to run

```bash
git switch One-Graph-Type
git branch --show-current   # must print One-Graph-Type
npm run test:graphs
npm run verify:graphs-boundary
npm run verify:icons
npm run typecheck:graphs
npm run typecheck:graphs-preserved   # archive lane; not in assurance:quick
# Optional host surface changes:
npm run typecheck-client
```

Launch PreBase with a throwaway profile (see `.claude/skills/launch/SKILL.md`). Open **Code Graph** via Activity Bar / `prebase.graph.open` (F1: “Open Code Graph”). Capture GUI evidence into [ACCEPTANCE.md](./ACCEPTANCE.md) — do not invent rows.

## How to compare

| Compare | Command / artifact |
|---|---|
| Uncommitted experiment vs rollback | `git diff efabd9ed4abde12e0f79055cd63f0e5681c40abe -- graphs/ extensions/prebase-magnus/ docs/experiments/` |
| Saved snapshot | `.tmp/one-graph-type-snapshots/worktree-*.patch` + `status-*.txt` |
| Vs `main` (advisory only) | `git log main..One-Graph-Type --oneline` — **no merge** |
| Graphify concepts | [GRAPHIFY_RESEARCH.md](./GRAPHIFY_RESEARCH.md) + ignored tree under `.tmp/graphify-reference/` |

## How to revert

Safe file restore (non-destructive to untracked `.tmp/`):

```bash
git switch One-Graph-Type
git checkout efabd9ed4abde12e0f79055cd63f0e5681c40abe -- graphs/ src/vs/workbench/contrib/prebase/ extensions/prebase-magnus/ docs/experiments/
```

Hard reset (**only** if the user explicitly requests destructive reset; never on `main`):

```bash
git switch One-Graph-Type
git reset --hard efabd9ed4abde12e0f79055cd63f0e5681c40abe
```

## Graphify inspiration (not branding)

- Examined: Graphify **0.9.23** (MIT, Copyright (c) 2026 Safi Shamsi).
- Adopted as **concepts**: single knowledge graph, confidence tags, communities, path/affected queries, important/hub nodes.
- **Rejected**: Python sidecar, vis-network HTML exporter port, Graphify product name/UI chrome, mandatory LLM structural pass, hosted MCP listener by default.
- Attribution plan: [`../GRAPHIFY_ATTRIBUTION.md`](../GRAPHIFY_ATTRIBUTION.md) (no Graphify source copied as of Phase F–H).

## Current honesty snapshot (2026-07-22 — preservation correction pass)

| Area | Status |
|---|---|
| Code Graph open path + Arch/Net aliases | Landed (GUI smoke open — OGT-010) |
| Confidence + label-propagation communities | Landed (unit-tested; real `import()` → AMBIGUOUS; no Leiden/Louvain) |
| Magnus path / affected / explain / bridges / surprising | Landed (agent GUI smoke open) |
| Call graph | **Not** implemented |
| Canvas community visibility | Wired in service/webview; **GUI smoke open** |
| Community Force layout | Landed (`community` mode default in schema); clustered remains file-type; stored `organic` not auto-migrated |
| Architecture layout sources | **Preserved** under `graphs/src/preserved/architecture/` (README + ASSET_MANIFEST + LEGACY_SETTINGS); active product paths forbidden; active runtime must not import preserved; GUI Arch-gone proof open |
| Automated gates this pass | Re-run `verify:icons`, `verify:graphs-boundary`, `test:graphs` after preservation restore |
| Main beta Complete claims | Unchanged; experiment does not satisfy BETA-003/004 |
| Recommendation | **Continue experimenting until GUI** — no merge |

## Continuation steps (next)

1. Launch throwaway profile → fill [ACCEPTANCE.md](./ACCEPTANCE.md) Arch-gone + Code Graph rows (OGT-010).
2. GUI-smoke community hide, Settings layout default honesty, Magnus path/affected tools.
3. Capture one large-repo perf sample into [PERFORMANCE.md](./PERFORMANCE.md) (OGT-011).
4. Only then revisit [COMPARISON_TO_MAIN.md](./COMPARISON_TO_MAIN.md) — merge stays **No** until OGT-010 evidenced.
