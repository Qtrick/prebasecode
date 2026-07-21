# Beta Readiness Backlog

Canonical PreBase beta readiness tracker. Do not mark an item **Complete** without evidence.

Statuses: `Not Started` | `In Progress` | `Blocked` | `Needs Verification` | `Complete` | `Deferred After Beta`  
Severities: `Blocker` | `Critical` | `High` | `Medium` | `Low`

Last audit: **2026-07-20**

## Summary

| Severity | Open count (approx.) |
|---|---|
| Blocker | 3 (graphs root extraction, privacy, packaging) |
| Critical | 10+ (graphs CI/acceptance, core IDE, Magnus, runtime, security, …) |
| High | 10+ (toolchain, quality, a11y, release, perf, …) |

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
| BETA-001 | Graphs | Establish root `graphs/` as sole Architecture/Network graph subsystem | Blocker | In Progress | — | Settings **UI shell** extraction from `prebaseSettingsEditor.ts` | Boundary script pass; symlink compile; no duplicate core; stable setting/command IDs | Phase B/C settings+commands in `graphs/`; bootstrap imports only; `verify:graphs-boundary` + `assurance:quick` pass Phase K 2026-07-20 | Pre-beta | 2026-07-20 | — |
| BETA-002 | Graphs | Graph boundary verifier in assurance/CI | Critical | Needs Verification | — | CI wiring (BETA-027) | `npm run verify:graphs-boundary` | `assurance:quick` + PR job `prebase-assurance` 2026-07-20 | Pre-beta | 2026-07-20 | — |
| BETA-003 | Graphs | Architecture Graph manual acceptance (layouts, selection, minimap stub, settings) | Critical | Needs Verification | — | GUI smoke | Manual smoke on Architecture Graph | Template: [GRAPH_ACCEPTANCE.md](GRAPH_ACCEPTANCE.md) (all rows Needs Verification) | Pre-beta | 2026-07-20 | — |
| BETA-004 | Graphs | Network Graph manual acceptance (layouts, rotation, drag, idle rotate) | Critical | Needs Verification | — | GUI smoke | Manual smoke on Network Graph | Template: [GRAPH_ACCEPTANCE.md](GRAPH_ACCEPTANCE.md) Network section | Pre-beta | 2026-07-20 | — |
| BETA-005 | Graphs | Graph unit tests (`architecturePick`, `networkLayout`) under `graphs/src/tests/unit` | High | Needs Verification | — | CI gate green on PR | Mocha/node harness green | `npm run test:graphs` 13 tests pass; included in `assurance:quick` + Phase K re-run 2026-07-20 — PR job green not confirmed here | Pre-beta | 2026-07-20 | — |
| BETA-006 | Toolchain | TypeScript 7.0.2 primary compiler lane | Blocker | Complete | — | — | `tsc`/`typecheck` invoke TS7 | `tsc` 7.0.2; `verify:typescript`; `typecheck-client` + `assurance` 2026-07-20 | Pre-beta | 2026-07-20 | 2026-07-20 |
| BETA-007 | Toolchain | TS6 compatibility lane for compiler API consumers | Critical | Complete | — | — | Inventory + compat resolve | `@typescript/typescript6@6.0.2`, import API 6.0.3, `tsc6` 6.0.3; `verify:typescript` | Pre-beta | 2026-07-20 | 2026-07-20 |
| BETA-008 | Toolchain | Replace `@typescript/native-preview`/`tsgo` with stable TS7 entrypoints | High | Needs Verification | — | Extension compile matrix | Scripts use TS7 `tsc` | Phase F/K: `typescriptCompiler.ts`→`npx tsc`; no `build/lib/tsgo` refs; `assurance:quick` pass 2026-07-20; full `compile-extensions` not run | Pre-beta | 2026-07-20 | — |
| BETA-009 | Toolchain | typescript-eslint typed lint on compat API | High | Needs Verification | — | Compat package | `npm run eslint` | Compat lane OK; full `npm run eslint` fails ~80k pre-existing warnings; scoped `graphs/**` **0 errors** (Phase F header policy); `.tmp/**` excluded | Pre-beta | 2026-07-20 | — |
| BETA-010 | Core | Clean startup / workspace open / crash recovery | Critical | Needs Verification | — | GUI launch | Fresh + existing profile launch | Checklist: [CORE_IDE_ACCEPTANCE.md](CORE_IDE_ACCEPTANCE.md) C1–C5 | Pre-beta | 2026-07-20 | — |
| BETA-011 | Core | Native editor reliability (save, undo, search, SCM, terminal, debug) | Critical | Needs Verification | — | GUI smoke | Manual smoke | Checklist: [CORE_IDE_ACCEPTANCE.md](CORE_IDE_ACCEPTANCE.md) E1–E6 | Pre-beta | 2026-07-20 | — |
| BETA-012 | Magnus | Ask/Plan/Edit/Agent + graph tools reliability | Critical | Needs Verification | — | GUI + Magnus ext | Tool smoke | Checklist: [CORE_IDE_ACCEPTANCE.md](CORE_IDE_ACCEPTANCE.md) P5; no agent session evidence yet | Pre-beta | 2026-07-20 | — |
| BETA-013 | Runtime Preview | Web/Electron managed+external lifecycle cleanup | Critical | Needs Verification | — | GUI smoke | Manual + unit | Checklist: [CORE_IDE_ACCEPTANCE.md](CORE_IDE_ACCEPTANCE.md) P4; static CSP via `verify:privacy` only | Pre-beta | 2026-07-20 | — |
| BETA-014 | Privacy | Telemetry/crash/surveys disabled; secrets storage; CSP | Blocker | In Progress | — | Runtime network observation (GUI) | Privacy checklist + `verify:privacy` | Static PASS 2026-07-20 (`enableTelemetry: false`, secret storage APIs, graph/runtime CSP); runtime observation **Needs Verification** — [ASSURANCE.md](ASSURANCE.md#runtime-network-observation) | Pre-beta | 2026-07-20 | — |
| BETA-015 | Packaging | macOS/Windows/Linux builds, signing, notarization, updates | Blocker | Needs Verification | — | Platform access + signing credentials | CI/package smoke + signed release | Phase J: [PACKAGING.md](PACKAGING.md), [RELEASE_SIGNING.md](RELEASE_SIGNING.md), `assurance:package` + gulp task smoke on darwin arm64 2026-07-20; **unsigned full package not built**; signing **Blocked** (no `PREBASE_*` creds) | Pre-beta | 2026-07-20 | — |
| BETA-016 | Packaging | Application icon preservation policy + checksum gate | High | Needs Verification | — | CI gate (BETA-027) | Checksums unchanged | `build/icons/icon-integrity.sha256` (101 paths); `npm run verify:icons` 101/101 OK 2026-07-20; Phase J re-verify via `assurance:package` | Pre-beta | 2026-07-20 | — |
| BETA-017 | Quality | Repeatable `assurance` npm script | High | Needs Verification | — | CI wiring (BETA-027) | One command orchestrates checks | Tiers `assurance:quick|static|graphs|privacy|full|package`; `assurance` → quick; local `assurance:quick` + `assurance:package` pass Phase K 2026-07-20 — [ASSURANCE.md](ASSURANCE.md) | Pre-beta | 2026-07-20 | — |
| BETA-018 | Quality | Accessibility (keyboard, HC, reduced motion) for graphs + IDE | High | Not Started | — | Assurance | A11y smoke | Minimap still stub | Pre-beta | 2026-07-20 | — |
| BETA-019 | Release | Privacy policy, terms, support channel, known limitations | High | Not Started | — | Docs | Legal/support review | — | Pre-beta | 2026-07-20 | — |
| BETA-020 | Graphs | Minimap implementation (setting exists, UI stub) | Medium | Not Started | — | Product decision | Feature or remove setting | Key deprecated in schema; hidden from Settings TOC; toggle command `f1: false` (2026-07-20 review) | After beta OK if deferred | 2026-07-20 | — |
| BETA-021 | Toolchain | Remove TS6 compat after TS 7.1 API | Medium | Not Started | — | TS 7.1 GA | Re-inventory API consumers | — | Post TS 7.1 | 2026-07-20 | — |
| BETA-022 | Core | Onboarding + account lifecycle | High | Needs Verification | — | Assurance | Sign-in/out smoke | — | Pre-beta | 2026-07-20 | — |
| BETA-023 | Security | Dependency audit + supply-chain review | Critical | Not Started | — | Lockfile review after TS7 | `npm audit` + review | — | Pre-beta | 2026-07-20 | — |
| BETA-024 | Graphs | Large-project graph performance/memory | High | In Progress | — | GUI FPS + memory | Perf sample | CPU layout micro-benchmark [GRAPH_PERFORMANCE.md](GRAPH_PERFORMANCE.md) 2026-07-20 (organic ~307 ms @ 500 synthetic nodes); no render/FPS evidence | Pre-beta | 2026-07-20 | — |
| BETA-025 | Release | Third-party notices / license inventory for new packages | Medium | In Progress | — | Legal review | Notices update | `@typescript/typescript6` in lockfile; upstream CI pulls CG NOTICE before package — PreBase release pipeline **not wired**; see [PACKAGING.md](PACKAGING.md) | Pre-beta | 2026-07-20 | — |
| BETA-026 | Documentation | Agent/dev docs (`AGENTS.md`, `graphs/*`, TS migration) kept current with repo | Medium | In Progress | — | — | Review on each checkpoint | Checkpoint 1 + Phase K: `graphs/README.md` bootstrap/status corrected 2026-07-20 | Pre-beta | 2026-07-20 | — |
| BETA-027 | Quality | CI gates: graph boundary verifier + icon checksum diff | Critical | In Progress | — | Merge + green CI | CI fails on boundary/icon/privacy drift | PR workflow job `prebase-assurance` runs `assurance:quick` + `assurance:privacy` on `ubuntu-latest` 2026-07-20 | Pre-beta | 2026-07-20 | — |
| BETA-028 | Localization | PreBase-specific UI strings / NLS for graphs, Magnus, onboarding | Medium | Not Started | — | Product copy | NLS export smoke | — | Pre-beta | 2026-07-20 | — |
| BETA-029 | Extensions | Built-in extensions `typecheck-web` / gulp compile under dual TS lanes | High | Needs Verification | — | Full compile-extensions | `compile-extensions` + spot typecheck | Phase F: gulp `compile-extension:prebase-magnus` + `compile-extension:typescript-language-features` 0 errors; `typecheck-web` on TS ext pass; matrix incomplete | Pre-beta | 2026-07-20 | — |
| BETA-030 | Infrastructure | Remote / web (REH) smoke: extension host, web client | High | Not Started | — | Platform matrix | REH manual or CI smoke | — | Pre-beta | 2026-07-20 | — |
| BETA-031 | Toolchain | npm 12 migration: allowScripts allowlist + lift `preinstall` `<12` guard | High | Not Started | — | Native deps / postinstall | `npm install` on 12.x builds natives; document engines | Blocked 2026-07-20: npm 12.0.1 rejected by preinstall; rolled back to 11.18.0 | Pre-beta | 2026-07-20 | — |

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

## Completed this task

| ID | Evidence |
|---|---|
| BETA-006 | `tsc` 7.0.2; `npm run verify:typescript`; `typecheck-client`; `npm run assurance` 2026-07-20 |
| BETA-007 | `@typescript/typescript6@6.0.2`, API 6.0.3, `tsc6`; `verify:typescript` |
| BETA-026 (partial) | Phase F: `TYPESCRIPT_EDITOR_VERIFICATION.md`, fixture `test/fixtures/typescript-lanes/`, Phase F section in `TYPESCRIPT_7_MIGRATION.md` |
| BETA-001 (partial) | Phase B settings + Phase C commands; boundary verifier includes Action2 `prebase.graph.*` scan |
| BETA-002 (partial) | `graphs/scripts/verify-boundary/verify.mjs`; `npm run verify:graphs-boundary` OK locally |
| BETA-016 (partial) | `build/icons/icon-integrity.sha256` + `verify:icons` 101/101 OK 2026-07-20; Phase J `assurance:package` |
| BETA-015 (partial) | Phase J docs + `scripts/release/signing-preflight.mjs` + `package-smoke.mjs`; gulp tasks verified; signing blocked without creds |
| BETA-025 (partial) | Packaging doc references upstream NOTICE flow; legal inventory still open |
| BETA-014 (partial) | `scripts/privacy/audit.mjs` static PASS; runtime network observation documented as Needs Verification |
| BETA-017 (partial) | Assurance tiers + [ASSURANCE.md](ASSURANCE.md) 2026-07-20 |
| BETA-027 (partial) | `.github/workflows/pr.yml` job `prebase-assurance` 2026-07-20 |
| BETA-026 (partial) | Checkpoint 1: `MIGRATION.md` Phase B/C sequencing + interaction ownership documented |
| BETA-017 (partial) | `assurance` script exists and passed locally 2026-07-20 |
| BETA-003/004/010/011/012/013 (templates) | [GRAPH_ACCEPTANCE.md](GRAPH_ACCEPTANCE.md), [CORE_IDE_ACCEPTANCE.md](CORE_IDE_ACCEPTANCE.md) — all GUI rows Needs Verification |
| BETA-024 (partial) | [GRAPH_PERFORMANCE.md](GRAPH_PERFORMANCE.md) + `graphs/scripts/benchmark-network-layouts.mjs` 2026-07-20 |
| BETA-005 (partial) | `test:graphs` 13 pass; Phase K `assurance:quick` 2026-07-20 |
| Phase K (honesty) | Reserved graph setting descriptions + Settings UI hints; `graphs/README.md` status |
