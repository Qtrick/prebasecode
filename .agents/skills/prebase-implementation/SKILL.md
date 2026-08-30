---
name: prebase-implementation
description: PreBase implementation — inspect, minimal fix, targeted test, reviewer, Ponytail, validation.
---

# PreBase implementation

1. Read relevant source; trace the real flow.
2. Smallest safe diff (Ponytail: delete before adding).
3. **Tier A** targeted tests for touched paths.
4. One **test-writer** pass when behavior changed materially.
5. One **code-reviewer-editor** pass; fix valid findings.
6. Ponytail pass — dedupe, remove dead code.
7. **Tier B commit-ready** gate (minutes, not Phase 3 matrix).
8. **Code freeze** — no production edits during long evidence.
9. `node test/prebase/acceptance/prebase-phase3-final-gate.mjs --plan` once (reuse if same plan key).
10. `--execute-plan` / `--resume-plan` for stale producers only.

Do not run full `--rerun-stale` before implementing. Do not stage/commit unless asked.

Magnus Project Guidance: skills are metadata until `prebase_project_guidance` activation in real chat.
