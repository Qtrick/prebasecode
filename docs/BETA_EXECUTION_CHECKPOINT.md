# Beta Execution Checkpoint

Resume file for PreBase beta readiness work. Update after every phase.

## Current phase

**Checkpoint #12 — FINAL whole-diff production-readiness review** (2026-07-22).

Prior: **Phase D/F partial — Checkpoint #5** (privacy/CSP/supply-chain docs + hosted disable + `assurance:release` ratchet); **Phase B partial — Checkpoint #4** (startup + onboarding storage).

### Next agent steps (exact order)

1. **Phase B GUI evidence** — fill [CORE_IDE_ACCEPTANCE.md](CORE_IDE_ACCEPTANCE.md) C1–C5 + P2/P3 with dated evidence (do **not** mark BETA-010/022 Complete until rows pass).
2. **Phase C graph acceptance** — [GRAPH_ACCEPTANCE.md](GRAPH_ACCEPTANCE.md) Architecture + Network (BETA-003/004); Settings UI smoke for BETA-001.
3. **Finish Phase D** — privacy **runtime** network observation ([ASSURANCE.md](ASSURANCE.md#runtime-network-observation)) → update BETA-014; then BETA-023 reachability/remediation for recorded `shell-quote` / `tar` (findings already in [SECURITY_AND_SUPPLY_CHAIN.md](SECURITY_AND_SUPPLY_CHAIN.md)).
4. **Phase E** — Auth + RLS adversarial two-user runtime (BETA-033/034).
5. Keep hosted Magnus **Disabled** (BETA-035) — no fake picker; no re-enable without [HOSTED_MAGNUS.md](HOSTED_MAGNUS.md) checklist.
6. Later: Magnus/Runtime acceptance (G–H), PreBase eslint debt (I), a11y/legal (J), CI+packaging (L–M).
7. **Do not** claim beta candidate / ship. **Do not** mass-delete `extensions/copilot` without a dedicated safe audit.

## Git / environment baseline

| Item | Value |
|---|---|
| Branch | `main` |
| HEAD | Uncommitted Checkpoint #4–#12 worktree (Settings UI, shim removal, onboarding, privacy/assurance docs, Copilot script removal) |
| Node | v24.17.0 |
| npm | 11.18.0 |
| Electron (package) | 42.5.0 |
| Primary tsc | 7.0.2 (`@typescript/native` → typescript@7) |
| Compat | `@typescript/typescript6@6.0.2`, import API 6.0.3, `tsc6` 6.0.3 |
| supabase-js in root deps | Not installed as direct package (REST client) |
| Icons | Frozen — do not touch sources or `build/icons/icon-integrity.sha256` |
| Copilot | Root scripts removed; `extensions/copilot` ~4172 tracked files, **no** `package.json` (`package.json.disabled`) — document only |

## Checkpoint #12 validation (this pass)

| Command / check | Result |
|---|---|
| `npm run verify:icons` | **PASS** 101/101 |
| `npm run verify:privacy` | **PASS** (1 warning: runtime observation Needs Verification) |
| `npm run assurance:quick` | **PASS** (boundary, startup static, TS lanes, icons, supabase static, typecheck graphs+client, test:graphs 17) |
| Whole-diff honesty | Doc contradictions on npm-audit “not recorded” **fixed**; no new Complete marks |
| Beta candidate claim | **FORBIDDEN** |
| Icons policy | Unchanged / frozen (no resource/icon byte edits in this worktree) |
| CORE_IDE / GRAPH acceptance | Still Needs Verification |

## Phase D/F partial deliverables (Checkpoint #5) — retained

| Item | Status |
|---|---|
| Privacy/secrets/CSP docs honesty | **Done** — ASSURANCE + SECURITY + RLS runtime template; static only |
| Hosted Magnus disabled docs | **Done** — [HOSTED_MAGNUS.md](HOSTED_MAGNUS.md); BETA-035 Deferred After Beta |
| Gateway `501` confirmed | **Done** — `agent-gateway` returns `not_implemented` after auth path |
| No lying hosted client picker | **Done** — no PreBase Hosted provider entry in magnus/contrib/graphs |
| `assurance:release` + `verify:eslint-prebase` | **Done** — PreBase-path ESLint API ratchet |
| BETA-014 | **Partial / In Progress** — static PASS; runtime observation open |
| BETA-023 | **In Progress** — findings **recorded**; reachability/remediation open |
| BETA-010 Complete | **No** — launch evidence recorded; CORE_IDE matrix still Needs Verification |

## Phase B partial deliverables (Checkpoint #4) — retained

| Item | Status |
|---|---|
| Versioned onboarding storage | **Done** |
| Onboarding editor registration | **Done** |
| First-run open once | **Done** |
| Home empty-editors coexistence | **Done** |
| Workbench restored marker | **Done** |
| `verify:startup` launch signals | **Done** — EH + workbench restored; profile preserved on fail |
| CORE_IDE_ACCEPTANCE GUI rows | **Still Needs Verification** |

## Phase A deliverables — retained

| Item | Status |
|---|---|
| `graphs/src/host/workbench/settings/graphSettingsUi.ts` | **Done** |
| Phase D flat `graphs/src/core/*.ts` shims | **Deleted** |
| Boundary verifier | Rejects flat `core/*`; requires Settings UI route |
| Ownership unit test | Present |

## Completed work this session

- [x] Repository audit vs backlog
- [x] [BETA_SCOPE.md](BETA_SCOPE.md) written
- [x] code-reviewer-editor #1 — privacy auditor fix + stale doc/script corrections
- [x] Phase A — Settings UI extract + shim removal
- [x] code-reviewer-editor #2/#3 — boundary/docs/tests honesty pass
- [x] Phase B partial — onboarding storage + startup marker + Home yield
- [x] code-reviewer-editor #4 — Checkpoint #4 defect pass
- [x] Phase D/F partial — privacy/supply-chain docs + hosted disable + assurance:release ratchet
- [x] code-reviewer-editor #5 — Checkpoint #5 honesty/autofix
- [x] code-reviewer-editor #12 — FINAL whole-diff honesty + Copilot documentation + gate run
- [ ] Phase B GUI acceptance evidence …
- [ ] Phase C–M …

## Failures / newly discovered (status after Checkpoint #12)

1. ~~**Privacy static auditor stale**~~ — **Fixed** in Checkpoint #1.
2. ~~**Onboarding hardcoded complete**~~ — **Fixed** Phase B.
3. ~~**~27 Phase D graph shims**~~ — **Removed** in Phase A.
4. ~~**Graph Settings UI in shell**~~ — **Extracted** in Phase A.
5. **Hosted gateway** `501 not_implemented` — **Disabled** for beta (BETA-035 Deferred After Beta); keep disabled.
6. ~~**`assurance:full` skips eslint; no `assurance:release`**~~ — **`assurance:release` exists**; PreBase-path ratchet only.
7. **Copilot** — root scripts removed; tree still tracked without `package.json` — **do not mass-delete**; hygiene/audit later.
8. ~~**Startup launch extension-host-only**~~ — **Strengthened** + outside-sandbox launch PASS (EH + workbench restored).
9. **GUI Settings / core IDE / onboarding smoke** — still open (BETA-003/010/011/022).
10. ~~**Reviewer #4 fix:** Home empty-editors race~~ — yield path added.
11. ~~**Reviewer #5:** `verify:eslint-prebase` no-op~~ — **fixed**.
12. ~~**Reviewer #12:** SECURITY/BETA claimed “npm audit not recorded” while findings table existed~~ — **fixed** (findings recorded; remediation still open).
13. **BETA-023** — findings recorded; reachability + remediation still open.
14. **BETA-014** — runtime network observation still open.
15. **Packaging/signing** — unsigned full package + `PREBASE_*` creds still Blocked (BETA-015).

## Checkpoint #12 go / no-go

**GO for continuing** Phase B GUI evidence → Phase C graphs → privacy runtime → BETA-023 remediation classification.

**NO-GO for claiming** Phase B/D/F Complete, BETA-010/014/022/023/032 Complete, hosted Magnus enabled, or **beta candidate / ship**.

**Not GO for beta ship** — GUI acceptance, privacy runtime observation, packaging/signing, supply-chain remediation, a11y, legal docs remain open.

## Planned sequence

1. ~~Reviewer #1 on plan → apply doc/plan corrections~~
2. ~~Phase A: Settings UI extract + shim removal + settings audit + tests~~
3. ~~Reviewer #2 after graphs boundary finalize~~
4. ~~Reviewer #3 after shim/Settings UI~~
5. ~~Phase B partial: startup smoke + onboarding storage~~
6. ~~Reviewer #4 (Checkpoint #4)~~
7. Finish Phase B: CORE_IDE GUI evidence
8. Phase C graph acceptance
9. ~~Phase D/F partial: privacy/supply-chain docs + hosted disable + release lint ratchet~~
10. ~~Reviewer #5 (Checkpoint #5)~~
11. Finish Phase D: runtime network observation + BETA-023 reachability/remediation
12. Phase E Auth + RLS runtime
13. Reviewer #6
14. Phase F hosted Magnus — **keep disabled** until checklist; no fake picker
15. Reviewer #7
16. Phase G–H Magnus + Runtime acceptance
17. Reviewer #8
18. Phase I TS/lint/extensions (pay down PreBase eslint baseline debt)
19. Reviewer #9
20. Phase J a11y/NLS/docs
21. Reviewer #10
22. Phase L CI + Phase M packaging
23. Reviewer #11
24. ~~Final whole-diff Reviewer #12 + update BETA_READINESS.md~~

## Rollback points

- Before Phase A: clean tree / Checkpoint #1
- After Settings UI extract: revert `graphs/src/host/workbench/settings/**` + restore `_render*` in settings editor
- After shim removal: restore shim files from git if out-of-tree importers appear
- After Phase B onboarding: revert account storage keys + onboarding contribution/editor registration
- After Checkpoint #5: revert `scripts/assurance/verify-eslint-prebase.mjs` + baseline + docs if ratchet misbehaves
- Never: `git reset --hard`; never touch icon bytes; never mass-delete `extensions/copilot` without audit

## Unresolved decisions

- None blocking Checkpoint #12 documentation; CORE_IDE + GRAPH GUI evidence still required before any Complete on those IDs

## Continuation instructions (if context limit)

1. Read this file + `docs/BETA_SCOPE.md` + `docs/BETA_READINESS.md`
2. Run `npm run verify:icons` and `git status --short` (icons must stay clean)
3. Resume at “Next agent steps” above (start with CORE_IDE_ACCEPTANCE)
4. Invoke code-reviewer-editor at the next required checkpoint before broad edits
