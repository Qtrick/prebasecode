# Beta Readiness Backlog

Canonical PreBase beta readiness tracker. Do not mark an item **Complete** without evidence.

Statuses: `Not Started` | `In Progress` | `Blocked` | `Needs Verification` | `Complete` | `Deferred After Beta`  
Severities: `Blocker` | `Critical` | `High` | `Medium` | `Low`

Last audit: **2026-07-22** (Checkpoint #12 — final whole-diff honesty pass; beta candidate claim **forbidden**)

## Summary

| Severity | Open count (approx.) |
|---|---|
| Blocker | 2 for local desktop beta (privacy runtime, packaging); hosted Magnus **Disabled** until BETA-035 (not a local-ship gate while picker absent) |
| Critical | 10+ (graphs CI/acceptance, core IDE, Magnus, runtime, security Needs Verification, RLS runtime, …) |
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
| BETA-001 | Graphs | Establish root `graphs/` as sole Architecture/Network graph subsystem | Blocker | Needs Verification | — | GUI Settings smoke; CI green | Boundary script pass; symlink compile; no duplicate core; stable setting/command IDs | Phase A 2026-07-21: Settings UI in `graphSettingsUi.ts`; Phase D flat shims deleted; `verify:graphs-boundary` rejects flat `core/*.ts` + requires Settings UI route | Pre-beta | 2026-07-20 | — |
| BETA-002 | Graphs | Graph boundary verifier in assurance/CI | Critical | Needs Verification | — | CI wiring (BETA-027) | `npm run verify:graphs-boundary` | `assurance:quick` + PR job `prebase-assurance` 2026-07-20 | Pre-beta | 2026-07-20 | — |
| BETA-003 | Graphs | Architecture Graph manual acceptance (layouts, selection, minimap stub, settings) | Critical | Needs Verification | — | GUI smoke | Manual smoke on Architecture Graph | Template: [GRAPH_ACCEPTANCE.md](GRAPH_ACCEPTANCE.md) (all rows Needs Verification) | Pre-beta | 2026-07-20 | — |
| BETA-004 | Graphs | Network Graph manual acceptance (layouts, rotation, drag, idle rotate) | Critical | Needs Verification | — | GUI smoke | Manual smoke on Network Graph | Template: [GRAPH_ACCEPTANCE.md](GRAPH_ACCEPTANCE.md) Network section | Pre-beta | 2026-07-20 | — |
| BETA-005 | Graphs | Graph unit tests (`networkLayout`, communities, graphProduct, ownership boundary; `architecturePick` removed on One-Graph-Type) under `graphs/src/tests/unit` | High | Needs Verification | — | CI gate green on PR | Mocha/node harness green | `npm run test:graphs` includes ownership boundary checks (Phase A 2026-07-21); PR job green not confirmed here | Pre-beta | 2026-07-20 | — |
| BETA-006 | Toolchain | TypeScript 7.0.2 primary compiler lane | Blocker | Complete | — | — | `tsc`/`typecheck` invoke TS7 | `tsc` 7.0.2; `verify:typescript`; `typecheck-client` + `assurance` 2026-07-20 | Pre-beta | 2026-07-20 | 2026-07-20 |
| BETA-007 | Toolchain | TS6 compatibility lane for compiler API consumers | Critical | Complete | — | — | Inventory + compat resolve | `@typescript/typescript6@6.0.2`, import API 6.0.3, `tsc6` 6.0.3; `verify:typescript` | Pre-beta | 2026-07-20 | 2026-07-20 |
| BETA-008 | Toolchain | Replace `@typescript/native-preview`/`tsgo` with stable TS7 entrypoints | High | Needs Verification | — | Extension compile matrix | Scripts use TS7 `tsc` | Phase F/K: `typescriptCompiler.ts`→`npx tsc`; no `build/lib/tsgo` refs; `assurance:quick` pass 2026-07-20; full `compile-extensions` not run | Pre-beta | 2026-07-20 | — |
| BETA-009 | Toolchain | typescript-eslint typed lint on compat API | High | Needs Verification | — | Compat package | `npm run eslint` / `verify:eslint-prebase` | Compat lane OK; full `npm run eslint` still ~80k upstream warnings; `assurance:release` ratchets **PreBase paths only** (baseline debt allowed; not full-eslint clean) | Pre-beta | 2026-07-20 | — |
| BETA-010 | Core | Clean startup / workspace open / crash recovery | Critical | Needs Verification | — | GUI launch | Fresh + existing profile launch | 2026-07-22: `PREBASE_STARTUP_LAUNCH=1` **passed outside sandbox** (extension host + `[PreBase] workbench restored`); **CORE_IDE C1–C5 matrix still Needs Verification — not Complete** | Pre-beta | 2026-07-20 | — |
| BETA-032 | Core | Startup `out/` graphs emit gate (blank-workbench regression) | Critical | Needs Verification | — | CI transpile before assurance | `verify:startup` / `verify:graphs-out` | Checkpoint #4–5: static gates + launch outside sandbox passed (EH + workbench restored); CORE_IDE matrix still open — not Complete | Pre-beta | 2026-07-21 | — |
| BETA-033 | Cloud | Supabase Auth (email/password) + SecretStorage sessions | Blocker | In Progress | — | Hosted sign-in smoke | Sign-up/in/out/restore offline | REST client + `PreBaseAccountService` routing; configure via user settings only — GUI smoke open | Pre-beta | 2026-07-21 | — |
| BETA-034 | Cloud | Database migrations + RLS (profiles, prefs, sessions, usage) | Blocker | In Progress | — | Adversarial two-user runtime | Migrations applied + static RLS verify | Applied on `mvfopbkhftgmcwdpqrww`; `verify:supabase-migrations` + `verify:supabase-rls-static`; runtime adversarial **open** | Pre-beta | 2026-07-21 | — |
| BETA-035 | Cloud | Hosted Magnus agent-gateway (auth, quotas, provider secrets) | Blocker | Deferred After Beta | — | Edge Function deploy + secrets | Authenticated gateway + rate/quota | **Disabled** for public beta — [HOSTED_MAGNUS.md](HOSTED_MAGNUS.md); gateway `501`; no client hosted picker; re-enable checklist incomplete — **not Complete** | After hosted ready | 2026-07-21 | — |
| BETA-036 | Cloud | Opt-in agent history sync + export/delete | High | Deferred After Beta | — | Privacy disclosure | Opt-in default false | Schema `agent_events` ready; client sync UI not built | After local IDE beta OK | 2026-07-21 | — |
| BETA-011 | Core | Native editor reliability (save, undo, search, SCM, terminal, debug) | Critical | Needs Verification | — | GUI smoke | Manual smoke | Checklist: [CORE_IDE_ACCEPTANCE.md](CORE_IDE_ACCEPTANCE.md) E1–E6 | Pre-beta | 2026-07-20 | — |
| BETA-012 | Magnus | Ask/Plan/Edit/Agent + graph tools reliability | Critical | Needs Verification | — | GUI + Magnus ext | Tool smoke | Checklist: [CORE_IDE_ACCEPTANCE.md](CORE_IDE_ACCEPTANCE.md) P5; no agent session evidence yet | Pre-beta | 2026-07-20 | — |
| BETA-013 | Runtime Preview | Web/Electron managed+external lifecycle cleanup | Critical | Needs Verification | — | GUI smoke | Manual + unit | Checklist: [CORE_IDE_ACCEPTANCE.md](CORE_IDE_ACCEPTANCE.md) P4; static CSP via `verify:privacy` only | Pre-beta | 2026-07-20 | — |
| BETA-014 | Privacy | Telemetry/crash/surveys disabled; secrets storage; CSP | Blocker | In Progress | — | Runtime network observation (GUI) | Privacy checklist + `verify:privacy` | **Partial** 2026-07-22: static `verify:privacy` + secrets/CSP docs + `assurance:privacy`; runtime network observation **still Needs Verification** — [ASSURANCE.md](ASSURANCE.md#runtime-network-observation) — **not Complete** | Pre-beta | 2026-07-20 | — |
| BETA-015 | Packaging | macOS/Windows/Linux builds, signing, notarization, updates | Blocker | Needs Verification | — | Platform access + signing credentials | CI/package smoke + signed release | Phase J: [PACKAGING.md](PACKAGING.md), [RELEASE_SIGNING.md](RELEASE_SIGNING.md), `assurance:package` + gulp task smoke on darwin arm64 2026-07-20; **unsigned full package not built**; signing **Blocked** (no `PREBASE_*` creds) | Pre-beta | 2026-07-20 | — |
| BETA-016 | Packaging | Application icon preservation policy + checksum gate | High | Needs Verification | — | CI gate (BETA-027) | Checksums unchanged | `build/icons/icon-integrity.sha256` (101 paths); `npm run verify:icons` 101/101 OK 2026-07-20; Phase J re-verify via `assurance:package` | Pre-beta | 2026-07-20 | — |
| BETA-017 | Quality | Repeatable `assurance` npm script | High | Needs Verification | — | CI wiring (BETA-027) | One command orchestrates checks | Tiers `assurance:quick|static|graphs|privacy|full|package`; `assurance` → quick; local `assurance:quick` + `assurance:package` pass Phase K 2026-07-20 — [ASSURANCE.md](ASSURANCE.md) | Pre-beta | 2026-07-20 | — |
| BETA-018 | Quality | Accessibility (keyboard, HC, reduced motion) for graphs + IDE | High | Not Started | — | Assurance | A11y smoke | Minimap still stub | Pre-beta | 2026-07-20 | — |
| BETA-019 | Release | Privacy policy, terms, support channel, known limitations | High | Not Started | — | Docs | Legal/support review | — | Pre-beta | 2026-07-20 | — |
| BETA-020 | Graphs | Minimap implementation (setting exists, UI stub) | Medium | Deferred After Beta | — | Product decision | Feature or remove setting | **Option 2 locked** in [BETA_SCOPE.md](BETA_SCOPE.md): keep hidden; no fake UI; BETA-020 defer | After beta OK | 2026-07-20 | — |
| BETA-021 | Toolchain | Remove TS6 compat after TS 7.1 API | Medium | Not Started | — | TS 7.1 GA | Re-inventory API consumers | — | Post TS 7.1 | 2026-07-20 | — |
| BETA-022 | Core | Onboarding + account lifecycle | High | Needs Verification | — | Assurance | Sign-in/out smoke | 2026-07-22: versioned `prebase.onboarding.completedVersion`; editor + open/reset commands registered; first-run yield vs Home; **P2/P3 GUI smoke still Needs Verification — not Complete** | Pre-beta | 2026-07-20 | — |
| BETA-023 | Security | Dependency audit + supply-chain review | Critical | Needs Verification | — | Lockfile review after TS7 | `npm audit` + review | 2026-07-22: remediated `shell-quote`/`tar`/transitive advisories via overrides + local `svgo` gulp wrapper; root `npm audit` **0**; `allowScripts` allowlisted; evidence in [SECURITY_AND_SUPPLY_CHAIN.md](SECURITY_AND_SUPPLY_CHAIN.md) — CI/repro confirmation still open before Complete | Pre-beta | 2026-07-20 | — |
| BETA-024 | Graphs | Large-project graph performance/memory | High | In Progress | — | GUI FPS + memory | Perf sample | CPU layout micro-benchmark [GRAPH_PERFORMANCE.md](GRAPH_PERFORMANCE.md) 2026-07-20 (organic ~307 ms @ 500 synthetic nodes); no render/FPS evidence | Pre-beta | 2026-07-20 | — |
| BETA-025 | Release | Third-party notices / license inventory for new packages | Medium | In Progress | — | Legal review | Notices update | `@typescript/typescript6` in lockfile; upstream CI pulls CG NOTICE before package — PreBase release pipeline **not wired**; see [PACKAGING.md](PACKAGING.md) | Pre-beta | 2026-07-20 | — |
| BETA-026 | Documentation | Agent/dev docs (`AGENTS.md`, `graphs/*`, TS migration) kept current with repo | Medium | In Progress | — | — | Review on each checkpoint | Checkpoint 1 + Phase K: `graphs/README.md` bootstrap/status corrected 2026-07-20 | Pre-beta | 2026-07-20 | — |
| BETA-027 | Quality | CI gates: graph boundary verifier + icon checksum diff | Critical | In Progress | — | Merge + green CI | CI fails on boundary/icon/privacy drift | PR workflow job `prebase-assurance` runs `assurance:quick` + `assurance:privacy` on `ubuntu-latest` 2026-07-20 | Pre-beta | 2026-07-20 | — |
| BETA-028 | Localization | PreBase-specific UI strings / NLS for graphs, Magnus, onboarding | Medium | Not Started | — | Product copy | NLS export smoke | — | Pre-beta | 2026-07-20 | — |
| BETA-029 | Extensions | Built-in extensions `typecheck-web` / gulp compile under dual TS lanes | High | Needs Verification | — | Full compile-extensions | `compile-extensions` + spot typecheck | Phase F: gulp `compile-extension:prebase-magnus` + `compile-extension:typescript-language-features` 0 errors; `typecheck-web` on TS ext pass; matrix incomplete | Pre-beta | 2026-07-20 | — |
| BETA-030 | Infrastructure | Remote / web (REH) smoke: extension host, web client | High | Not Started | — | Platform matrix | REH manual or CI smoke | — | Pre-beta | 2026-07-20 | — |
| BETA-031 | Toolchain | npm 12 migration: allowScripts allowlist + lift `preinstall` `<12` guard | High | In Progress | — | Native deps / postinstall | `npm install` on 12.x builds natives; document engines | 2026-07-22: root (+ nested) `allowScripts` committed via `npm install-scripts approve`; preinstall **still** rejects npm ≥12 pending full 12.x native rebuild validation; stay on **11.18.0** | Pre-beta | 2026-07-20 | — |

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
- BETA-014 **partial** (static privacy/secrets/CSP); runtime observation open. BETA-023 **Needs Verification** (remediation applied; root `npm audit` 0 — see [SECURITY_AND_SUPPLY_CHAIN.md](SECURITY_AND_SUPPLY_CHAIN.md)).
- `PREBASE_STARTUP_LAUNCH=1` passed **outside sandbox** (extension host + workbench restored) — still **not** BETA-010 Complete without CORE_IDE matrix.
- Icons untouched.

### Checkpoint #12 / Final whole-diff review (2026-07-22)

- Whole uncommitted worktree reviewed (graphs Settings UI extract, shim deletion, onboarding storage, workbench restored marker, privacy auditor, assurance:release ratchet, hosted disable docs, Copilot root scripts removed).
- Honesty fixes: SECURITY/BETA docs no longer claim “npm audit not recorded” while a findings table exists; Copilot tree documented (tracked files, no `package.json` — do not mass-delete).
- **No** item newly marked Complete. BETA-006/007 remain the only Complete rows with prior evidence.
- Icons: `verify:icons` **101/101 PASS**; `verify:privacy` PASS (runtime warning); `assurance:quick` PASS (test:graphs 17).
- **Beta candidate claim: FORBIDDEN.** Not GO for ship.

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
| BETA-023 (Needs Verification) | 2026-07-22: remediated via overrides + local `svgo` wrapper + nested lockfile bumps; root `npm audit` **0**; `allowScripts` allowlisted ([SECURITY_AND_SUPPLY_CHAIN.md](SECURITY_AND_SUPPLY_CHAIN.md)); CI re-confirm before Complete |
| BETA-035 (disabled) | Checkpoint #5: [HOSTED_MAGNUS.md](HOSTED_MAGNUS.md); gateway `501`; Deferred After Beta — not Complete |
| BETA-009/017 (partial) | Checkpoint #5: `assurance:release` + honest `verify:eslint-prebase` baseline (114 files; debt ratchet) |
| BETA-017 (partial) | Assurance tiers + [ASSURANCE.md](ASSURANCE.md) 2026-07-20 |
| BETA-027 (partial) | `.github/workflows/pr.yml` job `prebase-assurance` 2026-07-20 |
| BETA-026 (partial) | Checkpoint 1: `MIGRATION.md` Phase B/C sequencing + interaction ownership documented |
| BETA-017 (partial) | `assurance` script exists and passed locally 2026-07-20 |
| BETA-003/004/010/011/012/013 (templates) | [GRAPH_ACCEPTANCE.md](GRAPH_ACCEPTANCE.md), [CORE_IDE_ACCEPTANCE.md](CORE_IDE_ACCEPTANCE.md) — all GUI rows Needs Verification |
| BETA-024 (partial) | [GRAPH_PERFORMANCE.md](GRAPH_PERFORMANCE.md) + `graphs/scripts/benchmark-network-layouts.mjs` 2026-07-20 |
| BETA-005 (partial) | `test:graphs` 17 pass (pick + network + ownership); Phase A + Checkpoint #12 `assurance:quick` |
| Phase K (honesty) | Reserved graph setting descriptions + Settings UI hints; `graphs/README.md` status |
| BETA-020 (deferred) | Option 2 locked in BETA_SCOPE — minimap stays hidden |
| Copilot npm scripts | Root `compile-copilot` / `watch-copilot` / `copilot:*` removed; tree still tracked without package.json |
