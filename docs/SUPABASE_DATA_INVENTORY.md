# Supabase data inventory (PreBase)

Short guide for what PreBase stores where. This is **not** a privacy policy; see release/legal backlog for formal notices.

## Legend

| Label | Meaning |
| --- | --- |
| **Local-only** | Stays on device; never sent to Supabase |
| **Cloud (account)** | Stored in Supabase when you sign in |
| **Opt-in sync** | Sent only if you enable cloud agent/history sync |
| **Never** | PreBase does not collect or store this in Supabase |

## Inventory

| Data | Classification | Notes |
| --- | --- | --- |
| Source code & workspace files | **Local-only** | Normal IDE workspace; not uploaded by these migrations |
| Magnus/API keys (Gemini, OpenAI, etc.) | **Local-only** | `.env` on device; not in Supabase schema |
| Sign-in identity (email/OAuth subject) | **Cloud (account)** | Held by Supabase Auth when you use cloud sign-in |
| Display name & avatar URL | **Cloud (account)** | `profiles` table |
| UI/settings JSON | **Cloud (account)** | `user_preferences` |
| Agent session titles & defaults | **Opt-in sync** | `agent_sessions` when sync enabled |
| Agent run metadata (task, model, status) | **Opt-in sync** | `agent_runs` |
| Agent event stream (tool/output chunks) | **Opt-in sync** | `agent_events` — can include prompts/responses if synced |
| Usage / billing units | **Cloud (account)** | `agent_usage` — written server-side; you can read your rows |
| Payment card or bank data | **Never** | Not in this schema |
| Service role or provider secrets | **Never** | Not in client; not in git |

## Your choices

- **Bring-your-own keys (default):** Models run with keys you configure locally; no agent payload sync required.
- **Cloud sign-in only:** Profile/preferences may sync without full agent history if product toggles allow.
- **Full opt-in sync:** Session/run/event rows replicate to Supabase for backup/multi-device (product-controlled).

## Deletion

Signing out clears local session tokens. Deleting your cloud account (when offered) should remove Auth user and cascade application rows. Contact support channel (TBD) for hosted dev project data requests during beta.

See [SUPABASE_ARCHITECTURE.md](./SUPABASE_ARCHITECTURE.md) for technical detail.
