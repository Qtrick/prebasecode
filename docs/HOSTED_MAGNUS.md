# Hosted Magnus (PreBase Hosted provider) — beta gate

**Status: DISABLED for public beta** (reconfirmed 2026-07-22).  
**Do not mark [BETA-035](BETA_READINESS.md) Complete** until the re-enable checklist has dated evidence.

## Why

`supabase/functions/agent-gateway/index.ts` authenticates (when configured) then returns **`501 not_implemented`**. Quotas, rate limits, provider secret routing, streaming, usage ledger, and client integration are incomplete.

## Confirmed this pass (2026-07-22)

| Check | Result |
|---|---|
| Gateway after auth | Returns `501` + `error: "not_implemented"` (no provider call) |
| Client “PreBase Hosted” picker | **Absent** — no hosted provider entry in `extensions/prebase-magnus` / PreBase contrib / `graphs/` that claims hosted works |
| Local Magnus path | Required beta path (SecretStorage API keys) |

## Product rules

1. Do **not** expose a user-facing “PreBase Hosted” provider that claims to work.
2. Local Magnus (Agents) with SecretStorage API keys remains the required beta path.
3. Keep the Edge Function fail-closed (auth required; no provider call without allowlist + quotas).
4. Do not deploy a public hosted endpoint that spends provider budget without quota enforcement.

## Re-enable checklist

- [ ] Authenticated JWT validation (user, not publishable key)
- [ ] Server-side provider secrets only
- [ ] Model allowlist + reject user-supplied URLs/headers
- [ ] Rate limit + concurrency + daily/monthly quotas (atomic)
- [ ] Usage ledger (user-readable, not user-writable)
- [ ] Streaming + cancellation + timeouts
- [ ] Secret redaction in logs
- [ ] Client picker: Hosted requires sign-in; local unchanged
- [ ] Adversarial tests (parallel bypass, forged user_id)
- [ ] Update [BETA_SCOPE.md](BETA_SCOPE.md) and mark BETA-035 Complete **only** with the evidence above
