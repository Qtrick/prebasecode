# Security and supply chain (beta)

Last updated: **2026-07-22** (Phase D/F partial — docs + PreBase eslint ratchet; **not** a completed supply-chain audit)

## Scope

PreBase desktop beta: dependency audit posture, secret hygiene, and accepted risks. This is **not** a claim of full production security certification. [BETA-023](BETA_READINESS.md) remains **In Progress**.

## Commands

| Check | Command | Status |
|---|---|---|
| Static privacy | `npm run verify:privacy` | Static PASS; runtime observation open (BETA-014) |
| No secrets in source | `npm run verify:supabase-secrets` | PASS (static) |
| Icon integrity | `npm run verify:icons` | PASS (manifest frozen) |
| PreBase eslint ratchet | `npm run verify:eslint-prebase` | PASS vs baseline (PreBase paths only; existing debt allowed) |
| Release assurance | `npm run assurance:release` | Static + privacy + PreBase eslint ratchet — **not** full-repo eslint |
| npm audit | `npm audit --omit=dev` (review; do not auto-fix) | Findings **recorded** 2026-07-22 (below); reachability + remediation still open — **not Complete** |

## npm audit (omit=dev) — 2026-07-22

| Advisory | Package | Severity | Classification | Action |
|---|---|---|---|---|
| GHSA-395f-4hp3-45gv | `shell-quote` ≤1.8.4 | high | Transitive / build tooling — quadratic DoS in `parse()` | Accepted temporary; schedule `npm audit fix` review (do not auto-fix blindly) |
| GHSA-w8wr-v893-vjvp (+ related) | `tar` ≤7.5.18 | critical | Transitive — archive parse/crash issues | Accepted temporary; same review path |

`npm audit --omit=dev` exit recorded as informational (tool may exit 0 with findings). Do not mark BETA-023 Complete until reachability + remediation decision is documented per finding.

## Session secrets

- Access/refresh tokens: `PreBaseCloudSessionAdapter` → `ISecretStorageService` only
- Magnus provider keys: extension `SecretStorage`
- Never in Settings JSON, localStorage, or profile sync payloads
- Enforced statically by `verify:privacy` (adapter + cloud service; fail token-in-`IStorageService`)

## Hosted Agents

**Disabled** — see [HOSTED_MAGNUS.md](HOSTED_MAGNUS.md). Gateway remains fail-closed (`501`). No client hosted picker that claims hosted works. BETA-035 is deferred for public beta until the re-enable checklist passes.

## Dependency policy

- Do not upgrade Node/npm/Electron/TypeScript without version research ([TECHNOLOGY_VERSIONS.md](TECHNOLOGY_VERSIONS.md)).
- npm 12 blocked by preinstall until allowScripts review (BETA-031).
- `allowScripts` / native rebuild must be explicit before npm 12.

## Accepted temporary risks

| Risk | Mitigation |
|---|---|
| Full root eslint ~80k upstream warnings | `assurance:release` uses PreBase-path ratchet (`verify:eslint-prebase`); does **not** claim full eslint clean |
| PreBase-path eslint debt (baseline errors/warnings > 0) | Ratchet prevents increases; pay down separately |
| Runtime network observation | Manual GUI checklist in [ASSURANCE.md](ASSURANCE.md#runtime-network-observation) |
| Signing credentials absent | Unsigned artifacts only; [RELEASE_SIGNING.md](RELEASE_SIGNING.md) |
| npm audit findings accepted temporary | Reachability + remediation decision still required before BETA-023 Complete |

## Remediation backlog

1. Classify reachability for recorded `shell-quote` / `tar` findings and decide remediate vs accept (required for BETA-023 Complete).
2. Complete privacy runtime observation (BETA-014).
3. RLS adversarial two-user tests (BETA-034).
4. Hosted gateway before any public hosted Agents (BETA-035) — keep disabled until then.
5. Copilot subtree hygiene: root `compile-copilot` / `watch-copilot` / `copilot:*` scripts removed; `extensions/copilot` still has thousands of tracked files and **no** `package.json` (`package.json.disabled` only) — document-only; do **not** mass-delete without an explicit safe audit.
