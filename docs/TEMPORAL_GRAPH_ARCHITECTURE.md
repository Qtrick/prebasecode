# PreBase Temporal Graph Architecture — Phase 1 / Foundation

This document defines the architecture, data models, Git history interfaces, and structural intelligence contracts established for **PreBase Temporal Graph (Phase 1 / Foundation)**.

---

## 1. Product Model & Graph Modes

PreBase supports two active first-party graph modes:
1. **Network Graph** — Dynamic, volumetric 3D/2D repository topology, dependency clustering, and architecture layer visualization.
2. **Temporal Graph (Foundation)** — Historical commit graph analysis, exact tree-to-tree structural diffs, versioned snapshots, and Git DAG traversal without repository checkout.

> [!NOTE]
> In accordance with repository policy, **Architecture Graph** remains dormant and preserved. Phase 1 of the Temporal Graph focuses strictly on the non-UI foundational engine, exact Git adapter, canonical data model, and Magnus structural queries. The interactive Temporal timeline/slider UI is reserved for Phase 2.

---

## 2. Architecture: Canonical Graph vs. View Projection

To support large repositories (10,000+ files) while preserving smooth 60fps 3D rendering in the workbench, PreBase separates **Canonical Repository Graph** from **Network View Projection**:

```
                ┌──────────────────────────────────────────────┐
                │          IRepositoryContentSource             │
                │  (WorkingTreeContentSource / GitTreeSource)  │
                └──────────────────────┬───────────────────────┘
                                       │
                                       ▼
                ┌──────────────────────────────────────────────┐
                │          CanonicalGraphAnalyzer              │
                │   • AST / Import parsing                     │
                │   • Layer classification (13 layers)         │
                │   • Entry node detection                     │
                │   • Completeness & exclusion tracking        │
                │   • Deterministic SHA-256 structural digest  │
                └──────────────────────┬───────────────────────┘
                                       │
                                       ▼
                       ┌───────────────────────────────┐
                       │    CanonicalGraphSnapshot     │
                       │ (All supported files ≤ 10,000)│
                       └───────┬───────────────┬───────┘
                               │               │
            ┌──────────────────┘               └──────────────────┐
            ▼                                                     ▼
┌───────────────────────────────┐               ┌───────────────────────────────────┐
│     projectNetworkGraph       │               │      PreBase Magnus AI Agent      │
│  • Importance ranking         │               │  • searchForMagnus                │
│  • Render capping (280 nodes) │               │  • getNodeDetailsForMagnus        │
│  • 3D/2D volumetric layout    │               │  • getDependenciesForMagnus       │
│  • Visual diagnostics         │               │  • getOverviewForMagnus           │
└───────────────┬───────────────┘               │    (Queries full canonical graph  │
                │                               │     with bounded result sets)     │
                ▼                               └───────────────────────────────────┘
┌───────────────────────────────┐
│     Network Graph Renderer    │
│  • WebGL 3D / DOM 2D          │
│  • Smooth 60fps interaction   │
└───────────────────────────────┘
```

### Key Properties
- **Canonical Snapshot**: Captures complete structural knowledge (`GraphNode[]`, `GraphEdge[]`, `entryNodeId`, `completeness`, `digest`, `versions`).
- **View Projection**: Projects canonical knowledge to a rendering budget (default 280 nodes, 420 edges) using in/out degree importance scoring and entry node preservation.
- **Magnus AI Integration**: Magnus searches and inspects `_canonicalSnapshot`, ensuring full codebase visibility without being constrained by renderer viewport caps.

---

## 3. Versioning & Structural Intelligence

### Version Constants
- `GRAPH_SCHEMA_VERSION = 1`: Incremented when serialized snapshot schema or required properties change.
- `GRAPH_ANALYZER_VERSION = 1`: Incremented when parsing heuristics, import extractors, or layer classifiers change.
- `GRAPH_IDENTITY_VERSION = 1`: Node and edge ID formatting version (`file:<path>`, `import:<src>-><dst>:<spec>`).
- `GRAPH_LAYOUT_VERSION = 1`: Position coordinate computation algorithm version.

### Deterministic Structural Digest
The digest `computeCanonicalGraphDigest()` generates a canonical SHA-256 hash over normalized, sorted nodes and edges:
- **Node attributes included**: `id`, `kind`, `path`, `meta.architectureLayer`, `meta.language`, `isEntry`.
- **Edge attributes included**: `id`, `source`, `target`, `kind`, `meta.specifiers`.
- **Excluded**: Layout coordinates (`positions`, `positions3d`), timestamps, camera viewport, and zoom state.

### Structural Diff Contract
`computeCanonicalGraphDiff(oldSnapshot, newSnapshot)` produces a `CanonicalGraphDiff`:
- `addedNodes`, `removedNodeIds`, `updatedNodes`
- `addedEdges`, `removedEdgeIds`, `updatedEdges`
- `isIdentical`: `true` when structural topology and metadata match identically (digest match).

---

## 4. Exact Git History Foundation

Historical analysis operates via `GitHistoryService` using direct, read-only Git object inspections without ever running `git checkout`:

| Operation | Git Command Implementation | Purpose |
|---|---|---|
| Tree Listing | `git ls-tree -r -z --full-name <ref>` | Enumerate repository files at any commit/tag without touching working tree. |
| Blob Content | `git show <ref>:<path>` / `git cat-file blob <oid>` | Read historical file content directly from Git object database. |
| Commit Metadata | `git show -s --format=... <ref>` | Extract author, committer, commit message, and **all parents** (0 for root, 1 for linear, 2+ for merge). |
| Exact Tree Diff | `git diff-tree -r -z -M --no-commit-id <refA> <refB>` | Exact 2-tree diff with rename detection (`R100`, `oldPath`, `newPath`). |
| Root Commit Diff | `git diff-tree --root -r -z -M --no-commit-id <commit>` | Diffs initial root commit against the Git empty tree hash (`4b825dc642cb6eb9a060e54bf8d69288fbee4904`). |
| Review Diff | `git merge-base <base> <head>` + `git diff-tree` | Three-dot review comparison (merge base to head). |

### Working Tree Isolation
Historical analysis through `GitTreeContentSource` guarantees that:
1. Working tree files (clean or dirty) are never modified.
2. Uncommitted dirty files never leak into historical commit graph models.
3. `HEAD` is never shifted or detached.

---

## 5. Verification & Assurance Matrix

The implementation is verified by 71 unit and integration tests under `graphs/src/tests/unit/`:
- `canonicalGraphAnalyzer.test.ts` — Canonical completeness, deterministic digest, cancellation, and exclusion handling.
- `canonicalProjection.test.ts` — View projection, render limits, importance ranking, and determinism.
- `canonicalGraphDiff.test.ts` — Zero structural change detection, node/edge additions, deletions, and metadata updates.
- `gitHistoryService.test.ts` — Real Git repository fixtures with root commits, branch divergence, merge commits, renames, and unicode/special paths.
- `gitTreeHistoricalAnalysis.test.ts` — Historical canonical graph analysis, dirty working tree isolation, and commit-to-commit graph diffs.
- `test:prebase-magnus` — 113 Magnus tool, transport, and secret storage tests passing.
- `assurance:quick` — Full assurance tier passing (boundary, startup, dialogs, typescript lanes, icons, supabase).
