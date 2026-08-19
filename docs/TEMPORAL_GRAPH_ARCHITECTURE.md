# PreBase Temporal Graph Architecture — Phase 1.4 / Final Foundation Freeze

This document defines the architecture, data models, Git history interfaces, and structural intelligence contracts established for **PreBase Temporal Graph (Phase 1.4 / Final Production Acceptance and Persistence-Readiness Freeze)**.

---

## 1. Product Model & 4-Phase Roadmap

PreBase has **one active user-facing Code Graph mode**:
- **Network Graph** — Dynamic, volumetric 3D/2D repository topology, dependency clustering, and architecture layer visualization.

**Temporal Graph** is an approved future mode progressing across a canonical four-phase roadmap:
- **Phase 1 (Complete — Frozen at Phase 1.4)**:
  - Canonical repository graph and network render projection separation.
  - Fail-closed snapshot versioning (`GRAPH_ANALYSIS_PROFILE_VERSION = 1`).
  - Production Git history bridge across Extension Host ↔ MainThread ↔ Workbench.
  - Object-format-independent exact tree diffs (`--root`, `--no-abbrev`, SHA-1 and SHA-256 support).
  - Git-native ignore path normalization and asynchronous repository discovery lifecycle.
  - Typed error integrity preserving 12 discrete error categories without silent empty results.
  - Bounded tree enumeration (`scope`, `maxEntries`) and pre-allocation blob size guards.
  - Full blob provenance in exact diffs (`oldBlobOid`, `newBlobOid`, `similarity`).
  - Separation of stable content records in `AnalysisManifest` from run diagnostics.
  - Query index lifecycle optimization (reused on view relayouts).
  - Magnus hidden canonical node query resolution (`resolveNodeFocusForMagnus`).
- **Phase 2 (Complete — Phase 2.2 Production Activation)**:
  - Temporal entity lineage (cross-commit node and edge stability).
  - Schema v3 SQLite persistence layer (`SCHEMA_V3_DDL`) with `commits`, `checkpoints`, `deltas`, `graph_states`, `blob_parse_artifacts`, `refs`, and `commit_parents`.
  - Exact delta-base DAG reconstruction along the `baseCommitSha` ancestry chain with canonical digest verification.
  - Fail-closed parent lineage reconstruction with prerequisite recursive indexing.
  - Incremental AST analysis backed by persistent two-tier parse artifact caching (`TwoTierParseArtifactCache`).
  - Shared workbench Git history service (`IWorkbenchGitHistoryService`) with automatic repository observation and multi-root event routing.
  - Per-repository isolated runtime (`TemporalRepositoryRuntime`) with sequential FIFO ingestion queue and in-flight request deduplication.
- **Phase 3 (Planned Next)**:
  - Temporal UI timeline, commit scrubber, and graph diff overlays.
- **Phase 4 (Planned)**:
  - Graph Blame & Magnus Temporal conversational query tools.

> [!NOTE]
> In accordance with repository policy, **Architecture Graph** remains dormant and preserved. Phase 2 completes and operationalizes the durable temporal persistence engine, DAG delta reconstruction, incremental analysis, and workbench Git event streaming before Phase 3 timeline UI development begins.

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
 │  • 3D/2D volumetric layout    │               │  • Cached across view relayouts   │
 │  • Visual diagnostics         │               └─────────────────┬─────────────────┘
 └───────────────┬───────────────┘                                 │
                 │                               ┌─────────────────┴─────────────────┐
                 ▼                               │      PreBase Magnus AI Agent      │
 ┌───────────────────────────────┐               │  • searchForMagnus                │
 │     Network Graph Renderer    │               │  • getNodeDetailsForMagnus        │
 │  • WebGL 3D / DOM 2D          │               │  • getDependenciesForMagnus       │
 │  • Smooth 60fps interaction   │               │  • getOverviewForMagnus           │
 └───────────────────────────────┘               │  • resolveNodeFocusForMagnus      │
                                                 │    (Structured focus resolution)  │
                                                 └───────────────────────────────────┘
