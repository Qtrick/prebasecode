# Runtime RLS adversarial checklist (BETA-034)

Static checks (`verify:supabase-rls-static`) are necessary but not sufficient.

## Environment

Use **local Supabase** or a dedicated **dev/test** project. Never run destructive tests against production data.

Required:

- User A (email/password)
- User B (email/password)
- Anonymous client with publishable key only

## Per user-owned table

Tables: `profiles`, `preferences`, `agent_sessions`, `agent_runs`, `agent_events`, `agent_usage` (writes server-only).

| Case | Expect |
|---|---|
| A SELECT own rows | allow |
| B SELECT A rows | deny / empty |
| A INSERT own | allow |
| B INSERT with `user_id=A` | deny |
| A UPDATE own | allow |
| B UPDATE A | deny |
| A DELETE own (where allowed) | allow |
| B DELETE A | deny |
| Anonymous + publishable key | deny all private rows |
| A INSERT `agent_usage` | deny (server/service role only) |

## Automation status

| Item | Status |
|---|---|
| Static migration + RLS shape | PASS (`verify:supabase-migrations`, `verify:supabase-rls-static`) |
| Two-user runtime harness | Not Started — add under `scripts/supabase/rls-runtime/` when test project credentials available |
| CI job | Blocked on secrets for test project |

## Evidence log

| Date | Environment | Result | Notes |
|---|---|---|---|
| 2026-07-21 | — | Not run | Template only |
| 2026-07-22 | — | Not run | Phase D/F docs pass — static verifiers only; **no** adversarial runtime evidence |

Do not mark BETA-034 Complete until this matrix has a real pass with recorded environment (non-production). Static `assurance:cloud` / `verify:supabase-rls-static` alone is insufficient.
