# Graphify Research — One Graph Type

Canonical research for the **Code Graph** experiment on `One-Graph-Type`.  
Graphify is architectural/UX inspiration only. PreBase remains PreBase (no Graphify branding).

**Do not treat this experiment as main-branch beta readiness.**

Parent archive pointer: [`../GRAPHIFY_RESEARCH.md`](../GRAPHIFY_RESEARCH.md) → this file.

## Versions examined

| Source | Version / identity | Notes |
|---|---|---|
| Attached archive | **0.9.23** (`Graphify 0.9.23.zip`) | SHA-256 `c9fc45c172865a170a399fe82370ed0defef2d6f3390edfac2360ac5a658febe` |
| Extracted path (ignored) | `.tmp/graphify-reference/0.9.23/graphify-0.9.23/` | Not committed |
| Package | `graphifyy` (PyPI) | `pyproject.toml` `0.9.23` |
| License | **MIT** | Copyright (c) 2026 Safi Shamsi |
| Site | https://graphify.com/ · docs · concepts | Inspected 2026-07-22 |
| GitHub | https://github.com/Graphify-Labs/graphify | Default branch `v8` |
| Upstream HEAD recorded | `82c46e5358d5b3185b7d66573b52f01e59bd2d06` | **0.9.24 unreleased** — beyond archive |

## PreBase reality (read before the matrix)

| Fact | Detail |
|---|---|
| AST stack | Babel `@babel/parser` + import extractors / regex fallbacks — **not** tree-sitter |
| Default graph | Production scan: `includeFolders: false`, `includeFunctions: false` → **file nodes + import edges** |
| Call graph | **None** yet — no `calls` edge kind in production |
| Communities | Native TS **label propagation** on import/dependency only — **not** Leiden/Louvain |
| Important nodes | Degree + exclusions (`importantNodes.ts`) — not Graphify `god_nodes` port |
| Queries | `graphQuery.ts`: search / neighbors / shortest path / affected — **plus** `explainNode.ts` |
| Bridge / surprising | `bridgeNodes.ts` + `surprisingConnections.ts` (cross-community edges by surprise) |
| Renderer | PreBase Network webview — **not** vis-network CDN HTML |
| Incremental cache | In-memory `GraphGenerator.diff()` only — **no** SHA content-hash disk cache |
| Arch sources | **Preserved** under `graphs/src/preserved/architecture/` (unavailable in-app; active paths empty). `architectureLayers.ts` kept for metadata |

Decision columns in the matrix are mutually exclusive intent flags (`Y` / `—`). Only one of Adopt / Adapt / Reimplement / Defer / Reject should be `Y` per row.

## Feature matrix

