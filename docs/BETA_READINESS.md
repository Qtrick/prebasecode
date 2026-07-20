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
| Toolchain | BETA-006–009, 021 | TS7 dual-lane |
| Core IDE | BETA-010–011, 022 | Startup, editor, onboarding |
| Magnus | BETA-012 | Agent + graph tools |
| Runtime Preview | BETA-013 | Web/Electron lifecycle |
| Privacy | BETA-014 | Telemetry, secrets, CSP |
| Packaging | BETA-015–016 | Builds, signing, icons |
| Quality / CI | BETA-017–018, 026–027 | Assurance, a11y, docs, CI gates |
| Release / legal | BETA-019, 025 | Policies, notices |
| Security | BETA-023 | Supply chain |
| Extensions | BETA-029 | Built-in compile + TS lanes |
| Infrastructure | BETA-030 | Remote/web (REH) smoke |

---

## Items

| ID | Category | Description | Severity | Status | Owner | Blocker | Required validation | Evidence | Target | Added | Completed |
|---|---|---|---|---|---|---|---|---|---|---|---|
| BETA-001 | Graphs | Establish root `graphs/` as sole Architecture/Network graph subsystem | Blocker | In Progress | — | Settings/commands extraction | Boundary script pass; symlink compile; no duplicate core | `graphs/docs/MIGRATION.md` checkpoint 3+4, `npm run verify:graphs-boundary` | Pre-beta | 2026-07-20 | — |
| BETA-002 | Graphs | Graph boundary verifier in assurance/CI | Critical | Needs Verification | — | CI wiring (BETA-027) | `npm run verify:graphs-boundary` | Local pass 2026-07-20 | Pre-beta | 2026-07-20 | — |
| BETA-003 | Graphs | Architecture Graph manual acceptance (layouts, selection, minimap stub, settings) | Critical | Needs Verification | — | After move | Manual smoke on Architecture Graph | — | Pre-beta | 2026-07-20 | — |
| BETA-004 | Graphs | Network Graph manual acceptance (layouts, rotation, drag, idle rotate) | Critical | Needs Verification | — | After move | Manual smoke on Network Graph | — | Pre-beta | 2026-07-20 | — |
| BETA-005 | Graphs | Graph unit tests (`architecturePick`, `networkLayout`) under `graphs/src/tests/unit` | High | Needs Verification | — | CI gate | Mocha/node harness green | Checkpoint 3+4 local pass (parent agent) | Pre-beta | 2026-07-20 | — |
| BETA-006 | Toolchain | TypeScript 7.0.2 primary compiler lane | Blocker | Complete | — | — | `tsc`/`typecheck` invoke TS7 | `tsc` 7.0.2; `verify:typescript`; `typecheck-client` + `assurance` 2026-07-20 | Pre-beta | 2026-07-20 | 2026-07-20 |
| BETA-007 | Toolchain | TS6 compatibility lane for compiler API consumers | Critical | Complete | — | — | Inventory + compat resolve | `@typescript/typescript6@6.0.2`, import API 6.0.3, `tsc6` 6.0.3; `verify:typescript` | Pre-beta | 2026-07-20 | 2026-07-20 |
| BETA-008 | Toolchain | Replace `@typescript/native-preview`/`tsgo` with stable TS7 entrypoints | High | Needs Verification | — | Extension compile matrix | Scripts use TS7 `tsc` | Root/build/gulp stream migrated; legacy `tsgo.ts` filename; BETA-029 | Pre-beta | 2026-07-20 | — |
| BETA-009 | Toolchain | typescript-eslint typed lint on compat API | High | Needs Verification | — | Compat package | `npm run eslint` | Compat lane installed; eslint not in `assurance` | Pre-beta | 2026-07-20 | — |
| BETA-010 | Core | Clean startup / workspace open / crash recovery | Critical | Needs Verification | — | Assurance phase | Fresh + existing profile launch | — | Pre-beta | 2026-07-20 | — |
| BETA-011 | Core | Native editor reliability (save, undo, search, SCM, terminal, debug) | Critical | Needs Verification | — | Assurance | Manual smoke | — | Pre-beta | 2026-07-20 | — |
| BETA-012 | Magnus | Ask/Plan/Edit/Agent + graph tools reliability | Critical | Needs Verification | — | Host graph cmds | Tool smoke | — | Pre-beta | 2026-07-20 | — |
| BETA-013 | Runtime Preview | Web/Electron managed+external lifecycle cleanup | Critical | Needs Verification | — | Assurance | Manual + unit | — | Pre-beta | 2026-07-20 | — |
| BETA-014 | Privacy | Telemetry/crash/surveys disabled; secrets storage; CSP | Blocker | Needs Verification | — | Assurance | Privacy checklist | — | Pre-beta | 2026-07-20 | — |
| BETA-015 | Packaging | macOS/Windows/Linux builds, signing, notarization, updates | Blocker | Not Started | — | Platform access | CI/package smoke | Local: macOS only unless CI | Pre-beta | 2026-07-20 | — |
| BETA-016 | Packaging | Application icon preservation policy + checksum gate | High | Needs Verification | — | CI gate (BETA-027) | Checksums unchanged | 100/100 match `/tmp/prebase-icon-protection/checksums.sha256` 2026-07-20 | Pre-beta | 2026-07-20 | — |
| BETA-017 | Quality | Repeatable `assurance` npm script | High | Needs Verification | — | CI wiring (BETA-027) | One command orchestrates checks | `npm run assurance` pass locally 2026-07-20 (boundary + typecheck-client + transpile-client) | Pre-beta | 2026-07-20 | — |
| BETA-018 | Quality | Accessibility (keyboard, HC, reduced motion) for graphs + IDE | High | Not Started | — | Assurance | A11y smoke | Minimap still stub | Pre-beta | 2026-07-20 | — |
| BETA-019 | Release | Privacy policy, terms, support channel, known limitations | High | Not Started | — | Docs | Legal/support review | — | Pre-beta | 2026-07-20 | — |
| BETA-020 | Graphs | Minimap implementation (setting exists, UI stub) | Medium | Not Started | — | Product decision | Feature or remove setting | Notification-only today | After beta OK if deferred | 2026-07-20 | — |
| BETA-021 | Toolchain | Remove TS6 compat after TS 7.1 API | Medium | Not Started | — | TS 7.1 GA | Re-inventory API consumers | — | Post TS 7.1 | 2026-07-20 | — |
| BETA-022 | Core | Onboarding + account lifecycle | High | Needs Verification | — | Assurance | Sign-in/out smoke | — | Pre-beta | 2026-07-20 | — |
| BETA-023 | Security | Dependency audit + supply-chain review | Critical | Not Started | — | Lockfile review after TS7 | `npm audit` + review | — | Pre-beta | 2026-07-20 | — |
| BETA-024 | Graphs | Large-project graph performance/memory | High | Not Started | — | After migration | Perf sample | — | Pre-beta | 2026-07-20 | — |
| BETA-025 | Release | Third-party notices / license inventory for new packages | Medium | Not Started | — | Legal review | Notices update | `@typescript/typescript6` added to lockfile | Pre-beta | 2026-07-20 | — |
| BETA-026 | Documentation | Agent/dev docs (`AGENTS.md`, `graphs/*`, TS migration) kept current with repo | Medium | In Progress | — | — | Review on each checkpoint | Checkpoint 1 docs 2026-07-20 | Pre-beta | 2026-07-20 | — |
| BETA-027 | Quality | CI gates: graph boundary verifier + icon checksum diff | Critical | Not Started | — | Scripts land | CI fails on boundary/icon drift | Checksums local verify 100/100 | Pre-beta | 2026-07-20 | — |
| BETA-028 | Localization | PreBase-specific UI strings / NLS for graphs, Magnus, onboarding | Medium | Not Started | — | Product copy | NLS export smoke | — | Pre-beta | 2026-07-20 | — |
| BETA-029 | Extensions | Built-in extensions `typecheck-web` / gulp compile under dual TS lanes | High | Needs Verification | — | Full compile-extensions | `compile-extensions` + spot typecheck | Gulp uses `tsc`; per-ext scripts not re-run | Pre-beta | 2026-07-20 | — |
| BETA-030 | Infrastructure | Remote / web (REH) smoke: extension host, web client | High | Not Started | — | Platform matrix | REH manual or CI smoke | — | Pre-beta | 2026-07-20 | — |