```

### Key Architectural Invariants
1. **Canonical Snapshot**: Captures complete structural knowledge (`GraphNode[]`, `GraphEdge[]`, `entryNodeId`, `coverage`, `digest`, `versions`, `manifest`).
2. **Runtime Boundary**: Pure TypeScript implementations with zero `node:child_process`, `node:fs`, `node:crypto` imports in workbench-reached graph source code. Verified via `verify:graphs-runtime-boundary`.
3. **View Projection**: Projects canonical knowledge to a rendering budget (default 280 nodes, 420 edges) using degree-weighted importance, entry-node preservation, and priority edge selection.
4. **Magnus AI Integration**: Queries `CanonicalQueryIndex` for fast $O(1)$ node lookups, bounded BFS graph dependency traversals, and discovery of canonical nodes omitted from the 280-node render projection.

---

## 3. Versioning & Manifest Stability

### Version Metadata (Fail-Closed)
All graph snapshots enforce strict version compatibility:
- `GRAPH_SCHEMA_VERSION = 1`: Incremented when serialized snapshot schema or required properties change.
- `GRAPH_ANALYZER_VERSION = 1`: Incremented when parsing heuristics, import extractors, or layer classifiers change.
- `GRAPH_IDENTITY_VERSION = 1`: Node and edge ID formatting version (`file:<path>`, `import:<src>-><dst>:<spec>`).
- `GRAPH_LAYOUT_VERSION = 1`: Position coordinate computation algorithm version.
- `GRAPH_ANALYSIS_PROFILE_VERSION = 1`: Static analysis rule profile.

`isComparableSnapshots(a, b)` strictly requires matching integer versions across all fields without defaulting or fallback coercion (`typeof v === 'number' && a.v === b.v`).

### Deterministic Structural Digest
The digest `computeCanonicalGraphDigest()` generates a canonical SHA-256 hash over normalized, sorted nodes and edges using a locale-independent code-unit comparator (`a < b ? -1 : a > b ? 1 : 0`):
- **Node attributes included**: `id`, `kind`, `path`, `meta.architectureLayer`, `meta.language`, `isEntry`, sorted `exports`, sorted `imports`.
- **Edge attributes included**: `id`, `source`, `target`, `kind`, sorted `meta.specifiers`.
- **Excluded**: Layout coordinates (`positions`, `positions3d`), timestamps, camera viewport, and zoom state.

### Analysis Manifest Separation
- **`AnalysisManifestEntry`**: Contains stable per-file content identity records (`path`, `contentIdentity`, `size`, `isComponent`, `architectureLayer`, `language`). Volatile per-file `Date.now()` timestamps are excluded.
- **`AnalysisManifest.runMetadata`**: Captures ephemeral run diagnostics (`analyzedAt`, `durationMs`).

---

## 4. Production Git History Bridge & Exact Object Model

Historical analysis operates via `IGitHistoryService` and `WorkbenchGitHistoryService` using read-only Git object inspections without ever running `git checkout`:

| Operation | Implementation Specification | Invariant / Protection |
|---|---|---|
| Tree Listing | `git ls-tree -r -z -l --full-name <ref> [-- <scope>]` | Producer-side truncation (`maxEntries`), object sizes, blob OIDs. |
| Blob Content | `git cat-file blob <oid>` / `git show <ref>:<path>` | Pre-allocation size check via `getObjectDetails` / `cat-file -s`, object type check (`blob` only). |
| Commit Metadata | `git show -s --format=%H%x00%P... <ref>` | Extract author, committer, ISO 8601 dates, timestamps, and all parents. |
| Strict Ref Resolution | `git rev-parse --verify --end-of-options <ref>^{commit}` | Resolves commits strictly, throws `UnknownRef` on invalid refs, options (`--help`), or trees/blobs. |
| Branch Listing | `git for-each-ref --format=%(refname:short)%00%(objectname) refs/heads/` | Lists local and remote branches. |
| Tag Listing | `git for-each-ref --format=%(refname:short)%00%(objectname)%00%(*objectname) refs/tags/` | Distinguishes lightweight vs annotated tags with peeled commit OIDs and `isAnnotated` metadata. |
| Exact Tree Diff | `git diff-tree -r --raw --no-abbrev --numstat -z <refA> <refB> --` | Exact 2-tree diff with full 40/64 character `oldBlobOid`, `newBlobOid`, and rename tracking (`similarity`). |
| Root Commit Diff | `git diff-tree --root -r --raw --no-abbrev --numstat -z <commit> --` | Object-format-independent root diff against null tree without hardcoded SHA-1 hashes. |
| Review Diff | `git merge-base <base> <head>` + `git diff-tree` | Three-dot review comparison (merge base to head). |
| Git Ignore Check | `git check-ignore -v -z --stdin` | Absolute and relative path normalization matching `extensions/git/src/repository.ts` descendant paths. |

### Error Boundaries & Typed Results
All bridge layers preserve typed `GitHistoryError` codes:
- `'UnknownRef'`
- `'Cancelled'`
- `'Timeout'`
- `'BufferLimit'`
- `'RepositoryUnavailable'`
- `'RepositoryNotFound'`
- `'ObjectUnavailable'`
- `'OversizedBlob'`
- `'NotSupported'`
- `'ProcessFailure'`
- `'ParseFailure'`
- `'HistoryIncomplete'`

Failures are never converted into empty diffs (`changes: []`), preserving the distinction between empty commits and failed operations.

---

## 5. Performance Evidence & Blob Reuse Measurements

In Phase 1.4 real Git fixture benchmarks across a 20-commit history sequence:
- **Average Commit Analysis Duration**: ~50–70ms per historical commit (well within the <200ms target).
- **Blob Reuse Ratio**: **> 75%** content sharing across commits, establishing that Phase 2 cache deduplication by `blobOid` will yield substantial I/O and storage savings.
- **Query Index Search Latency**: < 1ms for $O(1)$ lookups and bounded BFS dependency queries.

---

## 6. Verification & Assurance Matrix

The implementation is verified by 106 unit and integration tests under `graphs/src/tests/unit/`:
- `gitBridgeE2E.test.ts` — Real Git fixture tests: multi-file root diff with `--root`, divergent DAG review ranges, rename tracking, comment-only commit invariant, annotated vs lightweight tag peeling, option injection rejection, unborn repository lifecycle, Magnus node focus resolution, and commit history performance/blob reuse benchmarks.
- `productionGitBridgeContract.test.ts` — Production bridge contract tests: exact vs review diff, tag peeling, committer distinct from author, option injection safety, first-parent log traversal, and oversized blob size bounds.
- `canonicalGraphAnalyzer.test.ts` — Parser parity with `ParserEngine`, AST comment stripping, Vue/Svelte components, truthful coverage, truncation (>10k files), deterministic digest, and cancellation.
- `canonicalProjection.test.ts` — View projection, 280-node / 420-edge render capping, entry preservation, and prioritized edge selection.
- `canonicalGraphDiff.test.ts` — Zero structural change detection, node/edge additions/deletions, and fail-closed version guard.
- `canonicalQueryIndex.test.ts` — Fast $O(1)$ Magnus lookups, incoming/outgoing edge indexes, layer collections, and non-rendered canonical node focus semantics.
- `gitHistoryService.test.ts` — Real Git repository fixtures with root commits, branch divergence, annotated/lightweight tag peeling, strict `resolveRef`, typed errors, machine-stable timestamps, and `-l` tree size parsing.
- `gitTreeHistoricalAnalysis.test.ts` — Historical canonical graph analysis, dirty working tree isolation, and commit-to-commit graph diffs.
- `verify:graphs-runtime-boundary` — Static check ensuring 0 forbidden Node runtime imports in graph source files.
- `verify:icons` — 101/101 frozen icons intact.
- `test:prebase-magnus` — 113 Magnus tool, transport, and secret storage tests passing.
- `assurance:quick` — Full Tier 1 assurance passing.
