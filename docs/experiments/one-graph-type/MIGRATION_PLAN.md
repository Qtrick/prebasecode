# Migration Plan — One Graph Type

Branch: `One-Graph-Type`. Rollback: `efabd9ed4abde12e0f79055cd63f0e5681c40abe`.

Canonical product: **Code Graph** — one Activity Bar destination, one sidebar, one editor, one Magnus graph API.

Design archive: [`../ONE_GRAPH_TYPE_ARCHITECTURE.md`](../ONE_GRAPH_TYPE_ARCHITECTURE.md) · [`../ONE_GRAPH_RENDERER_DECISION.md`](../ONE_GRAPH_RENDERER_DECISION.md).

## Hard gates (do not reorder)

| Gate | Required before |
|---|---|
| **Phase D** — `prebase.graph.open`, aliases, Maps/Home/Onboarding single CTA, serializer → `code`, unified `matches()` | Any Architecture **source deletion** |
| Settings migration / deprecate `defaultType` (keys may remain readable) | Removing Arch Settings registration entirely |
| Code Graph open path never requires Arch layout engine | Deleting `layouts/architecture/*` |
| No serializer/command/test requires Arch pick or Arch SVG | Deleting `architecture/interaction/*` + Arch webview branch |

**Forbidden:** delete Architecture layouts, Arch pick, or Arch serializer fallback before Phase D verification.  
**Forbidden:** naive-delete `architectureLayers` / `entryDetector` — keep as enrichers first.

## Phases

| Phase | Focus | Status (2026-07-22) | Primary OGT IDs |
|---|---|---|---|
| A | Branch baseline + checkpoint | Done (docs) | — |
| B | Graphify research | Done | OGT-013 |
| C | Inventory + architecture + renderer decision | Done (design) | OGT-003 design |
| D | Canonical single surface | **Code complete**; GUI open | OGT-001, OGT-008, OGT-009 |
| E | Architecture removal | **Sources deleted** (layouts/pick/shared Arch helpers); GUI Arch-gone via OGT-010 | OGT-002 |
| F | Confidence / provenance | Needs Verification | OGT-004 |
| G | Communities + Important nodes | Needs Verification | OGT-005 |
| H | Queries + Magnus path/affected | Needs Verification | OGT-007, OGT-008 |
| I+ | Explain / bridges / Community Force / canvas filter / LOD / acceptance / perf | Mostly Not Started | OGT-006, OGT-010–015 |

## Phase D — surface (landed; keep verifying)

1. `prebase.graph.open` → Code Graph via Network renderer path
2. Alias `openArchitecture` / `openNetwork` / `switchType` → `open` (`f1: false`)
3. Serializer: `architecture` \| `network` \| `code` → Code Graph; corrupt → `code`
4. Maps: no Arch/Net toggle; Layout section; Communities list (explorer filter)
5. Editor title Code Graph; resource `prebase-graph:/code`
6. Home / Onboarding / Getting Started → single CTA
7. Settings: `defaultType` default `code`; Arch keys hidden/deprecated
8. ~~Leave `layouts/architecture/*` on disk until Phase E~~ → **deleted** (Phase F)

## Phase E — Architecture removal (**sources deleted**; GUI still open)

1. Keep analysis enrichers (`entryDetector`, `architectureLayers`) as Code Graph metadata — **done**
2. Confirm open/scan/layout paths do not need Arch SVG / `LayoutEngine` for product UX — **code path done**; GUI via OGT-010
3. Remove dead Arch Maps/Settings chrome (mostly done; keys deprecated `included:false`)
4. Delete `layouts/architecture/**` + Arch pick + Arch-only shared helpers — **done**
5. Boundary verifier rejects restored Arch product trees (aliases allowed) — **done**

## Phase I — product polish (next code)

Prioritized remaining gaps (Arch sources already gone):

1. **OGT-010 GUI** — Arch-gone + Code Graph canvas evidence (blank/SVG regression)
2. Confidence / community surfacing in inspector
3. Surprising-nodes card (bridges landed)
4. **LOD / progressive detail** (OGT-006)
5. Perf sample (OGT-011)

## Next code files to touch (exact)

| Priority | Gap | Files |
|---|---|---|
| P0 | GUI acceptance evidence | Launch + [ACCEPTANCE.md](./ACCEPTANCE.md) rows (no invent) |
| P1 | Confidence in inspector/canvas | `graphEditor.ts` webview HTML/CSS, popup meta |
| P1 | Surprising-nodes card | Maps + `bridgeNodes.ts` consumers |
| P2 | LOD | reserved keys in `graphConfigurationContribution.ts` + layout/render path |
| P3 | Drop deprecated Arch settings / `'architecture'` type arm | after migration window + OGT-010 |

## Rollback

```bash
git switch One-Graph-Type
git checkout efabd9ed4abde12e0f79055cd63f0e5681c40abe -- graphs/ src/vs/workbench/contrib/prebase/ extensions/prebase-magnus/ docs/experiments/
```

## Explicit non-goals

- Merge to main
- Beta-ready claim
- Python sidecar / vis-network port
- Hosted Magnus re-enable
- Minimap implementation
- Application/Dock icon changes
