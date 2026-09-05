# Beta Readiness Backlog

Canonical PreBase beta readiness tracker. Do not mark an item **Complete** without evidence.

Statuses: `Not Started` | `In Progress` | `Blocked` | `Needs Verification` | `Complete` | `Deferred After Beta`
Severities: `Blocker` | `Critical` | `High` | `Medium` | `Low`

Last audit: **2026-09-04** (HEAD `cd7225df` + uncommitted Magnus notch product polish: measured content viewport, shape-aware hit testing, truthful action lifecycle, visual fixtures)

### CURRENT STATUS (authoritative)

- **Magnus notch product polish (in progress, not Complete):** Native AppKit surface now uses a measured content viewport with reserved footer, priority stacking (pending → activity → message → actions), SF Symbol pin/open composer footer, shape-aware `hitTest` (presentation path), and action lifecycle without optimistic question clear (`beginActionInFlight` + 8s timeout recovery). Direct AppKit perf **32/32 PASS**; live AppKit acceptance **PASS** with populated visual fixtures (`working-interactive`, `question`, `approval`, `long-content`, `attention-peek`, `completed`, `failed`, `in-flight`) under `reports/graph-acceptance/phase-3-final/screenshots/`. Remaining polish: wrap/truncate still imperfect on some long titles; attentionPeek density; shoulder continuity further refinement. Full provider-backed Agent GUI matrix still open — **BETA-012 not Complete**.
- **Magnus notch geometry & native AppKit surface:** Organic Hermite cubic S-curve flare with 14-element topology; window frame & shape synchronization; layer-backed controls; bounds clipping.
- **Magnus hover-only haptics & session token:** Generation-scoped `hoverSessionToken`; 0 haptics for actions/content; hover acquisition only.
- **Action follow-through & in-flight state:** In-flight guard; duplicate submission blocked; clears on snapshot acknowledgment or timeout restore (no optimistic clear on answer).
- **Emmet image-size security:** Hardened in `extensions/emmet/src/imageSizeHelper.ts` with strict raster format allowlist (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`), comprehensive SSRF filtering for IPv4/IPv6/mapped/private/loopback/cloud-metadata addresses, 5MB payload limit, 5000ms timeout, and magic byte validation. Verified: 7/7 tests in `extensions/emmet/src/test/imageSizeHelper.test.ts` PASS.
- **Gemini model curation:** Curation in `extensions/prebase-magnus/src/models.ts` maps Auto to `gemini-3.8-flash`, normalizes models to exclude unsupported `minimal` thinking level for Gemini 3.8/3.7/2.5, and updates fallback logic. Verified: `npm run test:prebase-magnus` **272/272 PASS**.
- **Third-Party Notices & Manifest:** Added `@typescript/typescript6` 6.0.2 to `ThirdPartyNotices.txt` and registered component in `cgmanifest.json`.
- **Temporal Graph lifecycle & acceptance:** Fixed unhandled TypeError in `graphs/scripts/acceptance/temporal-live.mjs`. Ran live acceptance harness: **PASS (CURRENT_GREEN)** with valid full map and focus changes evidence. Unit: `test:graphs` **63/63 files PASS**.
- **Icons:** frozen; do not modify without explicit authorization (`npm run verify:icons` 101/101 OK).
- **Hosted Magnus:** remains disabled.
- **Signing/notarization / RLS runtime / OAuth live / hybrid web live:** external where credentials absent.

### HISTORICAL CHECKPOINT (do not treat as current freshness)

Prior campaign notes (live AppKit acceptance, soak on older heads, launch inspector decoupling, graph mode switching) remain useful history but are **not** automatic proof for the current worktree.

## Summary

| Severity | Open count (approx.) |
|---|---|
| Blocker | 2 for local desktop beta (privacy runtime, packaging); hosted Magnus **Disabled** until BETA-035 (not a local-ship gate while picker absent) |
| Critical | 10+ (graphs CI/acceptance, core IDE, Magnus, runtime, security/supply-chain In Progress, RLS runtime, …) |
| High | 10+ (toolchain, quality, a11y, release, perf, cloud sync, …) |

### Categories (coverage)

| Category | Backlog IDs | Notes |
|---|---|---|
| Graphs | BETA-001–005, 020, 024 | Migration + acceptance + perf |
| Toolchain | BETA-006–009, 021, 031 | TS7 dual-lane; npm 12 allowScripts |
| Core IDE | BETA-010–011, 022 | Startup, editor, onboarding |
| Magnus | BETA-012 | Agent + graph tools |
| Runtime Preview | BETA-013 | Web/Electron lifecycle |
| Privacy | BETA-014 | Telemetry, secrets, CSP |
| Packaging | BETA-015–016, 025 | Builds, signing, icons, notices |
| Quality / CI | BETA-017–018, 026–027 | Assurance, a11y, docs, CI gates |
| Release / legal | BETA-019, 025 | Policies, notices |
| Security | BETA-023 | Supply chain |
| Extensions | BETA-029 | Built-in compile + TS lanes |
| Infrastructure | BETA-030 | Remote/web (REH) smoke |

---

## Items

| ID | Category | Description | Severity | Status | Owner | Blocker | Required validation | Evidence | Target | Added | Completed |
|---|---|---|---|---|---|---|---|---|---|---|---|
| BETA-001 | Graphs | Establish root `graphs/` as the sole active Code Graph subsystem; preserve Architecture assets as dormant reference material | Blocker | Needs Verification | — | GUI Settings smoke; CI green | Boundary script pass; symlink compile; no duplicate active core; stable setting/command IDs | Phase A 2026-07-21: Settings UI in `graphSettingsUi.ts`; Phase D flat shims deleted; `verify:graphs-boundary` rejects flat `core/*.ts` + requires Settings UI route. Current product direction: one Code Graph; see `graphs/PRESERVED_ARCHITECTURE.md`. | Pre-beta | 2026-07-20 | — |
| BETA-002 | Graphs | Graph boundary verifier in assurance/CI | Critical | Needs Verification | — | CI wiring (BETA-027) | `npm run verify:graphs-boundary` | `assurance:quick` + PR job `prebase-assurance` 2026-07-20 | Pre-beta | 2026-07-20 | — |
| BETA-003 | Graphs | Historical Architecture Graph acceptance | Critical | Deferred After Beta | — | Product direction | Preserve historical evidence; do not expose or accept dormant Architecture assets as a beta surface | Superseded for the active product by one Code Graph. Architecture sources remain preserved and must not be imported by active graph paths; see `graphs/PRESERVED_ARCHITECTURE.md`. This is not Complete. | After beta / separately approved surface | 2026-07-20 | — |
| BETA-004 | Graphs | Active Code Graph manual acceptance (layouts, interaction, selection, idle rotation) | Critical | Needs Verification | — | GUI smoke | Manual smoke on the active Code Graph | 2026-08-31: 4 active Code Graph layouts (`organic`, `sphere`, `constellation`, `clustered`) with deterministic relayout and persistence; legacy persisted "radial" normalized to `organic`. Live dogfood on real PreBase (~280 files / 420 edges) captured Fit metrics (`reports/graph-acceptance/phase-3-final/visual-recovery/`); screen-aware network radii unified with production webview. **Not Complete** — 5-node acceptance alone is insufficient; full GRAPH_ACCEPTANCE matrix still open | Pre-beta | 2026-07-20 | — |
| BETA-005 | Graphs | Graph unit tests (`architecturePick`, `networkLayout`, ownership boundary) under `graphs/src/tests/unit` | High | Needs Verification | — | CI gate green on PR | Mocha/node harness green | 2026-09-04: **63 test files** pass locally via `npm run test:graphs` (incl. new `graphEditorModeSwitching` unit suite verifying Temporal↔Network dynamic switching cancellation, `graphVisualRecovery`, network acceptance math single-source, temporal fixture contract, layout-version invalidation, 4 active layout modes + normalization, `temporalLabelLod`, `temporalScale97k`). PR job green not confirmed — **not Complete**. | Pre-beta | 2026-07-20 | — |
| BETA-006 | Toolchain | TypeScript 7.0.2 primary compiler lane | Blocker | Complete | — | — | `tsc`/`typecheck` invoke TS7 | `tsc` 7.0.2; `verify:typescript`; `typecheck-client` + `assurance` 2026-07-20 | Pre-beta | 2026-07-20 | 2026-07-20 |
| BETA-007 | Toolchain | TS6 compatibility lane for compiler API consumers | Critical | Complete | — | — | Inventory + compat resolve | `@typescript/typescript6@6.0.2`, import API 6.0.3, `tsc6` 6.0.3; `verify:typescript` | Pre-beta | 2026-07-20 | 2026-07-20 |
| BETA-008 | Toolchain | Replace `@typescript/native-preview`/`tsgo` with stable TS7 entrypoints | High | Needs Verification | — | Extension compile matrix | Scripts use TS7 `tsc` | Phase F/K: `typescriptCompiler.ts`→`npx tsc`; no `build/lib/tsgo` refs; `assurance:quick` pass 2026-07-20; full `compile-extensions` not run | Pre-beta | 2026-07-20 | — |
| BETA-009 | Toolchain | typescript-eslint typed lint on compat API | High | Needs Verification | — | Compat package | `npm run eslint` / `verify:eslint-prebase` | Compat lane OK; full `npm run eslint` still ~80k upstream warnings; `assurance:release` ratchets **PreBase paths only** (baseline debt allowed; not full-eslint clean) | Pre-beta | 2026-07-20 | — |
| BETA-010 | Core | Clean startup / workspace open / crash recovery | Critical | Needs Verification | — | GUI launch | Fresh + existing profile launch | 2026-09-03: Core IDE live **CURRENT_GREEN** on Linux with C3 `workspaceFolders` identity (not title OR). Full CORE_IDE_ACCEPTANCE manual matrix and packaged GUI still open — **not Complete**. | Pre-beta | 2026-07-20 | — |
| BETA-032 | Core | Startup `out/` graphs emit gate (blank-workbench regression) | Critical | Needs Verification | — | CI transpile before assurance | `verify:startup` / `verify:graphs-out` | Checkpoint #4–5: static gates + launch outside sandbox passed (EH + workbench restored); CORE_IDE matrix still open — not Complete | Pre-beta | 2026-07-21 | — |
| BETA-033 | Cloud | Supabase Auth (email/password) + SecretStorage sessions | Blocker | In Progress | — | Hosted sign-in smoke | Sign-up/in/out/restore offline | REST client + `PreBaseAccountService` routing; configure via user settings only — GUI smoke open | Pre-beta | 2026-07-21 | — |
| BETA-034 | Cloud | Database migrations + RLS (profiles, prefs, sessions, usage) | Blocker | In Progress | — | Adversarial two-user runtime | Migrations applied + static RLS verify | Applied on `mvfopbkhftgmcwdpqrww`; `verify:supabase-migrations` + `verify:supabase-rls-static`; runtime adversarial **open** | Pre-beta | 2026-07-21 | — |
| BETA-035 | Cloud | Hosted Magnus agent-gateway (auth, quotas, provider secrets) | Blocker | Deferred After Beta | — | Edge Function deploy + secrets | Authenticated gateway + rate/quota | **Disabled** for public beta — [HOSTED_MAGNUS.md](HOSTED_MAGNUS.md); gateway `501`; no client hosted picker; re-enable checklist incomplete — **not Complete** | After hosted ready | 2026-07-21 | — |
| BETA-036 | Cloud | Opt-in agent history sync + export/delete | High | Deferred After Beta | — | Privacy disclosure | Opt-in default false | Schema `agent_events` ready; client sync UI not built | After local IDE beta OK | 2026-07-21 | — |
| BETA-011 | Core | Native editor reliability (save, undo, search, SCM, terminal, debug) | Critical | Needs Verification | — | GUI smoke | Manual smoke | 2026-09-03: E6 false-green closed; P1 persists `projectGuidance.enabled` (not macOS-only liveActivity.mode); P5 Magnus schema proof; Settings web-search `[role=status]` proven. Core IDE live **CURRENT_GREEN**. Full manual CORE_IDE_ACCEPTANCE still open — **not Complete**. | Pre-beta | 2026-07-20 | — |
| BETA-012 | Magnus | Ask/Plan/Edit/Agent + graph tools reliability | Critical | Needs Verification | — | GUI + Magnus ext | Tool smoke | 2026-09-04: **Notch product polish landed (measured viewport, shape-aware hit testing, truthful action lifecycle, populated visual fixtures)** — AppKit perf **32/32**; live acceptance **PASS** with realistic screenshots under `reports/graph-acceptance/phase-3-final/screenshots/magnus-live-activity-*.png`. Remaining notch polish (long-title wrap density, further shoulder continuity) and full provider-backed Agent/chat GUI matrix still open — **not Complete**. | Pre-beta | 2026-07-20 | — |
| BETA-013 | Runtime Preview | Web/Electron/Tauri desktop test-lab lifecycle cleanup | Critical | Needs Verification | — | GUI smoke | Manual + unit | Checklist: [CORE_IDE_ACCEPTANCE.md](CORE_IDE_ACCEPTANCE.md) P4; Phase 3.19: WebDriver `ready` truth, Tauri setup completeness, Electron `supportsMainProcessAccess=false`, native CDP/WebDriver input (unit), Runtime Preview `navigationId`. 2026-09-03: idle `onDidChangeSession`↔`_loadUrl` recursion closed; Phase 3 runtime-preview live **CURRENT_GREEN** on Linux (detect/start/connect/inspect/restart/stop). Direct fixture smokes are **backend-only**. Packaged Electron/Tauri load-quit matrix and soak **still open** — not Complete | Pre-beta | 2026-07-20 | — |
| BETA-014 | Privacy | Telemetry/crash/surveys disabled; secrets storage; CSP | Blocker | In Progress | — | Runtime network observation (GUI) | Privacy checklist + `verify:privacy` | 2026-09-03: Live privacy runtime observation PASS; Google `*.1e100.net` PTR hostnames classified as expected infrastructure (not unexpected). Verified process-tree `lsof -a` attribution + CDP hostname identity; 0 forbidden telemetry hosts; clean quit. | Pre-beta | 2026-07-20 | — |
| BETA-015 | Packaging | macOS/Windows/Linux builds, signing, notarization, updates | Blocker | Needs Verification | — | Platform access + signing credentials | CI/package smoke + signed release | 2026-08-14 darwin arm64: Copilot-free policy tests 11/11; production desktop bundle; `vscode-darwin-arm64-ci` PASS (18 s) produced unsigned `/Users/qunyingfan/VSCode-darwin-arm64/PreBase.app`; package verifier confirmed PreBase + Magnus and no active Copilot manifest. 2026-09-03: Darwin package gulp fails closed if Live Activity `.node` missing; `preLaunch` compiles it on darwin when absent; `verifyPreBaseDesktopPackage` already rejected missing darwin / present non-darwin addon. Signing remains **Blocked** (no `PREBASE_*` creds); Windows/Linux and broad packaged smoke remain open. | Pre-beta | 2026-07-20 | — |
| BETA-016 | Packaging | Application icon preservation policy + checksum gate | High | Needs Verification | — | CI gate (BETA-027) | Checksums unchanged | `build/icons/icon-integrity.sha256` (101 paths); `npm run verify:icons` 101/101 OK 2026-07-20; Phase J re-verify via `assurance:package` | Pre-beta | 2026-07-20 | — |
| BETA-017 | Quality | Repeatable `assurance` npm script | High | Needs Verification | — | CI wiring (BETA-027) | One command orchestrates checks | Tiers `assurance:quick|static|graphs|privacy|full|package`; `assurance` → quick; local `assurance:quick` + `assurance:package` pass Phase K 2026-07-20 — [ASSURANCE.md](ASSURANCE.md) | Pre-beta | 2026-07-20 | — |
| BETA-018 | Quality | Accessibility (keyboard, HC, reduced motion) for graphs + IDE | High | In Progress | — | Assurance | A11y smoke | 2026-08-30 reconcile: graph canvas remains `role=region` + `aria-roledescription="interactive graph"`; **Alt/Option+F1 restored to Code OSS Accessibility Help** (must not be preventDefaulted / must not toggle PreBase help — covered by `graphAccessibility` / viewport interaction unit tests). `?` toggles graph help; plain F1 Command Palette preserved. IDE-wide screen-reader GUI evidence remains open — **not Complete**. | Pre-beta | 2026-07-20 | — |
| BETA-019 | Release | Privacy policy, terms, support channel, known limitations | High | Not Started | — | Docs | Legal/support review | — | Pre-beta | 2026-07-20 | — |
| BETA-020 | Graphs | Minimap implementation (setting exists, UI stub) | Medium | Deferred After Beta | — | Product decision | Feature or remove setting | **Option 2 locked** in [BETA_SCOPE.md](BETA_SCOPE.md): keep hidden; no fake UI; BETA-020 defer | After beta OK | 2026-07-20 | — |
| BETA-021 | Toolchain | Remove TS6 compat after TS 7.1 API | Medium | Not Started | — | TS 7.1 GA | Re-inventory API consumers | — | Post TS 7.1 | 2026-07-20 | — |
| BETA-022 | Core | Onboarding + account lifecycle | High | Needs Verification | — | Assurance | Sign-in/out smoke | 2026-07-22: versioned `prebase.onboarding.completedVersion`; editor + open/reset commands registered; first-run yield vs Home; **P2/P3 GUI smoke still Needs Verification — not Complete** | Pre-beta | 2026-07-20 | — |
| BETA-023 | Security | Dependency audit + supply-chain review | Critical | In Progress | — | Electron/native packaged smoke | `npm audit` + review | 2026-09-04: Emmet `image-size` security hardened (safe rasters whitelist, comprehensive SSRF IPv4/IPv6/mapped/private/loopback filtering, magic bytes validation, 5MB limit, 5000ms timeout); root audits clean; Electron **42.8.0**; packaged/native smoke still open — [SECURITY_AND_SUPPLY_CHAIN.md](SECURITY_AND_SUPPLY_CHAIN.md) | Pre-beta | 2026-07-20 | — |
| BETA-024 | Graphs | Large-project graph performance/memory **and** visual readability at Fit View | High | In Progress | — | GUI FPS + memory + screen-space readability | Perf sample + visual metrics | Perf (2026-08-25 Phase 3.12): 280-node GUI FPS/memory evidence in `docs/GRAPH_PERFORMANCE.md`. Visual: screen-aware node/label policy + 4 active layout modes; live Fit metrics in `visual-recovery/`; **distinguish** from perf — readability still Needs Verification for large Temporal Full Map (k≈0.21 on ~9.7k nodes). | Pre-beta | 2026-07-20 | — |
| BETA-025 | Release | Third-party notices / license inventory for new packages | Medium | In Progress | — | Legal review | Notices update | `@typescript/typescript6` in lockfile and added to `cglicenses.json`, `cgmanifest.json`, and `ThirdPartyNotices.txt` (`6.0.2 - Apache-2.0`); notice generator audited; PreBase release pipeline wiring tracked in [PACKAGING.md](PACKAGING.md) | Pre-beta | 2026-07-20 | — |
| BETA-026 | Documentation | Agent/dev docs (`AGENTS.md`, `graphs/*`, TS migration) kept current with repo | Medium | In Progress | — | — | Review on each checkpoint | Checkpoint 1 + Phase K: `graphs/README.md` bootstrap/status corrected 2026-07-20 | Pre-beta | 2026-07-20 | — |
| BETA-027 | Quality | CI gates: graph boundary verifier + icon checksum diff | Critical | In Progress | — | Merge + green CI | CI fails on boundary/icon/privacy drift | 2026-09-03: `prebase-assurance` on ubuntu; `assurance:quick` includes `test:live-activity-contracts`; `magnus-live-activity-macos` compiles AppKit addon + contracts/perf (`workflow_dispatch` enabled). Green CI run on this branch not yet confirmed (private Actions may be idle); full AppKit live producer still open. | Pre-beta | 2026-07-20 | — |
| BETA-028 | Localization | PreBase-specific UI strings / NLS for graphs, Magnus, onboarding | Medium | Not Started | — | Product copy | NLS export smoke | — | Pre-beta | 2026-07-20 | — |
| BETA-029 | Extensions | Built-in extensions `typecheck-web` / gulp compile under dual TS lanes | High | Needs Verification | — | Full compile-extensions | `compile-extensions` + spot typecheck | Phase F: gulp `compile-extension:prebase-magnus` + `compile-extension:typescript-language-features` 0 errors; `typecheck-web` on TS ext pass; matrix incomplete | Pre-beta | 2026-07-20 | — |
| BETA-030 | Infrastructure | Remote / web (REH) smoke: extension host, web client | High | Not Started | — | Platform matrix | REH manual or CI smoke | — | Pre-beta | 2026-07-20 | — |
| BETA-038 | Packaging | macOS adaptive application icon packaging (Assets.car + CFBundleIconName + legacy icns; fail-closed) | Critical | Needs Verification | — | Packaged + Dock evidence | Dev+package `.app` verifier; Dock/Finder; signing order | 2026-08-14 unsigned darwin arm64 package: `verify:macos-adaptive-icon -- --app /Users/qunyingfan/VSCode-darwin-arm64/PreBase.app` PASS (Assets.car, PreBase.icns, expected plist fields); Dock/Finder and signing-order evidence still open. | Pre-beta | 2026-08-09 | — |
| BETA-039 | Quality | VS Code stock color/file theme parity + PreBase Settings dynamic theme UI | Critical | Needs Verification | — | GUI theme smoke | `verify:theme-parity`; Settings selector; light/HC custom UI | 2026-08-09: 19/19 stock color IDs; Modern Icons ported; Settings dynamic discovery; light/HC GUI matrix still open | Pre-beta | 2026-08-09 | — |
| BETA-040 | Magnus | Agent hybrid web context (LinkUp discovery + Firecrawl enrichment) through authenticated gateway | Critical | Needs Verification | — | Edge deploy + signed-in GUI tool loop | JWT/RLS/quota/security gates; hybrid citations; fetch tool; cancellation/failure smoke | Dedicated gateway + metadata-only quota + native search/fetch loop; live deploy and GUI evidence not yet recorded | Pre-beta | 2026-08-28 | — |
| BETA-041 | Auth | Desktop Google OAuth Sign-In & PKCE Deep Linking Protocol Conformance | Critical | In Progress | — | Desktop OAuth Flow | PKCE verification, implicit token rejection, refresh mutex, Google metadata | Supabase-owned provider state; `sb_flow_id` app correlation; `s256`; no undocumented `flow_type`; implicit-token rejection; browser-safe secret-key validator; refresh mutex; Google metadata mapping. Live warm/cold/provider acceptance remains open. | Pre-beta | 2026-08-20 | — |

## Newly discovered during 2026-07-20 audit

- Phase B settings extraction complete: `registerPreBaseGraphConfiguration()` in `graphs/src/host/workbench/graphConfigurationContribution.ts`; graph interaction keys register under `prebaseGraph` (terminal visibility stays sole `prebaseInteraction` in allowlisted `prebaseConfiguration.ts`).
- Graph minimap (`prebase.graph.showMinimap`, `prebase.graph.toggleMinimap`): hidden from VS Code Settings TOC; command not in palette (`f1: false`); BETA-020 tracks implementation.
- `prebaseConfiguration.ts` remains allowlisted mixed bootstrap (terminal visibility + runtime/home keys).
- `graphs/package.json` `typecheck` is **core-only**; host adapters typecheck via `npm run typecheck-client` through symlink.
- TS7 dual-lane install **complete** (BETA-006/007); `npm run verify:typescript` enforces primary `tsc` 7.x + compat packages.
- Phase F toolchain verification (2026-07-20): spot extension compiles + `docs/TYPESCRIPT_EDITOR_VERIFICATION.md`; editor UI checklist still manual.
- Phase J packaging prep (2026-07-20): [PACKAGING.md](PACKAGING.md), [RELEASE_SIGNING.md](RELEASE_SIGNING.md); Microsoft ESRP upstream-only; `assurance:package` gulp task smoke on darwin arm64; full unsigned package not built; signing blocked without `PREBASE_*` credentials.
- Manual graph acceptance (BETA-003/004), core IDE smoke (BETA-010/011), and Magnus (BETA-012) remain unverified; templates: [GRAPH_ACCEPTANCE.md](GRAPH_ACCEPTANCE.md), [CORE_IDE_ACCEPTANCE.md](CORE_IDE_ACCEPTANCE.md).
- BETA-024: layout CPU benchmarks only — see [GRAPH_PERFORMANCE.md](GRAPH_PERFORMANCE.md).

### Checkpoint 9 / Phase K (final migration review, 2026-07-20)

- Mandatory scans: no `prebase.graph.*` Action2 definitions outside `graphs/` (except allowlist); no graph property keys in `prebaseConfiguration.ts` body; no `build/lib/tsgo` refs; icon diff is checksum manifest + verifier only (no protected icon bytes).
- Reserved / unwired graph settings labeled honestly in schema + PreBase Settings UI (`panSensitivity`, `zoomSensitivity`, `nodeDragDelayMs`, `renderThrottleMs`, `networkLodNodeThreshold`, `networkSimulationTicks`, `networkPhysicsStrength`, `networkEdgeOpacity`; minimap BETA-020).
- Local verification (this pass): `verify:icons`, `verify:privacy` (static PASS + runtime warning), `verify:graphs-boundary`, `verify:typescript`, `test:graphs` (13), `typecheck-client`, `assurance:quick`, `assurance:package` — all exit 0.
- **Not beta-ready:** manual graph/core/Magnus acceptance, privacy runtime observation, unsigned full desktop package, signing creds, supply-chain audit, a11y, legal docs.

### Checkpoint 1 (pre-extraction, 2026-07-20)

- Phase B must **move** (not copy) `registerConfiguration` for `prebase.graph.*` to avoid duplicate registry keys.
- Split `prebaseInteraction` registration: graph canvas keys → `graphs/src/settings/`; `terminalVisibility.*` stays in allowlisted `prebaseConfiguration.ts` (see `graphs/docs/MIGRATION.md#checkpoint-1--pre-extraction-plan-2026-07-20`).
- `GraphReduceMotion` is registered under Appearance but is a graph key — decide move-with-graph vs documented exception during Phase B.
- Magnus / onboarding depend on stable `prebase.graph.*` command IDs; no renames during command extraction.

### Checkpoint #1 revalidation (pre-Phase A, 2026-07-21)

- Settings UI still in allowlisted `prebaseSettingsEditor.ts` (`_renderGraph` / Interaction / Performance / Advanced) — Phase A target.
- ~27 Phase D `graphs/src/core/*.ts` shims remain — Phase A removal after caller sweep.
- `isOnboardingComplete()` hardcoded `true` (BETA-022); onboarding editor registration deferred.
- Privacy auditor retargeted to `secretStorageSessionAdapter` + `prebaseCloudService`; `verify:privacy` PASS (runtime warning only).
- Hosted `agent-gateway` still `501` (BETA-035 Disabled); `assurance:full` still skips full-repo eslint — use `assurance:release` (PreBase-path ratchet) for release gates.
- Icons frozen. Root Copilot npm scripts removed; `extensions/copilot` still has thousands of tracked files without `package.json` (document-only; do not mass-delete yet). See [BETA_EXECUTION_CHECKPOINT.md](BETA_EXECUTION_CHECKPOINT.md).

### Checkpoint #2–#3 / Phase A (Settings UI + shim removal, 2026-07-21)

- Graph Settings panels owned by `graphs/src/host/workbench/settings/graphSettingsUi.ts`; shell routes only; terminal visibility stays in shell.
- Phase D flat `graphs/src/core/*.ts` compatibility shims **deleted**; boundary verifier rejects any flat file under `core/`.
- `graphs/src/settings/index.ts` re-exports Settings UI helpers; `graphOwnershipBoundary` unit test added.
- Docs updated: OWNERSHIP, MIGRATION, GRAPH_SETTINGS_MAP, BETA_EXECUTION_CHECKPOINT, BETA_SCOPE.
- Remaining Phase A honesty gaps: local verification commands must pass this pass; GUI Settings smoke still open (BETA-003); allowlisted shell/bootstrap intentional.

### Checkpoint #4 / Phase B partial (startup + onboarding, 2026-07-22)

- `isOnboardingComplete()` uses versioned APPLICATION storage `prebase.onboarding.completedVersion` (mark/reset/open loop-safe; contribution does not re-open on storage events).
- Onboarding editor pane + serializer `TypeID` registered; commands `prebase.onboarding.open` / `.reset`.
- `PreBaseOnboardingContribution` auto-opens once per session; Home empty-editors yields while first-run onboarding owns the center.
- `PreBaseWorkbenchReadyContribution` emits `[PreBase] workbench restored`; `verify:startup` launch requires extension host + that marker; preserves profile on fail.
- **Honesty:** BETA-010 / 022 / 032 remain **Needs Verification** — CORE_IDE_ACCEPTANCE rows still unverified; do not claim Phase B Complete or beta-ready.

### Checkpoint #5 / Phase D/F partial (privacy, hosted disable, assurance:release, 2026-07-22)

- Docs: [HOSTED_MAGNUS.md](HOSTED_MAGNUS.md), [SECURITY_AND_SUPPLY_CHAIN.md](SECURITY_AND_SUPPLY_CHAIN.md), [SUPABASE_RLS_RUNTIME.md](SUPABASE_RLS_RUNTIME.md), [ASSURANCE.md](ASSURANCE.md) — honesty pass (no Complete without evidence).
- Hosted Magnus **Disabled**; gateway still `501`; no lying client hosted picker (BETA-035 → Deferred After Beta).
- `assurance:release` + `verify:eslint-prebase` = PreBase-path eslint **ratchet** (fixed no-op that called full-repo `npm run eslint`); baseline debt recorded — **not** full-eslint clean.
- BETA-014 **partial** (static privacy/secrets/CSP); runtime observation open. BETA-023 **In Progress** (docs + ratchet; `npm audit` open).
- `PREBASE_STARTUP_LAUNCH=1` passed **outside sandbox** (extension host + workbench restored) — still **not** BETA-010 Complete without CORE_IDE matrix.
- Icons untouched.

### Checkpoint #12 / Final whole-diff review (2026-07-22)

- Whole uncommitted worktree reviewed (graphs Settings UI extract, shim deletion, onboarding storage, workbench restored marker, privacy auditor, assurance:release ratchet, hosted disable docs, Copilot root scripts removed).
- Honesty fixes: SECURITY/BETA docs no longer claim “npm audit not recorded” while a findings table exists; Copilot tree documented (tracked files, no `package.json` — do not mass-delete).
- **No** item newly marked Complete. BETA-006/007 remain the only Complete rows with prior evidence.
- Icons: `verify:icons` **101/101 PASS**; `verify:privacy` PASS (runtime warning); `assurance:quick` PASS (test:graphs 17).
- **Beta candidate claim: FORBIDDEN.** Not GO for ship.

### Dark UI / cleansing pass (2026-08-01, main)

- PreBase Night semantic surface ladder applied (`#1B1C1E` / `#1F1F1F` / `#2B2B2B` / `#303030`) via `prebase_dark.json` + `COLOR_THEME_DARK_INITIAL_COLORS`; custom Home/Settings/Onboarding/graph chrome migrated toward `--vscode-*` vars.
- Network graph idle `requestAnimationFrame` gated (CLN-005).
- Docs: `DARK_UI_RESEARCH.md`, `DARK_SURFACE_AUDIT.md`, `DARK_SURFACE_TOKENS.md`, `DARK_UI_COMPARISON.md`, `CLEANUP_AUDIT.md`, `DARK_UI_PHASE_A_PLAN.md`.
- **Honesty:** interactive screenshot matrix + CORE_IDE/GRAPH acceptance still open; BETA-018 a11y not Complete; **beta candidate claim still forbidden**. Icons 101/101 unchanged.

## Completed this task

| ID | Evidence |
|---|---|
| BETA-006 | `tsc` 7.0.2; `npm run verify:typescript`; `typecheck-client`; `npm run assurance` 2026-07-20 |
| BETA-007 | `@typescript/typescript6@6.0.2`, API 6.0.3, `tsc6`; `verify:typescript` |
| BETA-026 (partial) | Phase F: `TYPESCRIPT_EDITOR_VERIFICATION.md`, fixture `test/fixtures/typescript-lanes/`, Phase F section in `TYPESCRIPT_7_MIGRATION.md` |
| BETA-001 (partial) | Phase B settings + Phase C commands + Phase A Settings UI (`graphSettingsUi.ts`) + Phase D shim deletion; boundary verifier rejects flat `core/*.ts` |
| BETA-002 (partial) | `graphs/scripts/verify-boundary/verify.mjs`; `npm run verify:graphs-boundary` OK locally |
| BETA-016 (partial) | `build/icons/icon-integrity.sha256` + `verify:icons` 101/101 OK 2026-07-20; Phase J `assurance:package` |
| BETA-015 (partial) | Phase J docs + `scripts/release/signing-preflight.mjs` + `package-smoke.mjs`; gulp tasks verified; signing blocked without creds |
| BETA-025 (partial) | Packaging doc references upstream NOTICE flow; legal inventory still open |
| BETA-014 (partial) | `scripts/privacy/audit.mjs` static PASS 2026-07-21 (adapter + cloud SecretStorage; Checkpoint #1 retarget); Checkpoint #5: privacy/CSP/secrets docs + `assurance:privacy`; runtime network observation still Needs Verification |
| BETA-023 (partial) | Checkpoint #5–#12: [SECURITY_AND_SUPPLY_CHAIN.md](SECURITY_AND_SUPPLY_CHAIN.md) + `assurance:release` / PreBase eslint ratchet; `npm audit --omit=dev` findings recorded (`shell-quote` high, `tar` critical); reachability/remediation still open — **not Complete** |
| BETA-035 (disabled) | Checkpoint #5: [HOSTED_MAGNUS.md](HOSTED_MAGNUS.md); gateway `501`; Deferred After Beta — not Complete |
| BETA-009/017 (partial) | Checkpoint #5: `assurance:release` + honest `verify:eslint-prebase` baseline (114 files; debt ratchet) |
| BETA-017 (partial) | Assurance tiers + [ASSURANCE.md](ASSURANCE.md) 2026-07-20 |
| BETA-027 (partial) | `.github/workflows/pr.yml` job `prebase-assurance` 2026-07-20 |
| BETA-026 (partial) | Checkpoint 1: `MIGRATION.md` Phase B/C sequencing + interaction ownership documented |
| BETA-017 (partial) | `assurance` script exists and passed locally 2026-07-20 |
| BETA-003/004/010/011/012/013 (templates) | [GRAPH_ACCEPTANCE.md](GRAPH_ACCEPTANCE.md), [CORE_IDE_ACCEPTANCE.md](CORE_IDE_ACCEPTANCE.md) — all GUI rows Needs Verification |
| BETA-024 (partial) | [GRAPH_PERFORMANCE.md](GRAPH_PERFORMANCE.md) + `graphs/scripts/benchmark-network-layouts.mjs`; 2026-08-13 CPU benchmark updated, GUI FPS/memory still open |
| BETA-005 (partial) | `test:graphs` 17 pass (pick + network + ownership); Phase A + Checkpoint #12 `assurance:quick` |
| Phase K (honesty) | Reserved graph setting descriptions + Settings UI hints; `graphs/README.md` status |
| BETA-020 (deferred) | Option 2 locked in BETA_SCOPE — minimap stays hidden |
| Copilot npm scripts | Root `compile-copilot` / `watch-copilot` / `copilot:*` removed; tree still tracked without package.json |
