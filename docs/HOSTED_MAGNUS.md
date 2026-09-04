# Hosted Magnus (PreBase Hosted provider) — beta gate

**Status: DISABLED for public beta** (reconfirmed 2026-09-04).
**Do not mark [BETA-035](BETA_READINESS.md) Complete** until the re-enable checklist has dated evidence.

## Why

`supabase/functions/agent-gateway/index.ts` is explicitly gated behind `PREBASE_HOSTED_MAGNUS_ENABLED=true` (defaults to **false / off**). When disabled, it returns **`501 not_implemented`** immediately on generation and model discovery, preventing any unauthorized provider spend or quota bypass. In the client, the "PreBase Hosted" execution mode is hidden from normal users unless the feature gate is enabled.

## Confirmed this pass (2026-09-04)

| Check | Result |
|---|---|
| Gateway when disabled | Returns `501` + `error: "not_implemented"` (no provider call, no quota deduction) |
| Gateway `/health` & `/providers` | Reports `enabled: false, configured: false, modelsAvailable: false` |
| Client “PreBase Hosted” mode | Gated behind `PREBASE_HOSTED_MAGNUS_ENABLED=true`; hidden in settings dropdown and mode picker by default |
| Streaming quota settlement | Hardened with `TransformStream`: output units settled only on stream completion, voided on client abort |
| Local Magnus path | Authoritative public beta path (SecretStorage BYOK API keys) |

## Product rules

1. Do **not** expose a user-facing “PreBase Hosted” provider that claims to work during public beta.
2. Local Magnus (Agents) with SecretStorage API keys remains the required beta path.
3. Keep the Edge Function fail-closed (feature gate check precedes all quota reservation and provider calls).
4. Provider models in gateway restricted to current stable releases (`gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-2.5-flash`, `gemini-2.5-pro`); retired 2.0-flash models removed.

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
