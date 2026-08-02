# One-Graph Phase A Plan — Semantic Port to MAIN

> **SUPERSEDED (2026-08-02).** Checkpoint 1 snapshot only. Implementation progressed on `main`: single **Code Graph** is wired, Architecture assets live under `graphs/src/preserved/architecture/`, morph presentation exists. Do **not** treat the dual-graph inventory below as current product state. See [`MAIN_ONE_GRAPH_MIGRATION.md`](MAIN_ONE_GRAPH_MIGRATION.md), [`GRAPH_NODE_MORPH_RESEARCH.md`](GRAPH_NODE_MORPH_RESEARCH.md), and [`BETA_READINESS.md`](BETA_READINESS.md) (BETA-037).

**Status at Checkpoint 1 (historical):** branch verification + plan only.  
**Branch baseline then:** `main` @ `9fde0994`.  
**Product direction (still locked):** MAIN exposes **only Code Graph** (Network-based renderer). Architecture Graph leaves the active product surface; assets stay dormant under `graphs/src/preserved/architecture/`. Selected dots morph into Architecture-style cards. **No React Flow** in the active renderer.

**Note on OGT archive vs git branch:** The zip extract used at Checkpoint 1 appeared to delete Architecture without `preserved/`. The git branch `One-Graph-Type` **does** contain `graphs/src/preserved/architecture/` — prefer that branch (or a complete extract) over the incomplete zip when porting.

---

## Checkpoint 1 verification (historical)

| Check | Result at CP1 | Status after MAIN migration |
|---|---|---|
| Branch | `main` | Still `main` |
| Dual-graph product | Confirmed active | **Removed from product surface** — Code Graph only |
| `graphs/src/preserved/` | Did not exist yet | **Present** with Arch + First Test refs |
| React Flow on MAIN | Absent | Still absent from active renderer |
| Icons | Untouched | Still frozen / verify:icons |

The remainder of this document is the Checkpoint 1 plan inventory and is retained for audit trail only.


### Editors & commands

| Surface | IDs / behavior |
|---|---|
| Editor pane | `PreBaseGraphEditor` + `PreBaseGraphEditorInput` (resource `prebase-graph:/{architecture\|network}`) |
| F1 open | `prebase.graph.openArchitecture`, `prebase.graph.openNetwork` |
| Switch | `prebase.graph.switchType` toggles architecture ↔ network |
| Webview | Single HTML webview in `graphEditor.ts`: Architecture **SVG** branch + Network **canvas** branch |

### Sidebar / Maps / Settings / Home / Onboarding

| Surface | Dual-graph evidence |
|---|---|
| Sidebar | `workbench.view.prebase.maps` → `PreBaseMapsViewPane` Architecture / Network segment + Arch modes + Network layouts |
| Settings registration | `graphConfigurationContribution.ts` — Arch layout/mode keys **and** Network force/layout/idle-rotate keys |
| Settings UI | `graphSettingsUi.ts` — Architecture layout controls + Network graph advanced card |
| Home | `prebaseHomeEditor.ts` — dual CTAs → openArchitecture / openNetwork |
| Onboarding | `prebaseOnboardingEditor.ts` — explains both layout families; dual CTAs |
| Icons (editor glyphs only) | `prebaseArchitectureEditorIcon`, `prebaseNetworkEditorIcon` in `prebaseIcons.ts` — **not** Dock/app icons |
| Bootstrap | `prebase.contribution.ts` calls `registerPreBaseGraphContribution()` |

**Verdict:** MAIN is a dual-graph product. One-Graph migration must **retire Architecture as a product mode**, not assume MAIN already matches One-Graph-Type.

---

## Architecture verdict (how to port)

Port the **One-Graph-Type product direction** into MAIN **semantically**:

1. **Keep MAIN host/runtime/cloud/dark-surface/cleanup** unless a graph registration or webview change strictly requires a touch.
2. **Reuse MAIN’s Network webview/canvas path** as the Code Graph canvas (same renderer decision as the experiment: reject vis-network / Graphify HTML / Python sidecar).
3. **Do not wholesale overwrite** MAIN from the One-Graph-Type or First-Test zip/archive.
4. **Preserve Architecture implementation** under `graphs/src/preserved/architecture/` before removing it from active imports/paths.
5. **Borrow First Test card visuals only** (compact selected-node chrome: label, kind icon, teal selection ring, folder/file density) — reimplement in the existing Network canvas/DOM overlay. **Do not adopt React Flow / `@xyflow` as the active renderer.**

Treat One-Graph-Type as a **design + command-surface checklist**, not a file dump. The extracted OGT tree **deleted** Architecture layouts without a `preserved/` tree — that is a **defect relative to the locked product direction** and must not be repeated on MAIN.

---

## Corrected phased plan (MAIN)

### Phase A — this checkpoint (docs + protection)

- [x] Verify `main` @ `9fde0994`, clean tree, icon snapshot present
- [x] Inventory dual-graph registrations (commands, editor, Maps, settings, Home, onboarding)
- [x] Confirm Architecture + Network both active
- [x] Write this plan with must-not-do + morph placeholder
- [ ] No migration code in Phase A

### Phase B — canonical single product surface (smallest safe UX cutover)

**Goal:** One user-facing Code Graph without deleting Architecture sources yet.

**Internal type decision (lock in B0 before coding):** Prefer **product name Code Graph** with internal renderer path = today’s Network pipeline. Two acceptable encodings (pick one in B0; do not mix mid-PR):

| Option | Internal `graphType` | Pros | Cons |
|---|---|---|---|
| **B0-A (recommended for MAIN)** | Keep `'network'` as sole live type; brand UI “Code Graph” | Smallest diff vs MAIN service/webview | Serializer/docs must map legacy `architecture` → `network` |
| **B0-B** | Introduce `'code'` as sole live type; map `network`/`architecture` → `code` | Matches OGT naming | Larger type/union/test churn on MAIN |

Do **not** keep both `network` and `code` as separately reachable product modes.

**Ordering vs Phase C:** Phase B may leave Architecture sources on disk with **UI unreachable** (dead product path OK short-term). Phase C then moves those sources to `preserved/`. Do **not** delete in B. Optional: run C inventory (file list only) before B coding starts.

1. Introduce canonical open path `prebase.graph.open` → Code Graph via **Network renderer/data path**.
2. Alias `openArchitecture` / `openNetwork` / `switchType` → Code Graph (`f1: false` or hidden) so Magnus/scripts/bookmarks do not hard-fail.
3. Editor title **Code Graph**; serializer accepts legacy `architecture` \| `network` (and `code` if B0-B) → sole live type; corrupt → sole live type.
4. Maps: remove Architecture/Network mode toggle; keep Network layout controls; rename chrome to Code Graph.
5. Home / Onboarding / Getting Started → **single** Code Graph CTA; update copy (no dual layout families pitch).
6. Settings: `defaultType` → sole live type; hide or deprecate Architecture-only keys (`included: false` / deprecationMessage) — **do not delete keys yet**.
7. Architecture layout/pick sources remain on disk through B; service/webview must not require the Architecture SVG branch for open/scan. Imports may linger until Phase C move.

**Exit criteria:** F1 / Maps / Home / Onboarding expose one graph; Architecture SVG product path unreachable from UI; `verify:icons` still 101/101; Runtime Preview / cloud / dark-surface untouched unless a string conflict forces a one-line copy fix.

### Phase C — preserve Architecture assets (dormant)

**Goal:** Architecture leaves the active tree but remains recoverable.

1. Create `graphs/src/preserved/architecture/` with README + ASSET_MANIFEST (+ optional LEGACY_SETTINGS map).
2. Move (git mv) active Architecture product sources into preserved, including at minimum:
   - `graphs/src/layouts/architecture/**`
   - `graphs/src/architecture/**` (pick/interaction)
   - Architecture-only helpers under `layouts/shared/` **only after** proving Network/Code Graph does not need them
