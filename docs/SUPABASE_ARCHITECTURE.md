# PreBase cloud backend (Supabase)

Canonical design for PreBase’s optional cloud sync, auth-backed profile storage, and the future agent gateway. **No secret values belong in this repository.**

## Project reference

| Field | Value |
| --- | --- |
| Hosted project ref | `mvfopbkhftgmcwdpqrww` |
| Hosted API URL | `https://mvfopbkhftgmcwdpqrww.supabase.co` |
| Environment classification | **Development** (treat all hosted data as non-production) |

Local development uses the Supabase CLI (`supabase/config.toml` pins the same `project_id` for linking). Production/staging refs may be added later via `[remotes.*]` blocks without changing client table names.

## Repository layout

```
supabase/
  config.toml          # CLI config (no secrets)
  migrations/          # Ordered SQL migrations (source of truth)
  seed.sql             # Empty by default
  functions/
    agent-gateway/     # Deno edge skeleton (intentionally 501)
    web-search/        # Authenticated hybrid LinkUp+Firecrawl gateway (provider secrets server-only)
scripts/supabase/
  verify-migrations.mjs
  gen-types.mjs
```

## Schema overview

All application tables live in `public` with **RLS enabled**.

| Table | Purpose |
| --- | --- |
| `profiles` | Per-user display name / avatar (`id` = `auth.users.id`) |
| `user_preferences` | JSON preferences blob + `schema_version` |
| `agent_sessions` | Cloud-backed agent chat sessions (opt-in sync) |
| `agent_runs` | Runs within a session (status constrained) |
| `agent_events` | Ordered event stream for opt-in sync |
| `agent_usage` | Usage ledger rows (server-written only) |
| `web_search_usage` | Metadata-only per-user search quota ledger (server-written only) |

Shared trigger helper: `private.set_updated_at()` with `SECURITY DEFINER` and fixed `search_path`.

**Profile creation:** There is **no** `handle_new_user` trigger in migrations (avoids risky `SECURITY DEFINER` on `auth`). The desktop client should **upsert** `profiles` after first sign-in using the user’s JWT (RLS enforces `id = auth.uid()`).

**Devices table:** Omitted in Phase D/E to keep the surface lean; add later if multi-device revocation is required.

## Auth

- End users authenticate via Supabase Auth (OAuth/email TBD in product).
- The IDE holds the **publishable** key and user session JWT only.
- **Never** embed service role, database password, or provider API keys in the desktop bundle.

## Row Level Security (RLS)

- Policies target the `authenticated` role only.
- Ownership checks use `(select auth.uid()) = user_id` (or `id` for `profiles`).
- `INSERT`/`UPDATE` policies include `WITH CHECK` so users cannot forge another user’s `user_id`.
- `agent_runs` and `agent_events` policies also require the parent `agent_sessions` row to belong to the caller.
- `agent_usage`: **SELECT own rows only**; no `INSERT`/`UPDATE`/`DELETE` policies for `authenticated` (writes via service role in Edge Functions / backend jobs).

## Edge Functions

`agent-gateway` (skeleton):

- Rejects missing/invalid `Authorization: Bearer` JWT.
- Validates JSON body size and a small hardcoded model allowlist.
- Probes `agent_usage` with service credentials (fail closed if unavailable).
- Returns **501** with structured JSON when auth checks pass but provider routing is not implemented.
- `GET` health-style response includes `request_id`; never logs bearer tokens.

CORS allowlist is tuned for local/desktop origins (`127.0.0.1`, `localhost`, `null`).

`web-search` is separate from `agent-gateway`: it verifies a user JWT, validates bounded vendor-neutral search or fetch input, atomically reserves `web_search_usage` quota metadata, calls LinkUp for discovery and Firecrawl for page enrichment with secrets held only by Edge, and returns bounded sources with original URLs. It does not persist or log queries/results. See [WEB_SEARCH_ARCHITECTURE.md](WEB_SEARCH_ARCHITECTURE.md).

