# PreBase Temporal Graph Architecture — Phase 2.7 Final Engine Gate

This document defines the current architecture, verified repairs, and remaining **Temporal-engine** blockers for **PreBase Temporal Graph Phase 2.7**. Phase 3 authorization depends on the Temporal engine gates in this document, not on unrelated PreBase beta or release acceptance work.

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
- **Phase 2 (In Progress — Phase 2.7 Final Engine Gate)**:
  - Temporal entity lineage (cross-commit node and edge stability).
  - Schema v5 SQLite persistence with immutable canonical states, sparse entity/edge transitions, parse artifacts, refs, and the full parent DAG.
  - Exact delta-base DAG reconstruction along the `baseCommitSha` ancestry chain with recomputed canonical digest verification.
  - Bounded on-demand indexing with explicit lineage coverage when an isolated checkpoint has no indexed parent.
  - Incremental AST analysis backed by persistent two-tier parse artifact caching (`TwoTierParseArtifactCache`).
  - Shared workbench Git history service (`IWorkbenchGitHistoryService`) with exact repository open/close/HEAD routing.
  - Per-repository isolated runtime (`TemporalRepositoryRuntime`) with sequential FIFO ingestion queue and in-flight request deduplication.
  - Browser-safe workbench proxy to a validated Electron-main SQLite owner; native bindings are not renderer-reachable.
  - Canonical parsing runs in a per-window utility process behind a cancellable, non-ProxyChannel RPC boundary; Babel remains outside the sandboxed renderer.
  - Temporal store operations carry explicit typed error envelopes over IPC, so cache corruption and cancellation are not downgraded to generic errors.
  - Metadata-only paged history and bounded reconstruction avoid whole-history scans on hot paths; refs are refresh-cached rather than rewritten on every read.
  - Derived parse artifacts are the only retention-eviction target. Explicit maintenance checkpoints/compacts SQLite after eviction and truthfully reports when immutable state exceeds budget.
- **Phase 3 (In Progress — Phase 3.1 Complete)**:
  - Phase 3.1: Timeline, scrubber, stable 2D structural transitions, structural diff & commit comparison with mandatory Phase-3 preflight repairs.
  - Mode registration: `'network' | 'temporal'` in `PreBaseGraphType`, editor input serializer, Maps segmented control, and command `prebase.graph.openTemporal`.
  - Pure Structural Diff Engine (`computeTemporalStructuralDiff`): entity continuity matching, node change kinds (`unchanged`, `modified`, `added`, `removed`, `renamed`), old path tracking, and edge change classification.
  - Stable 2D Layout Engine (`layoutTemporalGraph`): strict 0-displacement continuity invariant for surviving nodes, deterministic directory-clustered initial layout, neighbor-aware placement for added nodes, and phantom exit placement for removed nodes.
  - Workbench Controller (`WorkbenchTemporalViewService`): paged commit timeline (~50), default first-parent compare base, 120ms debounced scrubbing, generation token cancellation, bounded diff caching, follow-HEAD listener, and `vscode.diff` source diff bridge.
  - Webview Canvas 2D Renderer & UI: commit info badge, ref selector, compare base selector, scrubber slider track, Prev/Next/Play buttons, keyboard navigation (`ArrowLeft`, `ArrowRight`, `Space`), structural diff badges (`+A`, `-R`, `~M`, `⇄R`), and smooth 220ms node/edge transitions.
- **Phase 4 (Planned)**:
  - Graph Blame & Magnus Temporal conversational query tools.

> [!WARNING]
> In accordance with repository policy, **Architecture Graph** remains dormant and preserved. Phase 3 remains blocked only by remaining Temporal-engine work: bounded on-demand indexing, truthful segment lineage coverage, sparse persistence/scaling evidence, corruption recovery, and real desktop parser/runtime proof. OAuth, signing, general beta acceptance, and other operator-owned work remain valid PreBase beta/release gates but do not block the Temporal Phase 3 UI.

### Phase 2.7 verified repairs and open gate

Verified in this pass:

- Checkpoint restart restores complete deterministic canonical metadata, including versions, project/source identity, entry node, coverage, manifest, and digest.
- Immutable `graph_states` use a coverage-aware state identity while retaining the structural digest separately; commit-specific Temporal occurrences stay outside the state payload.
- Delta replay restores target metadata and recomputes the canonical digest from reconstructed content.
- One runtime-owned analyzer/ingestion composition coordinates FIFO work, failure recovery, deduplication, and idempotent drain-before-close disposal.
- Git tree listing now crosses the extension-host/main-thread/workbench bridge as a structured inventory and the production Git process stops after observing `maxEntries + 1` or cancellation.
- First-parent temporal queries derive ordering from Git topology rather than `ingested_at`.
- SQLite opens and migrations are serialized, migrations run transactionally, current-schema columns and foreign keys are validated, malformed topology fails closed, and direct checkpoint loads recompute their digest.
- Native SQLite ownership is behind a main-process channel with cache-root and `.db` path validation; the transitive runtime-boundary verifier includes a deliberately invalid fixture.
- Repository discovery, late open, close, HEAD changes, and cold-start runtime creation route through exact per-repository ownership without broadcast fan-out.
- HEAD, local/remote branches, and tags are observed into the shared immutable commit/state model.
- Parser batches use a narrow `IChannel.call(..., cancellationToken)` server channel, carry cancellation into the utility process, and enforce item/source/batch limits without logging source text.
- Parser worker disposal cancels active work, settles queued callers, and prevents worker recreation after disposal; unexpected termination is classified separately from launch failure.
- Temporal IPC returns safe typed error DTOs, and a corruption discovered after open is quarantined/rebuilt once before a safe retry. Quarantine generation cleanup retains a bounded set of DB, WAL, and SHM generations together.
- Timeline status reads request one batch of persisted commit metadata instead of reconstructing graphs or issuing per-row store reads.

Still required before Phase 3:

- Complete real desktop Network and Temporal acceptance with utility-process metrics (L1/L2 hits, worker parses, indexed commits, checkpoints, deltas, max delta depth, and database footprint).
- Complete broader scale validation for sparse transition storage and long-history ingestion; bounded on-demand indexing removes recursive root-history analysis but does not by itself make a Phase-3 UI claim.
- Live Google OAuth and Supabase operator acceptance remain tracked in the PreBase beta backlog; they are not Temporal Phase 3 dependencies.

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