3. Keep analysis enrichers that Code Graph still needs in **active** core (`architectureLayers`, `entryDetector`, etc.) — do **not** bury live enrichers in preserved.
4. Ensure active runtime **does not import** preserved modules.
5. Update boundary verifier: reject restored active Arch product trees; allow preserved archive + typecheck lane if added (`typecheck:graphs-preserved` optional, not in `assurance:quick` unless later decided).
6. Update unit tests: Arch pick tests move with preserved or become archive-lane only; Network/Code Graph tests stay in active suite.

**Hard gate:** No Architecture source deletion. Preserve-first. If a file is unused, it still goes to preserved (or stays until classified) — it is not `rm`.

### Phase D — selected-node morph (design → implement)

**Goal:** Unselected nodes remain Network dots; **selected** node(s) morph into compact Architecture-style cards.

#### Design placeholder (First Test visual language — not React Flow)

Reference (read-only): First Test `ArchitectureNode.tsx` + related CSS stacking notes.

| Aspect | Intent for MAIN Code Graph |
|---|---|
| Rest state | Existing Network canvas dots (radius/LOD unchanged unless perf requires) |
| Selected state | Compact card near the node: kind icon, truncated label, optional entry affordance |
| Selection chrome | Teal focus ring / glow consistent with PreBase accent (`#2dd4bf` family) — match First Test selection emphasis, not Graphify purple |
| Density | Card sized for graph readability (First Test `FLOW_NODE_WIDTH` / height are **reference metrics**, not hard deps) |
| Dim neighbors | Keep MAIN Network neighbor-dimming when a node is selected |
| Motion | Respect `prebase.graph.reduceMotion`; morph should be a short transform, not a second scene graph |
| Implementation host | Canvas overlay and/or DOM layer inside **existing** `graphEditor.ts` webview — **no** `@xyflow/react` / React Flow |

**Phase D is blocked on Phase B canvas being Code-Graph-only.** Do not morph Architecture SVG nodes as a parallel product path.

### Phase E — optional analysis upgrades (from OGT, cherry-pick only)

Only after B–D are stable and GUI smoke exists:

- Communities / important / bridges / confidence / path-affected queries — **port concepts and tests surgically** from One-Graph-Type if still valuable
- Do not pull OGT dark-UI, cloud, or unrelated host diffs
- Do not claim BETA-003/004 Complete without new Code Graph acceptance evidence

### Phase F — acceptance, perf, beta honesty

- New/updated acceptance matrix for Code Graph + morph
- Perf sample on Network/Code Graph path (extend `GRAPH_PERFORMANCE.md`)
- Reinterpret BETA-003 (Architecture acceptance) as **preserved / out of product** — do **not** fake Complete; document status change with evidence
- BETA-004 becomes Code Graph / Network-path acceptance under the new name

---

## Must-not-do

| Forbidden | Why |
|---|---|
| Modify Dock/app/installer icons or `build/icons/icon-integrity.sha256` | Frozen sheened monogram policy |
| Introduce React Flow / `@xyflow` as active Code Graph renderer | Product direction: Network canvas + morph only |
| Delete Architecture sources (`rm` layouts/pick/tests) | Assets must live under `graphs/src/preserved/architecture/` |
| Wholesale zip/archive overwrite of MAIN from One-Graph-Type or First-Test | Would clobber dark-surface, Runtime Preview, cloud, cleanup, and MAIN host fixes; OGT archive also lacks preserved Arch |
| Merge/cherry-pick entire OGT branch tip blindly | Semantic port only |
| Rewrite main `BETA_*` Complete claims because OGT experiment looked green | Honesty / BETA-006–007 only with evidence |
| Port Graphify branding, purple UI, Python sidecar, vis-network HTML exporter | Explicit non-goals |
| Touch Runtime Preview / Supabase / dark theme JSON “while we are here” | Out of scope unless a graph string/registration conflict requires a minimal fix |
| Claim beta-ready or morph-complete from static gates alone | GUI smoke required |

