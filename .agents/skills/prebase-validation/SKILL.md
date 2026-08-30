---
name: prebase-validation
description: Phase 3 validation plan, producer fingerprints, resume checkpoints, quiet gate output.
---

# PreBase Phase 3 validation

- Global `productFingerprint` = audit identity for the whole worktree.
- Per-producer `producerFingerprint` = freshness for that expensive producer only.
- `node test/prebase/acceptance/prebase-phase3-final-gate.mjs --plan` — zero live work; writes `validation-plan.json`.
- `node test/prebase/acceptance/prebase-phase3-final-gate.mjs --execute-plan <runId>` — immutable plan; stops on first failure; checkpoints after each producer.
- `node test/prebase/acceptance/prebase-phase3-final-gate.mjs --resume-plan <runId>` — same as execute; skips COMPLETE producers.
- Default gate output is quiet (log file only); use `--verbose` for full child stdout.
- Active soak is last. No automatic gate-level retries.
