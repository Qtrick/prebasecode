# Runtime RLS adversarial checklist (BETA-034)

Static checks (`verify:supabase-rls-static`) are necessary but not sufficient.

## Environment

Use **local Supabase** or a dedicated **dev/test** project. Never run destructive tests against production data.

The harness is deliberately inert unless every credential below is explicitly provided. It never reads a service-role key, creates Auth users, or runs as part of the static/cloud assurance commands.

Required environment variables:

```bash
PREBASE_RLS_TEST_NON_PRODUCTION=acknowledged
PREBASE_RLS_TEST_URL=https://your-dedicated-test-project.supabase.co
PREBASE_RLS_TEST_PUBLISHABLE_KEY=...
PREBASE_RLS_TEST_USER_A_EMAIL=...
PREBASE_RLS_TEST_USER_A_PASSWORD=...
PREBASE_RLS_TEST_USER_B_EMAIL=...
PREBASE_RLS_TEST_USER_B_PASSWORD=...
```

`PREBASE_RLS_TEST_URL` may instead be a local `http://127.0.0.1` / `localhost` endpoint. The acknowledgement and dedicated-user requirement are intentional safeguards against production use. If all values are absent, `npm run test:supabase-rls-runtime` records **SKIP** and exits successfully; a partial or invalid configuration records **FAIL** and exits nonzero.

Optional: `PREBASE_RLS_TEST_ARTIFACT_DIR` selects where the JSON result is written (default `reports/rls-runtime/`). Artifacts contain status/case IDs only—never passwords, access tokens, or response bodies.

The harness authenticates only the two supplied users with the publishable key, creates a marker-owned profile/preferences/session/run/event graph, verifies ownership and cross-user denial, restores/deletes its marker state, and asserts client writes to `agent_usage` and `web_search_usage` fail. It is safe to repeat only with dedicated non-production accounts.

Run it explicitly:

```bash
npm run test:supabase-rls-runtime
```

Required accounts:

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
| Two-user runtime harness | Implemented — `npm run test:supabase-rls-runtime`; awaits dedicated non-production credentials and a recorded PASS artifact |
| CI job | Blocked on secrets for test project |

## Evidence log

| Date | Environment | Result | Notes |
|---|---|---|---|
| 2026-07-21 | — | Not run | Template only |
| 2026-07-22 | — | Not run | Phase D/F docs pass — static verifiers only; **no** adversarial runtime evidence |
| 2026-08-14 | — | Not run | Harness added; no credentials supplied, so no external connection was attempted |

Do not mark BETA-034 Complete until this matrix has a real pass with recorded environment (non-production). Static `assurance:cloud` / `verify:supabase-rls-static` alone is insufficient.
