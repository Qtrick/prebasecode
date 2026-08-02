# Beta Item Pre-Assessments
**Run:** `2026-08-02T041900Z-9fde0994-darwin-arm64`  
**Branch:** `main`  
**Commit:** `9fde099426b124063653c99e4ab8e56278e9d803`  
**Generated:** 2026-08-02T04:23:29.221686+00:00  
**Dirty working tree:** yes (103 paths)  

Evidence root: `reports/beta-evidence/2026-08-02T041900Z-9fde0994-darwin-arm64/`.  
Default decision: **NO-GO** until required evidence exists.

Official research note (2026-08-02): TypeScript 7.0 GA lacks programmatic API; retain TS6 compat until 7.1 ([Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)).

## BETA-001

1. **Canonical description:** see `docs/BETA_READINESS.md`  
2. **Tracker status:** Needs Verification  
3. **Observed implementation state:** Locally verified (static+unit); GUI Settings smoke missing; CI remote missing  
4. **Implementation files:** graphs/src/**, src/vs/workbench/contrib/prebase/browser/prebaseSettingsEditor.ts  
5. **Entrypoints:** see implementation files / workbench contributions  
6. **Tests/scripts:** see `reports/beta-evidence/2026-08-02T041900Z-9fde0994-darwin-arm64/commands.json`  
7. **Existing evidence:** verify-graphs-boundary, typecheck-graphs-rerun, typecheck-client-v3, test-graphs-rerun, assurance-quick-v4  
8. **Evidence still valid for HEAD?** Partial — dirty tree; local static/unit only where listed  
9. **Missing implementation:** (see observed state)  
10. **Missing validation:** GUI Settings smoke, remote CI green  
11. **Dependencies:** BETA-002, BETA-004, BETA-027, BETA-037  
12. **Risk:** medium for graph/privacy/cloud; icons frozen  
13. **Required research:** subsystem-specific official docs  
14. **Proposed smallest safe action:** GUI Settings smoke, CI evidence  
15. **Required evidence type:** match acceptance criteria in task prompt  
16. **Rollback:** revert focused files; restore icons from checksums if needed  
17. **Proposed status after work:** Needs Verification  

## BETA-002

1. **Canonical description:** see `docs/BETA_READINESS.md`  
2. **Tracker status:** Needs Verification  
3. **Observed implementation state:** Statically verified only (local verifier pass; remote CI not re-proven this run)  
4. **Implementation files:** graphs/scripts/verify-boundary/verify.mjs, .github/workflows/  
5. **Entrypoints:** see implementation files / workbench contributions  
6. **Tests/scripts:** see `reports/beta-evidence/2026-08-02T041900Z-9fde0994-darwin-arm64/commands.json`  
7. **Existing evidence:** local verify-graphs-boundary pass  
8. **Evidence still valid for HEAD?** Partial — dirty tree; local static/unit only where listed  
9. **Missing implementation:** (see observed state)  
10. **Missing validation:** actual GitHub Actions run ID  
11. **Dependencies:** BETA-027  
12. **Risk:** medium for graph/privacy/cloud; icons frozen  
13. **Required research:** subsystem-specific official docs  
14. **Proposed smallest safe action:** obtain remote PR run  
15. **Required evidence type:** match acceptance criteria in task prompt  
16. **Rollback:** revert focused files; restore icons from checksums if needed  
17. **Proposed status after work:** Needs Verification  

## BETA-003

1. **Canonical description:** see `docs/BETA_READINESS.md`  
2. **Tracker status:** Deferred After Beta  
3. **Observed implementation state:** Obsolete or superseded  
4. **Implementation files:** graphs/src/preserved/architecture/**  
5. **Entrypoints:** see implementation files / workbench contributions  
6. **Tests/scripts:** see `reports/beta-evidence/2026-08-02T041900Z-9fde0994-darwin-arm64/commands.json`  
7. **Existing evidence:** product UI absence (source), ownership tests  
8. **Evidence still valid for HEAD?** Partial — dirty tree; local static/unit only where listed  
9. **Missing implementation:** (see observed state)  
10. **Missing validation:** GUI absence screenshot  
11. **Dependencies:** BETA-037  
12. **Risk:** medium for graph/privacy/cloud; icons frozen  
13. **Required research:** subsystem-specific official docs  
14. **Proposed smallest safe action:** GUI absence screenshot  
15. **Required evidence type:** match acceptance criteria in task prompt  
16. **Rollback:** revert focused files; restore icons from checksums if needed  
17. **Proposed status after work:** Deferred After Beta  

## BETA-004

1. **Canonical description:** see `docs/BETA_READINESS.md`  
2. **Tracker status:** Needs Verification  
3. **Observed implementation state:** Implemented but untested (GUI)  
4. **Implementation files:** graphs/src/host/workbench/graphEditor.ts, graphs/src/presentation/selectedNodeCard.ts  
5. **Entrypoints:** see implementation files / workbench contributions  
6. **Tests/scripts:** see `reports/beta-evidence/2026-08-02T041900Z-9fde0994-darwin-arm64/commands.json`  
7. **Existing evidence:** unit morph tests, webview parse  
8. **Evidence still valid for HEAD?** Partial — dirty tree; local static/unit only where listed  
9. **Missing implementation:** (see observed state)  
10. **Missing validation:** GUI morph matrix screenshots/recording  
11. **Dependencies:** BETA-037  
12. **Risk:** medium for graph/privacy/cloud; icons frozen  
13. **Required research:** subsystem-specific official docs  
14. **Proposed smallest safe action:** execute GRAPH_ACCEPTANCE morph rows  
15. **Required evidence type:** match acceptance criteria in task prompt  
16. **Rollback:** revert focused files; restore icons from checksums if needed  
17. **Proposed status after work:** Needs Verification  

## BETA-005

1. **Canonical description:** see `docs/BETA_READINESS.md`  
2. **Tracker status:** Needs Verification  
3. **Observed implementation state:** Locally verified  
4. **Implementation files:** graphs/src/tests/unit/**, graphs/scripts/run-unit-tests.mjs  
5. **Entrypoints:** see implementation files / workbench contributions  
6. **Tests/scripts:** see `reports/beta-evidence/2026-08-02T041900Z-9fde0994-darwin-arm64/commands.json`  
7. **Existing evidence:** test:graphs 54 pass local  
8. **Evidence still valid for HEAD?** Partial — dirty tree; local static/unit only where listed  
9. **Missing implementation:** (see observed state)  
10. **Missing validation:** CI test job green  
11. **Dependencies:** BETA-027  
12. **Risk:** medium for graph/privacy/cloud; icons frozen  
13. **Required research:** subsystem-specific official docs  
14. **Proposed smallest safe action:** CI evidence  
15. **Required evidence type:** match acceptance criteria in task prompt  
16. **Rollback:** revert focused files; restore icons from checksums if needed  
17. **Proposed status after work:** Needs Verification  

## BETA-006

1. **Canonical description:** see `docs/BETA_READINESS.md`  
2. **Tracker status:** Complete  
3. **Observed implementation state:** Complete with current evidence (revalidated verify:typescript this run)  
4. **Implementation files:** graphs/scripts/verify-typescript-lanes.mjs, package.json  
5. **Entrypoints:** see implementation files / workbench contributions  
6. **Tests/scripts:** see `reports/beta-evidence/2026-08-02T041900Z-9fde0994-darwin-arm64/commands.json`  
7. **Existing evidence:** verify-typescript pass  
8. **Evidence still valid for HEAD?** Partial — dirty tree; local static/unit only where listed  
9. **Missing implementation:** (see observed state)  
10. **Missing validation:** —  
11. **Dependencies:** —  
12. **Risk:** medium for graph/privacy/cloud; icons frozen  
13. **Required research:** subsystem-specific official docs  
14. **Proposed smallest safe action:** none  
15. **Required evidence type:** match acceptance criteria in task prompt  
16. **Rollback:** revert focused files; restore icons from checksums if needed  
17. **Proposed status after work:** Complete  

## BETA-007

1. **Canonical description:** see `docs/BETA_READINESS.md`  
2. **Tracker status:** Complete  
3. **Observed implementation state:** Complete with current evidence; TS 7.1 API still pending per official docs 2026-07-08  
4. **Implementation files:** @typescript/typescript6  
5. **Entrypoints:** see implementation files / workbench contributions  
6. **Tests/scripts:** see `reports/beta-evidence/2026-08-02T041900Z-9fde0994-darwin-arm64/commands.json`  
7. **Existing evidence:** verify-typescript  
8. **Evidence still valid for HEAD?** Partial — dirty tree; local static/unit only where listed  
9. **Missing implementation:** (see observed state)  
10. **Missing validation:** —  
11. **Dependencies:** BETA-021  
12. **Risk:** medium for graph/privacy/cloud; icons frozen  
13. **Required research:** subsystem-specific official docs  
14. **Proposed smallest safe action:** keep dual lane until 7.1 API  
15. **Required evidence type:** match acceptance criteria in task prompt  
16. **Rollback:** revert focused files; restore icons from checksums if needed  
17. **Proposed status after work:** Complete  

## BETA-008

1. **Canonical description:** see `docs/BETA_READINESS.md`  
2. **Tracker status:** Needs Verification  
3. **Observed implementation state:** Partially implemented  
4. **Implementation files:** build scripts  
5. **Entrypoints:** see implementation files / workbench contributions  
6. **Tests/scripts:** see `reports/beta-evidence/2026-08-02T041900Z-9fde0994-darwin-arm64/commands.json`  
7. **Existing evidence:** spot compiles historically  
8. **Evidence still valid for HEAD?** Partial — dirty tree; local static/unit only where listed  
9. **Missing implementation:** (see observed state)  
10. **Missing validation:** full extension compile matrix  
11. **Dependencies:** BETA-029  
12. **Risk:** medium for graph/privacy/cloud; icons frozen  
13. **Required research:** subsystem-specific official docs  
14. **Proposed smallest safe action:** full compile-extensions  
15. **Required evidence type:** match acceptance criteria in task prompt  
16. **Rollback:** revert focused files; restore icons from checksums if needed  
17. **Proposed status after work:** Needs Verification  

## BETA-009

1. **Canonical description:** see `docs/BETA_READINESS.md`  
2. **Tracker status:** Needs Verification  
3. **Observed implementation state:** Statically verified only / ratchet failed this run earlier  
4. **Implementation files:** scripts/assurance/verify-eslint-prebase.mjs  
5. **Entrypoints:** see implementation files / workbench contributions  
6. **Tests/scripts:** see `reports/beta-evidence/2026-08-02T041900Z-9fde0994-darwin-arm64/commands.json`  
7. **Existing evidence:** verify-eslint-prebase exit=1 this run — investigate  
8. **Evidence still valid for HEAD?** Partial — dirty tree; local static/unit only where listed  
9. **Missing implementation:** (see observed state)  
10. **Missing validation:** green ratchet after dirty tree  
11. **Dependencies:** —  
12. **Risk:** medium for graph/privacy/cloud; icons frozen  
13. **Required research:** subsystem-specific official docs  
14. **Proposed smallest safe action:** inspect eslint-prebase log; fix or document  
15. **Required evidence type:** match acceptance criteria in task prompt  
16. **Rollback:** revert focused files; restore icons from checksums if needed  
17. **Proposed status after work:** Needs Verification  

## BETA-010

1. **Canonical description:** see `docs/BETA_READINESS.md`  
2. **Tracker status:** Needs Verification  
3. **Observed implementation state:** Statically verified only (verify:startup launch skipped)  
4. **Implementation files:** scripts/startup/**  
5. **Entrypoints:** see implementation files / workbench contributions  
6. **Tests/scripts:** see `reports/beta-evidence/2026-08-02T041900Z-9fde0994-darwin-arm64/commands.json`  
7. **Existing evidence:** static startup PASS  
8. **Evidence still valid for HEAD?** Partial — dirty tree; local static/unit only where listed  
9. **Missing implementation:** (see observed state)  
10. **Missing validation:** C1–C5 GUI with screenshots  
11. **Dependencies:** BETA-032  
12. **Risk:** medium for graph/privacy/cloud; icons frozen  
13. **Required research:** subsystem-specific official docs  
14. **Proposed smallest safe action:** PREBASE_STARTUP_LAUNCH=1 + CORE_IDE matrix  
15. **Required evidence type:** match acceptance criteria in task prompt  
16. **Rollback:** revert focused files; restore icons from checksums if needed  
17. **Proposed status after work:** Needs Verification  

## BETA-011

1. **Canonical description:** see `docs/BETA_READINESS.md`  
2. **Tracker status:** Needs Verification  
3. **Observed implementation state:** Implemented but untested  
4. **Implementation files:** CORE_IDE_ACCEPTANCE.md  
5. **Entrypoints:** see implementation files / workbench contributions  
6. **Tests/scripts:** see `reports/beta-evidence/2026-08-02T041900Z-9fde0994-darwin-arm64/commands.json`  
7. **Existing evidence:** none for this HEAD  
8. **Evidence still valid for HEAD?** Partial — dirty tree; local static/unit only where listed  
9. **Missing implementation:** (see observed state)  
10. **Missing validation:** E1–E6 GUI  
11. **Dependencies:** BETA-010  
12. **Risk:** medium for graph/privacy/cloud; icons frozen  
13. **Required research:** subsystem-specific official docs  
14. **Proposed smallest safe action:** manual/automated smoke  
15. **Required evidence type:** match acceptance criteria in task prompt  
16. **Rollback:** revert focused files; restore icons from checksums if needed  
17. **Proposed status after work:** Needs Verification  

## BETA-012

1. **Canonical description:** see `docs/BETA_READINESS.md`  
2. **Tracker status:** Needs Verification  
3. **Observed implementation state:** Partially implemented  
4. **Implementation files:** extensions/prebase-magnus/**, graphs graph Magnus cmds  
5. **Entrypoints:** see implementation files / workbench contributions  
6. **Tests/scripts:** see `reports/beta-evidence/2026-08-02T041900Z-9fde0994-darwin-arm64/commands.json`  
7. **Existing evidence:** none for this HEAD  
8. **Evidence still valid for HEAD?** Partial — dirty tree; local static/unit only where listed  
9. **Missing implementation:** (see observed state)  
10. **Missing validation:** session evidence  
11. **Dependencies:** BETA-037  
12. **Risk:** medium for graph/privacy/cloud; icons frozen  
13. **Required research:** subsystem-specific official docs  
14. **Proposed smallest safe action:** Magnus mode matrix  
15. **Required evidence type:** match acceptance criteria in task prompt  
16. **Rollback:** revert focused files; restore icons from checksums if needed  
17. **Proposed status after work:** Needs Verification  

## BETA-013

1. **Canonical description:** see `docs/BETA_READINESS.md`  
2. **Tracker status:** Needs Verification  
3. **Observed implementation state:** Partially implemented  
4. **Implementation files:** runtime preview contrib  
5. **Entrypoints:** see implementation files / workbench contributions  
6. **Tests/scripts:** see `reports/beta-evidence/2026-08-02T041900Z-9fde0994-darwin-arm64/commands.json`  
7. **Existing evidence:** privacy static CSP  
8. **Evidence still valid for HEAD?** Partial — dirty tree; local static/unit only where listed  
9. **Missing implementation:** (see observed state)  
10. **Missing validation:** web/managed/external GUI  
11. **Dependencies:** —  
12. **Risk:** medium for graph/privacy/cloud; icons frozen  
13. **Required research:** subsystem-specific official docs  
14. **Proposed smallest safe action:** Runtime Preview acceptance  
15. **Required evidence type:** match acceptance criteria in task prompt  
16. **Rollback:** revert focused files; restore icons from checksums if needed  
17. **Proposed status after work:** Needs Verification  

## BETA-014

1. **Canonical description:** see `docs/BETA_READINESS.md`  
2. **Tracker status:** In Progress  
3. **Observed implementation state:** Statically verified only  
4. **Implementation files:** scripts/privacy/audit.mjs  
5. **Entrypoints:** see implementation files / workbench contributions  
6. **Tests/scripts:** see `reports/beta-evidence/2026-08-02T041900Z-9fde0994-darwin-arm64/commands.json`  
7. **Existing evidence:** verify-privacy pass  
8. **Evidence still valid for HEAD?** Partial — dirty tree; local static/unit only where listed  
9. **Missing implementation:** (see observed state)  
10. **Missing validation:** runtime network observation  
11. **Dependencies:** —  
12. **Risk:** medium for graph/privacy/cloud; icons frozen  
13. **Required research:** subsystem-specific official docs  
14. **Proposed smallest safe action:** build CDP/webRequest capture  
15. **Required evidence type:** match acceptance criteria in task prompt  
16. **Rollback:** revert focused files; restore icons from checksums if needed  
17. **Proposed status after work:** In Progress  

## BETA-015

1. **Canonical description:** see `docs/BETA_READINESS.md`  
2. **Tracker status:** Blocked  
3. **Observed implementation state:** Externally blocked (signing) + package artifact missing  
4. **Implementation files:** docs/PACKAGING.md, scripts/release/**  
5. **Entrypoints:** see implementation files / workbench contributions  
6. **Tests/scripts:** see `reports/beta-evidence/2026-08-02T041900Z-9fde0994-darwin-arm64/commands.json`  
7. **Existing evidence:** assurance-package informational; signing vars missing  
8. **Evidence still valid for HEAD?** Partial — dirty tree; local static/unit only where listed  
9. **Missing implementation:** (see observed state)  
10. **Missing validation:** unsigned full package artifact+hash+launch  
11. **Dependencies:** BETA-016  
12. **Risk:** medium for graph/privacy/cloud; icons frozen  
13. **Required research:** subsystem-specific official docs  
14. **Proposed smallest safe action:** build unsigned package; signing remains Blocked  
15. **Required evidence type:** match acceptance criteria in task prompt  
16. **Rollback:** revert focused files; restore icons from checksums if needed  
17. **Proposed status after work:** Blocked  

## BETA-016

1. **Canonical description:** see `docs/BETA_READINESS.md`  
2. **Tracker status:** Needs Verification  
3. **Observed implementation state:** Locally verified  
4. **Implementation files:** build/icons/icon-integrity.sha256  
5. **Entrypoints:** see implementation files / workbench contributions  
6. **Tests/scripts:** see `reports/beta-evidence/2026-08-02T041900Z-9fde0994-darwin-arm64/commands.json`  
7. **Existing evidence:** verify:icons 101/101; checksums match  
8. **Evidence still valid for HEAD?** Partial — dirty tree; local static/unit only where listed  
9. **Missing implementation:** (see observed state)  
10. **Missing validation:** CI negative fixture; packaged icon path  
11. **Dependencies:** BETA-027, BETA-015  
12. **Risk:** medium for graph/privacy/cloud; icons frozen  
13. **Required research:** subsystem-specific official docs  
14. **Proposed smallest safe action:** CI evidence  
15. **Required evidence type:** match acceptance criteria in task prompt  
16. **Rollback:** revert focused files; restore icons from checksums if needed  
17. **Proposed status after work:** Needs Verification  

## BETA-017

1. **Canonical description:** see `docs/BETA_READINESS.md`  
2. **Tracker status:** Needs Verification  
3. **Observed implementation state:** Locally verified (quick/privacy/graphs/cloud/package)  
4. **Implementation files:** package.json assurance:*  
5. **Entrypoints:** see implementation files / workbench contributions  
6. **Tests/scripts:** see `reports/beta-evidence/2026-08-02T041900Z-9fde0994-darwin-arm64/commands.json`  
7. **Existing evidence:** assurance-quick-v4 pass  
8. **Evidence still valid for HEAD?** Partial — dirty tree; local static/unit only where listed  
9. **Missing implementation:** (see observed state)  
10. **Missing validation:** intentional failure fixture; CI  
11. **Dependencies:** BETA-027  
12. **Risk:** medium for graph/privacy/cloud; icons frozen  
13. **Required research:** subsystem-specific official docs  
14. **Proposed smallest safe action:** document skip honesty  
15. **Required evidence type:** match acceptance criteria in task prompt  
16. **Rollback:** revert focused files; restore icons from checksums if needed  
17. **Proposed status after work:** Needs Verification  

## BETA-018

1. **Canonical description:** see `docs/BETA_READINESS.md`  
2. **Tracker status:** Not Started  
3. **Observed implementation state:** Missing  
4. **Implementation files:** —  
5. **Entrypoints:** see implementation files / workbench contributions  
6. **Tests/scripts:** see `reports/beta-evidence/2026-08-02T041900Z-9fde0994-darwin-arm64/commands.json`  
7. **Existing evidence:** none for this HEAD  
8. **Evidence still valid for HEAD?** Partial — dirty tree; local static/unit only where listed  
9. **Missing implementation:** (see observed state)  
10. **Missing validation:** a11y matrix  
11. **Dependencies:** BETA-004  
12. **Risk:** medium for graph/privacy/cloud; icons frozen  
13. **Required research:** subsystem-specific official docs  
14. **Proposed smallest safe action:** execute a11y checklist  
15. **Required evidence type:** match acceptance criteria in task prompt  
16. **Rollback:** revert focused files; restore icons from checksums if needed  
17. **Proposed status after work:** Not Started  

## BETA-019

1. **Canonical description:** see `docs/BETA_READINESS.md`  
2. **Tracker status:** Not Started  
3. **Observed implementation state:** Missing  
4. **Implementation files:** —  
5. **Entrypoints:** see implementation files / workbench contributions  
6. **Tests/scripts:** see `reports/beta-evidence/2026-08-02T041900Z-9fde0994-darwin-arm64/commands.json`  
7. **Existing evidence:** none for this HEAD  
8. **Evidence still valid for HEAD?** Partial — dirty tree; local static/unit only where listed  
9. **Missing implementation:** (see observed state)  
10. **Missing validation:** policy drafts+legal  
11. **Dependencies:** —  
12. **Risk:** medium for graph/privacy/cloud; icons frozen  
13. **Required research:** subsystem-specific official docs  
14. **Proposed smallest safe action:** engineering drafts  
15. **Required evidence type:** match acceptance criteria in task prompt  
16. **Rollback:** revert focused files; restore icons from checksums if needed  
17. **Proposed status after work:** Not Started  

## BETA-020

1. **Canonical description:** see `docs/BETA_READINESS.md`  
2. **Tracker status:** Deferred After Beta  
3. **Observed implementation state:** Safely deferred  
4. **Implementation files:** graph config showMinimap  
5. **Entrypoints:** see implementation files / workbench contributions  
6. **Tests/scripts:** see `reports/beta-evidence/2026-08-02T041900Z-9fde0994-darwin-arm64/commands.json`  
7. **Existing evidence:** hidden setting historically  
8. **Evidence still valid for HEAD?** Partial — dirty tree; local static/unit only where listed  
9. **Missing implementation:** (see observed state)  
10. **Missing validation:** Command Palette screenshot  
11. **Dependencies:** —  
12. **Risk:** medium for graph/privacy/cloud; icons frozen  
13. **Required research:** subsystem-specific official docs  
14. **Proposed smallest safe action:** GUI absence shot  
15. **Required evidence type:** match acceptance criteria in task prompt  
16. **Rollback:** revert focused files; restore icons from checksums if needed  
17. **Proposed status after work:** Deferred After Beta  

## BETA-021

1. **Canonical description:** see `docs/BETA_READINESS.md`  
2. **Tracker status:** Deferred After Beta  
3. **Observed implementation state:** Safely deferred (research 2026-08-02: TS 7.1 API not GA)  
4. **Implementation files:** @typescript/typescript6  
5. **Entrypoints:** see implementation files / workbench contributions  
6. **Tests/scripts:** see `reports/beta-evidence/2026-08-02T041900Z-9fde0994-darwin-arm64/commands.json`  
7. **Existing evidence:** official TS 7.0 announcement  
8. **Evidence still valid for HEAD?** Partial — dirty tree; local static/unit only where listed  
9. **Missing implementation:** (see observed state)  
10. **Missing validation:** 7.1 API GA  
11. **Dependencies:** BETA-007  
12. **Risk:** medium for graph/privacy/cloud; icons frozen  
13. **Required research:** subsystem-specific official docs  
14. **Proposed smallest safe action:** retain dual lane  
15. **Required evidence type:** match acceptance criteria in task prompt  
16. **Rollback:** revert focused files; restore icons from checksums if needed  
17. **Proposed status after work:** Deferred After Beta  

## BETA-022

1. **Canonical description:** see `docs/BETA_READINESS.md`  
2. **Tracker status:** Needs Verification  
3. **Observed implementation state:** Implemented but untested  
4. **Implementation files:** prebaseOnboardingEditor.ts  
5. **Entrypoints:** see implementation files / workbench contributions  
6. **Tests/scripts:** see `reports/beta-evidence/2026-08-02T041900Z-9fde0994-darwin-arm64/commands.json`  
7. **Existing evidence:** none for this HEAD  
8. **Evidence still valid for HEAD?** Partial — dirty tree; local static/unit only where listed  
9. **Missing implementation:** (see observed state)  
10. **Missing validation:** first-run GUI  
11. **Dependencies:** BETA-033  
12. **Risk:** medium for graph/privacy/cloud; icons frozen  
13. **Required research:** subsystem-specific official docs  
14. **Proposed smallest safe action:** fresh profile onboarding  
15. **Required evidence type:** match acceptance criteria in task prompt  
16. **Rollback:** revert focused files; restore icons from checksums if needed  
17. **Proposed status after work:** Needs Verification  

## BETA-023

1. **Canonical description:** see `docs/BETA_READINESS.md`  
2. **Tracker status:** In Progress  
3. **Observed implementation state:** Partially implemented  
4. **Implementation files:** docs/SECURITY_AND_SUPPLY_CHAIN.md  
5. **Entrypoints:** see implementation files / workbench contributions  
6. **Tests/scripts:** see `reports/beta-evidence/2026-08-02T041900Z-9fde0994-darwin-arm64/commands.json`  
7. **Existing evidence:** npm-audit-omit-dev exit=1 findings  
8. **Evidence still valid for HEAD?** Partial — dirty tree; local static/unit only where listed  
9. **Missing implementation:** (see observed state)  
10. **Missing validation:** reachability+remediation  
11. **Dependencies:** —  
12. **Risk:** medium for graph/privacy/cloud; icons frozen  
13. **Required research:** subsystem-specific official docs  
14. **Proposed smallest safe action:** explain shell-quote/tar; no blind fix  
15. **Required evidence type:** match acceptance criteria in task prompt  
16. **Rollback:** revert focused files; restore icons from checksums if needed  
17. **Proposed status after work:** In Progress  

## BETA-024

1. **Canonical description:** see `docs/BETA_READINESS.md`  
2. **Tracker status:** In Progress  
3. **Observed implementation state:** Statically verified only (CPU layout bench)  
4. **Implementation files:** docs/GRAPH_PERFORMANCE.md  
5. **Entrypoints:** see implementation files / workbench contributions  
6. **Tests/scripts:** see `reports/beta-evidence/2026-08-02T041900Z-9fde0994-darwin-arm64/commands.json`  
7. **Existing evidence:** historical layout bench  
8. **Evidence still valid for HEAD?** Partial — dirty tree; local static/unit only where listed  
9. **Missing implementation:** (see observed state)  
10. **Missing validation:** render/morph FPS  
11. **Dependencies:** BETA-004  
12. **Risk:** medium for graph/privacy/cloud; icons frozen  
13. **Required research:** subsystem-specific official docs  
14. **Proposed smallest safe action:** profile renderer  
15. **Required evidence type:** match acceptance criteria in task prompt  
16. **Rollback:** revert focused files; restore icons from checksums if needed  
17. **Proposed status after work:** In Progress  

## BETA-025

1. **Canonical description:** see `docs/BETA_READINESS.md`  
2. **Tracker status:** In Progress  
3. **Observed implementation state:** Partially implemented  
4. **Implementation files:** PACKAGING.md  
5. **Entrypoints:** see implementation files / workbench contributions  
6. **Tests/scripts:** see `reports/beta-evidence/2026-08-02T041900Z-9fde0994-darwin-arm64/commands.json`  
7. **Existing evidence:** none for this HEAD  
8. **Evidence still valid for HEAD?** Partial — dirty tree; local static/unit only where listed  
9. **Missing implementation:** (see observed state)  
10. **Missing validation:** notices inventory  
11. **Dependencies:** BETA-015, BETA-019  
12. **Risk:** medium for graph/privacy/cloud; icons frozen  
13. **Required research:** subsystem-specific official docs  
14. **Proposed smallest safe action:** license inventory  
15. **Required evidence type:** match acceptance criteria in task prompt  
16. **Rollback:** revert focused files; restore icons from checksums if needed  
17. **Proposed status after work:** In Progress  

## BETA-026

1. **Canonical description:** see `docs/BETA_READINESS.md`  
2. **Tracker status:** In Progress  
3. **Observed implementation state:** Partially implemented  
4. **Implementation files:** docs/**, graphs/README.md  
5. **Entrypoints:** see implementation files / workbench contributions  
6. **Tests/scripts:** see `reports/beta-evidence/2026-08-02T041900Z-9fde0994-darwin-arm64/commands.json`  
7. **Existing evidence:** one-graph docs updated  
8. **Evidence still valid for HEAD?** Partial — dirty tree; local static/unit only where listed  
9. **Missing implementation:** (see observed state)  
10. **Missing validation:** full stale-string sweep  
11. **Dependencies:** —  
12. **Risk:** medium for graph/privacy/cloud; icons frozen  
13. **Required research:** subsystem-specific official docs  
14. **Proposed smallest safe action:** doc audit  
15. **Required evidence type:** match acceptance criteria in task prompt  
16. **Rollback:** revert focused files; restore icons from checksums if needed  
17. **Proposed status after work:** In Progress  

## BETA-027

1. **Canonical description:** see `docs/BETA_READINESS.md`  
2. **Tracker status:** In Progress  
3. **Observed implementation state:** Statically verified only  
4. **Implementation files:** .github/workflows/  
5. **Entrypoints:** see implementation files / workbench contributions  
6. **Tests/scripts:** see `reports/beta-evidence/2026-08-02T041900Z-9fde0994-darwin-arm64/commands.json`  
7. **Existing evidence:** workflow exists historically  
8. **Evidence still valid for HEAD?** Partial — dirty tree; local static/unit only where listed  
9. **Missing implementation:** (see observed state)  
10. **Missing validation:** remote run ID this HEAD  
11. **Dependencies:** —  
12. **Risk:** medium for graph/privacy/cloud; icons frozen  
13. **Required research:** subsystem-specific official docs  
14. **Proposed smallest safe action:** push/PR when instructed  
15. **Required evidence type:** match acceptance criteria in task prompt  
16. **Rollback:** revert focused files; restore icons from checksums if needed  
17. **Proposed status after work:** Needs Verification  

## BETA-028

1. **Canonical description:** see `docs/BETA_READINESS.md`  
2. **Tracker status:** Not Started  
3. **Observed implementation state:** Missing  
4. **Implementation files:** —  
5. **Entrypoints:** see implementation files / workbench contributions  
6. **Tests/scripts:** see `reports/beta-evidence/2026-08-02T041900Z-9fde0994-darwin-arm64/commands.json`  
7. **Existing evidence:** none for this HEAD  
8. **Evidence still valid for HEAD?** Partial — dirty tree; local static/unit only where listed  
9. **Missing implementation:** (see observed state)  
10. **Missing validation:** NLS migration  
11. **Dependencies:** —  
12. **Risk:** medium for graph/privacy/cloud; icons frozen  
13. **Required research:** subsystem-specific official docs  
14. **Proposed smallest safe action:** scope English strings  
15. **Required evidence type:** match acceptance criteria in task prompt  
16. **Rollback:** revert focused files; restore icons from checksums if needed  
17. **Proposed status after work:** Not Started  

## BETA-029

1. **Canonical description:** see `docs/BETA_READINESS.md`  
2. **Tracker status:** Needs Verification  
3. **Observed implementation state:** Partially implemented  
4. **Implementation files:** extensions  
5. **Entrypoints:** see implementation files / workbench contributions  
6. **Tests/scripts:** see `reports/beta-evidence/2026-08-02T041900Z-9fde0994-darwin-arm64/commands.json`  
7. **Existing evidence:** historical spot compiles  
8. **Evidence still valid for HEAD?** Partial — dirty tree; local static/unit only where listed  
9. **Missing implementation:** (see observed state)  
10. **Missing validation:** full matrix  
11. **Dependencies:** BETA-008  
12. **Risk:** medium for graph/privacy/cloud; icons frozen  
13. **Required research:** subsystem-specific official docs  
14. **Proposed smallest safe action:** compile-extensions  
15. **Required evidence type:** match acceptance criteria in task prompt  
16. **Rollback:** revert focused files; restore icons from checksums if needed  
17. **Proposed status after work:** Needs Verification  

## BETA-030

1. **Canonical description:** see `docs/BETA_READINESS.md`  
2. **Tracker status:** Not Started  
3. **Observed implementation state:** Missing  
4. **Implementation files:** —  
5. **Entrypoints:** see implementation files / workbench contributions  
6. **Tests/scripts:** see `reports/beta-evidence/2026-08-02T041900Z-9fde0994-darwin-arm64/commands.json`  
7. **Existing evidence:** none for this HEAD  
8. **Evidence still valid for HEAD?** Partial — dirty tree; local static/unit only where listed  
9. **Missing implementation:** (see observed state)  
10. **Missing validation:** REH/web smoke  
11. **Dependencies:** —  
12. **Risk:** medium for graph/privacy/cloud; icons frozen  
13. **Required research:** subsystem-specific official docs  
14. **Proposed smallest safe action:** web compile smoke  
15. **Required evidence type:** match acceptance criteria in task prompt  
16. **Rollback:** revert focused files; restore icons from checksums if needed  
17. **Proposed status after work:** Not Started  

## BETA-031

1. **Canonical description:** see `docs/BETA_READINESS.md`  
2. **Tracker status:** Deferred After Beta  
3. **Observed implementation state:** Externally blocked / deferred (npm 11 required)  
4. **Implementation files:** preinstall  
5. **Entrypoints:** see implementation files / workbench contributions  
6. **Tests/scripts:** see `reports/beta-evidence/2026-08-02T041900Z-9fde0994-darwin-arm64/commands.json`  
7. **Existing evidence:** npm 11.18.0  
8. **Evidence still valid for HEAD?** Partial — dirty tree; local static/unit only where listed  
9. **Missing implementation:** (see observed state)  
10. **Missing validation:** isolated npm12 trial  
11. **Dependencies:** —  
12. **Risk:** medium for graph/privacy/cloud; icons frozen  
13. **Required research:** subsystem-specific official docs  
14. **Proposed smallest safe action:** retain npm11 for beta  
15. **Required evidence type:** match acceptance criteria in task prompt  
16. **Rollback:** revert focused files; restore icons from checksums if needed  
17. **Proposed status after work:** Deferred After Beta  

## BETA-032

1. **Canonical description:** see `docs/BETA_READINESS.md`  
2. **Tracker status:** Needs Verification  
3. **Observed implementation state:** Statically verified only  
4. **Implementation files:** scripts/startup  
5. **Entrypoints:** see implementation files / workbench contributions  
6. **Tests/scripts:** see `reports/beta-evidence/2026-08-02T041900Z-9fde0994-darwin-arm64/commands.json`  
7. **Existing evidence:** verify-startup static; verify-graphs-out  
8. **Evidence still valid for HEAD?** Partial — dirty tree; local static/unit only where listed  
9. **Missing implementation:** (see observed state)  
10. **Missing validation:** launch with fresh out  
11. **Dependencies:** BETA-010  
12. **Risk:** medium for graph/privacy/cloud; icons frozen  
13. **Required research:** subsystem-specific official docs  
14. **Proposed smallest safe action:** launch smoke  
15. **Required evidence type:** match acceptance criteria in task prompt  
16. **Rollback:** revert focused files; restore icons from checksums if needed  
17. **Proposed status after work:** Needs Verification  

## BETA-033

1. **Canonical description:** see `docs/BETA_READINESS.md`  
2. **Tracker status:** In Progress  
3. **Observed implementation state:** Partially implemented  
4. **Implementation files:** PreBaseAccountService  
5. **Entrypoints:** see implementation files / workbench contributions  
6. **Tests/scripts:** see `reports/beta-evidence/2026-08-02T041900Z-9fde0994-darwin-arm64/commands.json`  
7. **Existing evidence:** none for this HEAD  
8. **Evidence still valid for HEAD?** Partial — dirty tree; local static/unit only where listed  
9. **Missing implementation:** (see observed state)  
10. **Missing validation:** Auth lifecycle GUI  
11. **Dependencies:** BETA-034, BETA-014  
12. **Risk:** medium for graph/privacy/cloud; icons frozen  
13. **Required research:** subsystem-specific official docs  
14. **Proposed smallest safe action:** test accounts  
15. **Required evidence type:** match acceptance criteria in task prompt  
16. **Rollback:** revert focused files; restore icons from checksums if needed  
17. **Proposed status after work:** In Progress  

## BETA-034

1. **Canonical description:** see `docs/BETA_READINESS.md`  
2. **Tracker status:** In Progress  
3. **Observed implementation state:** Statically verified only  
4. **Implementation files:** supabase migrations  
5. **Entrypoints:** see implementation files / workbench contributions  
6. **Tests/scripts:** see `reports/beta-evidence/2026-08-02T041900Z-9fde0994-darwin-arm64/commands.json`  
7. **Existing evidence:** verify-supabase-migrations, verify-supabase-rls-static  
8. **Evidence still valid for HEAD?** Partial — dirty tree; local static/unit only where listed  
9. **Missing implementation:** (see observed state)  
10. **Missing validation:** User A/B/anonymous adversarial  
11. **Dependencies:** BETA-033  
12. **Risk:** medium for graph/privacy/cloud; icons frozen  
13. **Required research:** subsystem-specific official docs  
14. **Proposed smallest safe action:** runtime RLS harness  
15. **Required evidence type:** match acceptance criteria in task prompt  
16. **Rollback:** revert focused files; restore icons from checksums if needed  
17. **Proposed status after work:** In Progress  

## BETA-035

1. **Canonical description:** see `docs/BETA_READINESS.md`  
2. **Tracker status:** Deferred After Beta  
3. **Observed implementation state:** Safely deferred  
4. **Implementation files:** HOSTED_MAGNUS.md  
5. **Entrypoints:** see implementation files / workbench contributions  
6. **Tests/scripts:** see `reports/beta-evidence/2026-08-02T041900Z-9fde0994-darwin-arm64/commands.json`  
7. **Existing evidence:** disabled docs  
8. **Evidence still valid for HEAD?** Partial — dirty tree; local static/unit only where listed  
9. **Missing implementation:** (see observed state)  
10. **Missing validation:** UI absence screenshot  
11. **Dependencies:** —  
12. **Risk:** medium for graph/privacy/cloud; icons frozen  
13. **Required research:** subsystem-specific official docs  
14. **Proposed smallest safe action:** confirm no picker  
15. **Required evidence type:** match acceptance criteria in task prompt  
16. **Rollback:** revert focused files; restore icons from checksums if needed  
17. **Proposed status after work:** Deferred After Beta  

## BETA-036

1. **Canonical description:** see `docs/BETA_READINESS.md`  
2. **Tracker status:** Deferred After Beta  
3. **Observed implementation state:** Safely deferred  
4. **Implementation files:** agent_events schema  
5. **Entrypoints:** see implementation files / workbench contributions  
6. **Tests/scripts:** see `reports/beta-evidence/2026-08-02T041900Z-9fde0994-darwin-arm64/commands.json`  
7. **Existing evidence:** none for this HEAD  
8. **Evidence still valid for HEAD?** Partial — dirty tree; local static/unit only where listed  
9. **Missing implementation:** (see observed state)  
10. **Missing validation:** no silent sync proof via privacy capture  
11. **Dependencies:** BETA-014  
12. **Risk:** medium for graph/privacy/cloud; icons frozen  
13. **Required research:** subsystem-specific official docs  
14. **Proposed smallest safe action:** privacy scenario  
15. **Required evidence type:** match acceptance criteria in task prompt  
16. **Rollback:** revert focused files; restore icons from checksums if needed  
17. **Proposed status after work:** Deferred After Beta  

## BETA-037

1. **Canonical description:** see `docs/BETA_READINESS.md`  
2. **Tracker status:** In Progress  
3. **Observed implementation state:** Locally verified (unit/static); GUI restore+morph missing  
4. **Implementation files:** docs/MAIN_ONE_GRAPH_MIGRATION.md, graphs one-graph host  
5. **Entrypoints:** see implementation files / workbench contributions  
6. **Tests/scripts:** see `reports/beta-evidence/2026-08-02T041900Z-9fde0994-darwin-arm64/commands.json`  
7. **Existing evidence:** assurance-quick-v4, test:graphs  
8. **Evidence still valid for HEAD?** Partial — dirty tree; local static/unit only where listed  
9. **Missing implementation:** (see observed state)  
10. **Missing validation:** legacy tab restore GUI, morph GUI  
11. **Dependencies:** BETA-004, BETA-001  
12. **Risk:** medium for graph/privacy/cloud; icons frozen  
13. **Required research:** subsystem-specific official docs  
14. **Proposed smallest safe action:** GUI acceptance  
15. **Required evidence type:** match acceptance criteria in task prompt  
16. **Rollback:** revert focused files; restore icons from checksums if needed  
17. **Proposed status after work:** In Progress  