| Graphify concept | source file | behavior | PreBase equivalent | Gap | Adopt directly | Adapt conceptually | Reimplement natively | Defer | Reject | Reason | License impact | Test required |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Single knowledge graph product | `cli.py`, `build.py`, `graph.json` | One corpus graph + report/HTML | Code Graph (`'code'`); Arch/Net coerce | Arch product **preserved** (not deleted); dual settings keys linger deprecated | — | Y | — | — | — | Core experiment goal; product surface mostly landed | None (concepts) | GUI OGT-010 + `graphProduct` unit |
| AST / structural extract | `extract.py`, `extractors/*` | tree-sitter multi-lang AST | Babel `ParserEngine` + `GraphGenerator` | Fewer languages; no call extraction | — | — | Y | — | — | Keep TS/Babel; do not vendor tree-sitter Python | None if native | Parser/generator unit + fixtures |
| `calls` relation + call-site line | `extract.py`, changelog 0.9.23 | Directed calls; cite call-site not `def` line | optional `meta.line` on **imports** only | No call graph | — | — | — | Y | — | Needs symbol nodes + LOD (OGT-006) first | None until implemented | Call-site vs def regression tests |
| Confidence EXTRACTED/INFERRED/AMBIGUOUS | `build.py`, edge attrs | Provenance on every edge | `EdgeConfidence` + generator tags; canvas dashes + popup explain | Call-site `calls` evidence deferred | — | Y | Y | — | — | Native fields + canvas/popup landed; call graph still missing | Concepts only | `graphConfidence.test.ts` |
| Communities Leiden→Louvain | `cluster.py` | Deterministic partition + hub labels | `communities.ts` label-propagation | Quality gap vs Leiden/Louvain; no LLM labels | — | Y | Y | — | — | Prefer zero new clustering deps; upgrade optional | Concepts only | `communities.test.ts` (stability, contains excluded) |
| Oversized community split | `cluster.py` | Split communities >25% graph | none | No split / cohesion metrics | — | — | — | Y | — | Needed for large repos with OGT-006 | — | When implemented |
| God / hub nodes | `analyze.py` `god_nodes` | Degree + exclusion heuristics | `importantNodes.ts` + entryDetector | No analysis card / report section | — | Y | Y | — | — | Prefer “Important nodes” UX name | Concepts only | importantNodes coverage via communities/service tests |
| Surprising / bridge connections | `analyze.py` `surprising_connections` | Cross-community edges + betweenness bridges | `bridgeNodes.ts` + `surprisingConnections.ts` | Maps Cross-community → Output; no betweenness fallback | — | Y | Y | — | — | Native TS; import/dependency only; one edge per community pair | Concepts only | `bridgeNodes.test.ts` + `surprisingConnections.test.ts` |
| `explain` node neighborhood | `cli.py` explain | Plain-language neighbors + cut groups | `explainNode.ts` + Magnus `prebase_graph_explain_node` | Plain-language prose still thin (structured JSON) | — | Y | Y | — | — | Landed core; polish UX later | Concepts only | `explainNode.test.ts` |
| Query seed-first + truncation notice | query path / MCP | Ranked results + budget notices | `searchNodes` seed-first + caps; Magnus/`findPath` notices | Some Maps notifications omit full notice text | — | Y | Y | — | — | Extend remaining Maps surfaces if needed | — | `graphQuery.test.ts` |
| Shortest path deterministic | path query | Sorted graph; real relations | `shortestPath` + Maps two-step Find Path; hops include confidence/evidence | Relation labels limited to EdgeKind | — | Y | Y | — | — | Landed core + Maps | — | Path + budgetExceeded tests |
| Affected / reverse deps | `affected.py` | Impact traversal | `getAffected` + Magnus tool | No PR/diff integration | — | Y | Y | — | — | Landed; filter import/dependency | — | Affected truncation tests |
| Incremental SHA cache + watch | `cache.py`, `watch.py` | Content-hash re-extract; delete eviction | `GraphGenerator.diff()` in-memory | No disk cache/watch | — | — | — | Y | — | Packaging/perf later | — | Corrupt/recover tests when added |
| HTML vis-network viewer | `exporters/html.py` | CDN vis-network; physics then off | Network webview renderer | N/A — different host | — | — | — | — | Y | IDE webview ≠ static HTML CDN | Avoid vendoring vis | Renderer acceptance only |
| Physics stabilize then off | HTML exporter options | Physics on → stabilize → disable | Network idle auto-rotate | Opposite UX today | — | — | — | Y | — | Design PreBase settle/pause separately | — | Perf idle CPU |
| Community filter sidebar | HTML viewer | Toggle communities on canvas | Maps Communities list → `hiddenCommunityIds` webview | GUI smoke still open | — | Y | Y | — | — | Service→webview hide wired; explorer filter too | — | GUI + unit |
| Community-colored force layout | HTML / forceAtlas2Based | Layout respects communities | `communityForceLayout.ts` via `networkLayoutMode: 'community'` | Label-prop communities ≠ Leiden quality | — | Y | Y | — | — | Default layout is Community Force | Concepts only | Layout unit + GUI |
| Rationale NOTE/WHY/HACK nodes | extract rationale | Filterable rationale nodes | none | Noise control | — | — | — | Y | — | After core Code Graph stable | — | Filter tests |
| MCP HTTP server | `serve.py` | Local MCP listener | Magnus LanguageModelTools | No default network listener | — | — | — | Y | — | Prefer internal Magnus APIs | — | Tool smoke |
| Python / Graphify CLI sidecar | package `graphifyy` | CLI pipeline | none | Would own packaging/signing risk | — | — | — | — | Y | BETA-015 risk; product rejection | Avoid shipping Graphify binary | N/A |
| Label sanitize / XSS | `security.py`, HTML escape | Cap/escape labels | Webview textContent patterns | Must keep CSP-safe | — | Y | Y | — | — | Never `innerHTML` raw labels | — | Privacy/CSP gates |
| PR dashboard | `prs.py` | PR graph tools | none | Out of Code Graph core | — | — | — | Y | — | Not experiment scope | — | — |
| Hyperedges | docs/concepts | Multi-node relations | none | No UI/a11y story | — | — | — | Y | — | Defer | — | — |
| LLM semantic / summaries | `llm.py`, node-summaries RFC | Optional model pass | Description service (separate) | Must not block structural graph | — | — | — | Y | — | Structural graph offline without model | — | — |

## Pipeline comparison

```
Graphify: detect → extract → build → cluster → analyze → report → export
          (+ cache / watch / serve / query / path / explain / affected)

PreBase:  workspace walk → Babel parse → GraphGenerator → communities/importantNodes
          → Network layout → webview → graphQuery / Magnus tools
```

## Useful ideas (conceptual adopt)

1. One Code Graph product (not Arch vs Net types)
2. Confidence tags on edges
3. Deterministic communities + hub labels
4. Important/hub nodes with exclusions
5. Seed-first bounded queries + path/affected
6. Community filter (canvas, not second graph type)
7. Call-site evidence **when** calls exist
8. Label sanitization / CSP-safe rendering
9. Progressive detail for large repos
10. Pause expensive simulation after settle (PreBase-specific)

## Explicitly rejected

| Idea | Why |
|---|---|
| Mandatory Graphify Python sidecar | Packaging/signing/startup risk |
| Port vis-network / Graphify HTML exporter | Wrong host model |
| Graphify branding / purple / logos / name in UI | Product identity |
| LLM required for structure | Offline structural graph required |
| Hosted MCP listener by default | No new network listener |
| Blind copy of physics/idle defaults | PreBase already has idle auto-rotate |

## License / attribution

- MIT — preserve copyright if any substantial code is adapted (none copied today).
- Prefer reimplement in TypeScript; document inspiration.
- See [`../GRAPHIFY_ATTRIBUTION.md`](../GRAPHIFY_ATTRIBUTION.md).
- Update main BETA-025 evidence only if adapted code ships.

## Decision for this experiment

**Native TypeScript Code Graph** on the existing Network renderer + shared generator, with Graphify-inspired confidence, communities, analysis, and query semantics. **No** Graphify Python runtime. **No** Architecture/Network product split. **No** vis-network port.
