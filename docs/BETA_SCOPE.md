# PreBase Public Beta Scope

Last updated: **2026-08-23** (Phase 3.10 — Architecture Graph removed from required beta scope; inert graph keys deprecated).  
Canonical backlog: [BETA_READINESS.md](BETA_READINESS.md).  
Execution resume: [BETA_EXECUTION_CHECKPOINT.md](BETA_EXECUTION_CHECKPOINT.md).

This document classifies product surfaces for the upcoming public beta. A feature marked **Disabled** must not appear as a working control in normal menus/onboarding. **Deferred** features may keep hidden compatibility keys.

## 1. Required for public beta

| Feature | Notes |
|---|---|
| Application launch + workbench mount | Fresh/existing profile; offline |
| Open folder/workspace, save, undo/redo | Native editor reliability |
| Search, SCM, terminal, debug, Problems, Output | Core IDE |
| Settings + keybindings + extensions (Open VSX) | |
| Code Graph (Network layouts) | Organic / Sphere / Constellation / Clustered (4 active layouts; legacy "radial" normalized to "organic" per BETA-003 and `graphs/PRESERVED_ARCHITECTURE.md`) |
| Temporal Graph | Commit timeline scrubbing, state/changes modes, comparison workbench |
| Local Magnus (Agents) provider | Ask/Plan/Edit/Test/Agent; local API key in SecretStorage |
| Web Runtime Preview | Supported web frameworks; process cleanup |
| Privacy defaults | Telemetry/crash upload/surveys off; CSP on PreBase webviews |
| Static secret scan + icon integrity | CI gates |
| Unsigned installable desktop artifact (at least one platform) | Signing may remain external |
| Graph ownership under root `graphs/` | Phase A done: Settings UI in `graphSettingsUi.ts`; Phase D flat core shims removed; shell routes only |
| Startup `out/` graphs emit gate | `verify:startup` static; optional `PREBASE_STARTUP_LAUNCH=1` requires extension host **and** `[PreBase] workbench restored` (outside-sandbox PASS 2026-07-22; CORE_IDE matrix still open) |

## 2. Enabled as experimental

| Feature | Gate / disclosure |
|---|---|
| Supabase email/password Auth | User settings `prebase.cloud.*`; optional; IDE works signed-out |
| Cloud preference sync (profiles/preferences) | Only when Auth configured; disclose cloud storage |
| Managed Electron Runtime Preview | Experimental; document process ownership |

## 3. Disabled until ready

| Feature | Reason | User-facing rule |
|---|---|---|
| Hosted Magnus (PreBase Hosted provider) | Gateway returns `501`; quotas/rate limits incomplete (BETA-035 **Deferred After Beta**) | Do not expose picker entry that claims hosted works — see [HOSTED_MAGNUS.md](HOSTED_MAGNUS.md) |
| Graph minimap | Stub only (BETA-020) | Keep hidden; no fake UI |
| Auto-update to a Microsoft feed | Wrong identity | Disable or point only at PreBase feed when ready |
| Agent-history cloud sync UI | Deferred (BETA-036) | No opt-in UI until privacy disclosure ready |

## 4. Deferred after beta

| Feature | ID / notes |
|---|---|
| Graph minimap implementation | BETA-020 — Option 2: defer, keep hidden |
| Remove TypeScript 6 compatibility lane | BETA-021 — wait for TS 7.1 API |
| Full localization coverage | BETA-028 — English strings must be correct for beta |
| npm 12 migration | BETA-031 — preinstall blocks 12.x; revisit with allowScripts |
| Cloud agent-history sync + export/delete UI | BETA-036 |
| Hosted Magnus agent-gateway | BETA-035 — disabled until re-enable checklist complete |
| Desktop automation beyond Runtime Preview | Out of beta scope |
| Remote/web PreBase as primary surface | BETA-030 smoke only; desktop-first beta |

## 5. External prerequisites

| Item | Status |
|---|---|
| Apple Developer + notarization credentials (`PREBASE_*`) | Missing — signing Blocked |
| Windows code-signing certificate | Missing — signing Blocked |
| Legal counsel review of privacy/terms | Not started (BETA-019) |
| Production Supabase project hardening / adversarial RLS CI project | Static OK; runtime tests open (BETA-034) |
| Provider API keys for hosted gateway (server-side only) | N/A while hosted disabled |
| Dated `npm audit --omit=dev` review | Findings recorded 2026-07-22; reachability/remediation open (BETA-023 In Progress) |

## Scope decisions locked this pass

1. **Minimap:** Option 2 — defer after beta; keep setting/command hidden; no fake minimap.
2. **Hosted Magnus:** Disabled for beta until BETA-035 complete; local provider remains required; no fake picker.
3. **Supabase Auth:** Experimental/optional — do not block startup or local workflows.
4. **npm 12:** Not a beta ship blocker; retain npm 11.x guard until researched migration.
5. **Onboarding:** Must use versioned storage (fixed hardcoded `isOnboardingComplete(): return true`); register without infinite loop; allow “continue without signing in.”
6. **Secrets:** Account tokens only via `secretStorageSessionAdapter` + `PreBaseCloudService` / `ISecretStorageService` — never `IStorageService` (enforced by `verify:privacy`).
7. **assurance:full:** Static + privacy only; eslint skipped on purpose — **not** a release gate.
8. **assurance:release:** Exists — static + privacy + **PreBase-path** eslint ratchet only; does **not** claim full-repo `npm run eslint` clean (BETA-009/023).
9. **Icons:** Frozen; Dock cache ≠ source change.
10. **BETA-014:** Partial — static privacy/secrets/CSP; runtime network observation required before Complete.
11. **BETA-023:** In Progress — findings recorded; reachability + remediation decision required before Complete.
12. **Beta candidate / ship claim:** **Forbidden** until Blockers + Critical GUI/privacy/packaging evidence land (see [BETA_READINESS.md](BETA_READINESS.md)).

## Checkpoint honesty notes (2026-07-22)

- Privacy auditor previously falsely required `ISecretStorageService` in `prebaseAccountService.ts`; fixed to require adapter + cloud service and fail on token-in-`IStorageService`.
- Copilot: root `compile-copilot` / `watch-copilot` / `copilot:*` scripts **removed**. `extensions/copilot` still tracked (~4k files) with **no** `package.json` (`package.json.disabled` only) — document; do **not** mass-delete unless a dedicated safe audit says so.
- Phase A **complete** (Settings UI + shim removal). Phase B **partial** (storage/startup; GUI matrix open). Phase D/F **partial** (docs + ratchet + hosted disable). **Not** beta-ready overall; **not** a beta candidate.
- `verify:eslint-prebase` must use ESLint on PreBase globs (not `npm run eslint`, which ignores path args).
- Checkpoint #12: no misleading Complete marks on BETA-010/014/022/023/032/035; icons frozen.