---

## Preserve MAIN workstreams (unless migration forces a touch)

| Workstream | Policy |
|---|---|
| Dark surface / PreBase Night tokens | Preserve; graph chrome may later consume `var(--vscode-*)` but not as part of Phase B cutover |
| Runtime Preview | Preserve; no graph migration rewrite of runtime services |
| Cloud / Auth / RLS | Preserve |
| Cleanup audits / assurance scripts | Preserve; extend graph boundary verifier only for preserved-path rules |
| Icon integrity | Preserve; verify after any packaging-adjacent change |

---

## Risks

1. **OGT archive is delete-without-preserve** — copying it would permanently drop MAIN Architecture layouts/pick. Mitigation: preserve from **current MAIN** sources first.
2. **Serializer / workspace restore** — saved `architecture` editors must reopen as Code Graph without blank webview.
3. **Settings migration debt** — hidden Arch keys + aliases linger; users with `defaultType: architecture` need a soft migrate to Code Graph.
4. **Shared layout helpers** — moving `layouts/shared/*` too early can break Network/Code Graph; classify per-file.
5. **Morph performance** — card overlay on large graphs may thrash; gate with `maxRenderedNodes` / reduceMotion / single-selection first.
6. **Magnus tools** — selection/overview commands assume dual types; aliases must keep tool contracts stable.
7. **Beta backlog semantics** — BETA-003 Architecture acceptance becomes non-product; update tracker carefully without inventing Complete.
8. **First Test React Flow bleed** — visual reference must not pull Flow handles, Lucide bundling, or React into the webview without an explicit later decision (default: canvas/DOM only).

---

## Recommended Phase B priorities (next implementation checkpoint)

Ordered for smallest safe cutover:

1. **B0 type lock** — choose B0-A (`network` internal + Code Graph brand) or B0-B (`code` type); document in the implementing PR.
2. **Preserve inventory (docs only)** — list every Architecture-active file and classify: move-to-preserved / keep-as-enricher / shared-keep (feeds Phase C; no `git mv` required to start B UI cutover).
3. **`prebase.graph.open` + aliases** — Code Graph open path; hide dual F1 commands.
4. **Editor input / serializer** — title Code Graph; legacy `architecture` → sole live type; unified `matches()` so only one graph editor singleton.
5. **Maps sidebar** — remove Arch/Net toggle; Network layouts as Code Graph layouts.
6. **Home + Onboarding CTAs/copy** — single Code Graph entry.
7. **Settings** — `defaultType` → sole live type; deprecate/hide Arch-only keys (keep readable).
8. **Webview product path** — open/scan always Network canvas; Architecture SVG unreachable from UI (source may remain until Phase C).
9. **Gates** — `verify:graphs-boundary`, `test:graphs`, `typecheck:graphs`, `verify:icons` (expect 101/101), targeted `typecheck-client` if host files change.
10. **Defer morph (Phase D)** and OGT analysis extras (Phase E) until the single-surface cutover has GUI smoke.

---

## Explicit non-goals (Phase A–B)

- Implementing morph, communities, or Magnus query expansions in Checkpoint 1
- Merging One-Graph-Type as a branch
- Declaring beta readiness
- Minimap implementation (BETA-020 remains deferred)
- Hosted Magnus re-enable
- Application icon changes

---

## Rollback (when implementation starts)

Prefer file-level restore from `main` @ `9fde0994` (or the pre-migration commit) for touched graph/host paths. Diff snapshot: `/tmp/prebase-one-graph-migration/snapshot/`. Do **not** hard-reset `main` unless the user explicitly requests a destructive reset.

---

## Checkpoint 1 exit

| Deliverable | Path / status |
|---|---|
| Dual-graph confirmation | Done — Architecture + Network both active on MAIN |
| Plan doc | `docs/ONE_GRAPH_PHASE_A_PLAN.md` (this file) |
| Migration code | **Not started** (correct for Checkpoint 1) |
| Icons | Untouched |
