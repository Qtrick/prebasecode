# PreBase Temporal Graph Architecture — Phase 1.1 / Foundation Hardening

This document defines the architecture, data models, Git history interfaces, and structural intelligence contracts established for **PreBase Temporal Graph (Phase 1.1 / Foundation Hardening)**.

---

## 1. Product Model & Graph Modes

PreBase has **one active user-facing Code Graph mode**:
- **Network Graph** — Dynamic, volumetric 3D/2D repository topology, dependency clustering, and architecture layer visualization.

**Temporal Graph** is an approved future mode currently in its foundational infrastructure phases:
- **Phase 1 (Completed)**: Canonical repository graph, Git history interfaces, graph/render separation, and structural diff.
- **Phase 1.1 (Current)**: Foundation correction, runtime boundary repair (zero Node imports in renderer), Git integration unification, parser parity with `ParserEngine`, truthful coverage, and derived query indexing.
- **Phase 2 (Planned)**: Identity versioning, persistence, cache index storage, and extension host Git bridge.
- **Phase 3 (Planned)**: Temporal UI timeline, commit scrubber, and diff overlays.
- **Phase 4 (Planned)**: Graph Blame & Magnus Temporal query tools.

> [!NOTE]
> In accordance with repository policy, **Architecture Graph** remains dormant and preserved. Phase 1 and 1.1 focus strictly on non-UI foundational engine components, exact Git history interfaces, canonical data models, and Magnus structural queries.

---

## 2. Architecture: Canonical Graph vs. View Projection

To support large repositories (10,000+ files) while preserving smooth 60fps 3D rendering in the workbench, PreBase strictly separates the **Canonical Repository Graph** from the **Network View Projection**:

```
                ┌──────────────────────────────────────────────┐
                │          IRepositoryContentSource            │
                │  (WorkingTreeContentSource / GitTreeSource)  │
                └──────────────────────┬───────────────────────┘
                                       │
                                       ▼
                ┌──────────────────────────────────────────────┐
                │          CanonicalGraphAnalyzer              │
                │   • ParserEngine (Babel AST + Fallbacks)     │
                │   • Vue / Svelte / Polyglot component parity │
                │   • Comment stripping & code-like filtering  │
                │   • Layer classification (13 layers)         │
                │   • Entry node detection                     │
                │   • Truthful coverage & failure tracking     │
                │   • Pure TypeScript SHA-256 structural digest│
                └──────────────────────┬───────────────────────┘
                                       │
                                       ▼
                        ┌───────────────────────────────┐
                        │    CanonicalGraphSnapshot     │
                        │ (All supported files ≤ 10,000)│
                        │ + AnalysisManifest (cache OIDs│
                        └───────┬───────────────┬───────┘
                                │               │
             ┌──────────────────┘               └──────────────────┐
             ▼                                                     ▼
 ┌───────────────────────────────┐               ┌───────────────────────────────────┐
 │     projectNetworkGraph       │               │      CanonicalQueryIndex          │
 │  • Importance ranking         │               │  • Indexed nodeById & nodeByPath  │
 │  • Priority edge selection    │               │  • Indexed incoming/outgoing edges│
 │  • Render capping (280 nodes) │               │  • Architecture layer collections │
 │  • 3D/2D volumetric layout    │               └─────────────────┬─────────────────┘
 │  • Visual diagnostics         │                                 │
 └───────────────┬───────────────┘                                 ▼
                 │                               ┌───────────────────────────────────┐
                 ▼                               │      PreBase Magnus AI Agent      │
 ┌───────────────────────────────┐               │  • searchForMagnus                │
 │     Network Graph Renderer    │               │  • getNodeDetailsForMagnus        │
 │  • WebGL 3D / DOM 2D          │               │  • getDependenciesForMagnus       │
 │  • Smooth 60fps interaction   │               │  • getOverviewForMagnus           │
 └───────────────────────────────┘               │  • focusNodeForMagnus             │
                                                 │    (Bounded canonical queries)    │
                                                 └───────────────────────────────────┘
```

### Key Properties
- **Canonical Snapshot**: Captures complete structural knowledge (`GraphNode[]`, `GraphEdge[]`, `entryNodeId`, `coverage`, `digest`, `versions`, `manifest`).
- **Runtime Boundary**: Pure TypeScript implementations with zero `node:child_process`, `node:fs`, `node:crypto` imports in workbench-reached graph source code. Verified via `verify:graphs-runtime-boundary`.
- **View Projection**: Projects canonical knowledge to a rendering budget (default 280 nodes, 420 edges) using degree-weighted importance, entry-node preservation, and priority edge selection.
- **Magnus AI Integration**: Queries `CanonicalQueryIndex` for fast $O(1)$ node lookups, bounded BFS graph dependency traversals, and full codebase visibility.

---

## 3. Versioning & Structural Intelligence