Function secrets (`SUPABASE_SERVICE_ROLE_KEY`, provider keys) are set with `supabase secrets set` or the Dashboard — not committed.

## Secrets model

| Secret | Where it lives |
| --- | --- |
| Publishable key | `.env` / OS secret storage / user settings (client-safe) |
| Service role | Supabase Dashboard / CLI secrets only |
| LLM provider keys | Edge Function secrets or external vault — **not** in repo |
| DB password | Supabase-managed; CLI `supabase link` prompt |

See `supabase/.env.example` and root `.env.example` (Supabase section).

## Local vs hosted

| Mode | Use |
| --- | --- |
| **Local BYO** | `supabase start` + `supabase db reset` replays migrations + seed |
| **Hosted dev** | `supabase link --project-ref mvfopbkhftgmcwdpqrww` then `supabase db push` (parent/agent applies) |

Migrations in git are the contract; remote drift should be resolved via new migrations, not dashboard edits.

## Client initialization

The workbench uses **delayed** cloud init (`IPreBaseCloudService` + `PreBaseAccountService`):

1. **No network at module import** and no Supabase calls before the workbench shell mounts; `restoreSession()` runs asynchronously and must not throw.
2. **Unconfigured by default** — missing `prebase.cloud.url` / `prebase.cloud.publishableKey` keeps account menus in “Continue without signing in” mode.
3. Load URL + public client publishable key from **user settings** (`prebase.cloud.*`) or optional `product.json` fields (`prebaseCloudUrl`, `prebaseCloudPublishableKey`). Publishable/legacy anon keys are client-safe; secret and service-role keys must never enter the product.
4. Session **access/refresh tokens only** in `ISecretStorageService` via `secretStorageSessionAdapter.ts` + `PreBaseCloudService` (`prebase.account.accessToken` / `prebase.account.refreshToken`). Profile display fields may use `IStorageService`; tokens must not.
5. Attach the user JWT per REST request; refresh via GoTrue `grant_type=refresh_token` when `/user` returns 401.

### REST adapter (no supabase-js in workbench)

Phase F intentionally avoids bundling `@supabase/supabase-js`. Auth and PostgREST are thin HTTP APIs implemented with existing `IRequestService` in `browser/cloud/prebaseSupabaseAuthClient.ts` (signup, password grant, user, refresh, logout) plus small repositories for `profiles` / `user_preferences`. This keeps the Electron workbench bundle smaller and matches the “no SDK at import time” rule.

Types: `src/vs/workbench/contrib/prebase/common/cloud/generated/database.types.ts` — run `npm run supabase:types` after schema changes (requires CLI + local stack).

## Data inventory

See [SUPABASE_DATA_INVENTORY.md](./SUPABASE_DATA_INVENTORY.md) for user-facing classification (local-only vs cloud vs opt-in).

## Export and deletion

| Data | Export | Deletion |
| --- | --- | --- |
| Profile / preferences | Client-driven JSON export (future) + SQL/Admin API | Delete user in Auth cascades `profiles`, preferences, sessions |
| Agent sync data | Opt-in export pipeline (future) | User delete or per-session delete via client |
| Usage ledger | User SELECT via RLS; admin export via service role | Retention policy TBD; void via `status` |

Account deletion should go through Supabase Auth user deletion so FK `ON DELETE CASCADE` clears app tables.

## Limitations (Phase D/E)

- Agent gateway does not call LLM providers yet.
- No realtime channel wiring for events.
- No backup/restore automation in CI.
- Hosted project not modified by this task until migrations are reviewed and pushed deliberately.

## Verification

```bash
npm run verify:supabase-migrations   # static SQL/RLS checks (no CLI)
npm run verify:supabase-secrets      # scan src for committed service keys
npm run test:supabase-rls-runtime    # explicit two-user non-production probe; skips without credentials
npm run supabase:types               # optional; skips if CLI missing
```

Full local apply: `supabase db reset` (Docker required).