## Newly discovered during 2026-07-20 audit

- Settings/commands extraction still required for BETA-001 completion (`prebaseConfiguration.ts`, `prebase.contribution.ts` allowlisted).
- `graphs/package.json` `typecheck` is **core-only**; host adapters typecheck via `npm run typecheck-client` through symlink.
- TS7 dual-lane install **complete** (BETA-006/007); `npm run verify:typescript` enforces primary `tsc` 7.x + compat packages.
- Manual graph acceptance (BETA-003/004), core IDE smoke (BETA-010/011), and Magnus (BETA-012) remain unverified this checkpoint.

## Completed this task

| ID | Evidence |
|---|---|
| BETA-006 | `tsc` 7.0.2; `npm run verify:typescript`; `typecheck-client`; `npm run assurance` 2026-07-20 |
| BETA-007 | `@typescript/typescript6@6.0.2`, API 6.0.3, `tsc6`; `verify:typescript` |
| BETA-026 (partial) | `TECHNOLOGY_VERSIONS.md`, `TYPESCRIPT_7_MIGRATION.md`, `graphs/README.md` aligned with installed lanes |
| BETA-001 (partial) | Sources + symlink + boundary verifier; extraction backlog documented |
| BETA-002 (partial) | `graphs/scripts/verify-boundary/verify.mjs`; `npm run verify:graphs-boundary` OK locally |
| BETA-016 (partial) | Local `shasum -a 256 -c` — 100/100 OK vs `/tmp/prebase-icon-protection/checksums.sha256` (checkpoint 3+4 + TS7 re-verify) |
| BETA-017 (partial) | `assurance` script exists and passed locally 2026-07-20 |
