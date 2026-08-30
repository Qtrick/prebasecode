---
name: prebase-validation
description: Phase 3 validation — content fingerprints, one reusable plan, resume checkpoints.
---

# PreBase validation tiers

**Tier A — implementation loop:** affected unit tests / typecheck / boundary verifiers only (seconds–minutes).

**Tier B — commit-ready:** touched suites + one UI smoke if needed (minutes). User can review/commit without Phase 3 matrix.

**Tier C — Phase 3 evidence:** after code freeze only.

## Fingerprints

- `productFingerprint` / `producerFingerprint` = **freshness** (behavioral inputs).
- `sourceHead` on evidence = **provenance** only; manual commit of identical bytes must not invalidate green evidence.

## Phase 3 gate

- `node test/prebase/acceptance/prebase-phase3-final-gate.mjs --plan` — idempotent; reuses active plan for same plan key.
- `--new-plan` — force a new run id when genuinely needed.
- `--execute-plan <runId>` / `--resume-plan <runId>` — sequential producers; fail-fast; checkpoint per producer.
- Transient checkpoints live under `.build/prebase-validation/` (not timestamp spam in `reports/`).
- Environment skips (e.g. hybrid Firecrawl) re-probe boolean prerequisites at plan time; never embed secrets in fingerprints.
- No blind retries. Active soak last. Long output stays in gate logs.

Workflow: implement → targeted test → test-writer → reviewer → Ponytail → commit-ready (Tier B) → **freeze** → one plan → execute/resume affected producers only.
