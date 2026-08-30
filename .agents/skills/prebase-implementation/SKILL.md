---
name: prebase-implementation
description: PreBase implementation workflow — inspect, minimal fix, focused test, reviewer, Ponytail, validation plan.
---

# PreBase implementation

1. Read relevant source; trace the real flow.
2. Implement the smallest safe diff.
3. Run focused tests for touched paths.
4. One test-writer pass when behavior changed materially.
5. One code-reviewer-editor pass; fix valid issues.
6. Ponytail pass — remove duplication and dead code.
7. Freeze code; `node test/prebase/acceptance/prebase-phase3-final-gate.mjs --plan`.
8. Execute plan once (`--execute-plan <runId>`); resume with `--resume-plan <runId>` if interrupted.

Do not run full `--rerun-stale` before implementing. Do not stage/commit unless asked.
