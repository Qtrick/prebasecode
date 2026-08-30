---
name: prebase-validation
description: Phase 3 validation — content fingerprints, one reusable plan, resume checkpoints.
---

# PreBase validation tiers

**Tier A — edit loop (seconds–~2 min):** affected unit tests / typecheck / boundary verifiers only. No GUI soaks. No release gate.

**Tier B — commit-ready (prefer ≤5 min for scoped work):** touched suites + directly affected short live smoke(s). Example for Magnus project guidance:

```bash
npm run compile-magnus
npm run test:prebase-magnus
node test/prebase/acceptance/prebase-phase3-final-gate.mjs --plan --tier commit
# then only if plan lists it:
node test/prebase/acceptance/prebase-phase3-final-gate.mjs --execute-plan <runId> --only-producer magnus-guidance-smoke
git diff --check
npm run verify:icons
```

Commit readiness ≠ Phase 3 release matrix. Do **not** block normal commits on active/idle/restart soaks or parser benchmarks unless those systems were modified.

**Tier C — milestone / release:** after code freeze only; explicit user request for phase/release gate.

## Fingerprints

- `productFingerprint` / `producerFingerprint` = **freshness** (behavioral inputs).
- `sourceHead` on evidence = **provenance** only; manual commit of identical bytes must not invalidate green evidence.
- Product producers do **not** fingerprint `validation-orchestration` (gate/domains planner). Planner edits must not stale every soak.
- There is **no** `test/prebase/` → global catch-all. Unknown changed paths print a diagnostic; assign a domain before assuming release soaks.

## Phase 3 gate

- `node test/prebase/acceptance/prebase-phase3-final-gate.mjs --plan` — idempotent; reuses active plan for same plan key.
- `--plan --tier commit` — affected non-release producers only; prints deferred release producers + unknown paths.
- `--only-producer <id>[,id…]` — plan/execute a deliberate narrow set.
- `--new-plan` — force a new run id when genuinely needed.
- `--execute-plan <runId>` / `--resume-plan <runId>` — sequential producers; fail-fast; checkpoint per producer; **never restart COMPLETE producers**.
- Transient checkpoints live under `.build/prebase-validation/` (not timestamp spam in `reports/`).
- Duration estimates prefer recent successful `execution.durationMs` / evidence `durationMs`, else calibrated fallback (lifecycle is ~1–2 min class, not a hard-coded 22 min).
- Estimate ≠ hard timeout.
- Automatic retry limit = **1**, and **only** for classified transient infrastructure failures (port collision, leftover clean tree, known CDP attach race). Deterministic assertion/type/security failures: diagnose and fix; do not rerun blindly.
- Environment skips (e.g. hybrid Firecrawl) re-probe boolean prerequisites at plan time; never embed secrets in fingerprints.
- Long output stays in gate logs; parent conversation gets command/status/duration/counts/log path + bounded tail on failure.
- Resource-sensitive live PreBase tests remain **sequential** (background ≠ parallel).

Workflow: implement → targeted test (Tier A) → test-writer → reviewer → Ponytail → commit-ready (Tier B) → **freeze** → Tier C plan/execute only when explicitly requested.