### Version Constants
- `GRAPH_SCHEMA_VERSION = 1`: Incremented when serialized snapshot schema or required properties change.
- `GRAPH_ANALYZER_VERSION = 1`: Incremented when parsing heuristics, import extractors, or layer classifiers change.
- `GRAPH_IDENTITY_VERSION = 1`: Node and edge ID formatting version (`file:<path>`, `import:<src>-><dst>:<spec>`).
- `GRAPH_LAYOUT_VERSION = 1`: Position coordinate computation algorithm version.

### Deterministic Structural Digest
The digest `computeCanonicalGraphDigest()` generates a canonical SHA-256 hash over normalized, sorted nodes and edges using a locale-independent code-unit comparator (`a < b ? -1 : a > b ? 1 : 0`):
- **Node attributes included**: `id`, `kind`, `path`, `meta.architectureLayer`, `meta.language`, `isEntry`, sorted `exports`, sorted `imports`.
- **Edge attributes included**: `id`, `source`, `target`, `kind`, sorted `meta.specifiers`.
- **Excluded**: Layout coordinates (`positions`, `positions3d`), timestamps, camera viewport, and zoom state.

### Structural Diff Contract
`computeCanonicalGraphDiff(oldSnapshot, newSnapshot)` produces a `CanonicalGraphDiff`:
- `addedNodes`, `removedNodeIds`, `updatedNodes`
- `addedEdges`, `removedEdgeIds`, `updatedEdges`
- `isIdentical`: `true` when structural topology and metadata match identically.
- `isIncompatible`: `true` when snapshots have mismatched analyzer or schema versions (`isComparableSnapshots`).

---

## 4. Exact Git History Foundation

Historical analysis operates via `IGitHistoryService` using read-only Git object inspections without ever running `git checkout`:

| Operation | Git Command Specification | Purpose |
|---|---|---|
| Tree Listing | `git ls-tree -r -z -l --full-name <ref>` | Enumerate repository files at any commit with parsed blob sizes. |
| Blob Content | `git show <ref>:<path>` / `git cat-file blob <oid>` | Read historical file content directly from Git object database. |
| Commit Metadata | `git show -s --format=%H%x00%P... <ref>` | Extract author, committer, ISO 8601 dates, timestamps, and all parents. |
| Branch Listing | `git for-each-ref --format=%(refname:short)%00%(objectname) refs/heads/` | List local and remote branches. |
| Tag Listing | `git for-each-ref --format=%(refname:short)%00%(objectname)%00%(*objectname) refs/tags/` | Distinguish lightweight vs annotated tags with peeled commit OIDs. |
| Exact Tree Diff | `git diff-tree -r -z -M --no-commit-id <refA> <refB>` | Exact 2-tree diff with rename detection (`R100`, `oldPath`, `newPath`). |
| Root Commit Diff | `git diff-tree --root -r -z -M --no-commit-id <commit>` | Diffs initial root commit against the Git empty tree hash (`4b825dc642cb6eb9a060e54bf8d69288fbee4904`). |
| Review Diff | `git merge-base <base> <head>` + `git diff-tree` | Three-dot review comparison (merge base to head). |

### Error Boundaries & Typed Results
All Git failures (invalid refs, timeouts, buffer overflows, process errors) throw typed `GitHistoryError` with codes:
- `'UnknownRef'`
- `'Cancelled'`
- `'Timeout'`
- `'BufferLimit'`
- `'RepositoryUnavailable'`
- `'ObjectUnavailable'`
- `'ProcessFailure'`
- `'ParseFailure'`

Git errors are **never converted into empty diffs** (`changes: []`), preserving the distinction between empty commits and failed operations.

---

## 5. Verification & Assurance Matrix

The implementation is verified by 74 unit and integration tests under `graphs/src/tests/unit/`:
- `canonicalGraphAnalyzer.test.ts` — Parser parity with `ParserEngine`, AST comment stripping, Vue/Svelte components, truthful coverage, truncation (>10k files), deterministic digest, and cancellation.
- `canonicalProjection.test.ts` — View projection, 280-node / 420-edge render capping, entry preservation, and prioritized edge selection.
- `canonicalGraphDiff.test.ts` — Zero structural change detection, node/edge additions/deletions, and version guard.
- `canonicalQueryIndex.test.ts` — Fast $O(1)$ Magnus lookups, incoming/outgoing edge indexes, layer collections, and non-rendered canonical node focus semantics.
- `gitHistoryService.test.ts` — Real Git repository fixtures with root commits, branch divergence, annotated/lightweight tag peeling, strict `resolveRef`, typed errors, machine-stable timestamps, and `-l` tree size parsing.
- `gitTreeHistoricalAnalysis.test.ts` — Historical canonical graph analysis, dirty working tree isolation, and commit-to-commit graph diffs.
- `verify:graphs-runtime-boundary` — Static check ensuring 0 forbidden Node runtime imports in graph source files.
- `test:prebase-magnus` — 113 Magnus tool, transport, and secret storage tests passing.
- `assurance:quick` — Full Tier 1 assurance passing.
