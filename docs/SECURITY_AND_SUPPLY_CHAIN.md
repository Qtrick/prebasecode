# Security and supply chain (beta)

Last updated: **2026-07-22** (dependency audit remediation + `allowScripts` allowlist; **not** a claim of full production security certification)

## Scope

PreBase desktop beta: dependency audit posture, secret hygiene, and accepted risks. This is **not** a claim of full production security certification.

## Commands

| Check | Command | Status |
|---|---|---|
| Static privacy | `npm run verify:privacy` | Static PASS; runtime observation open (BETA-014) |
| No secrets in source | `npm run verify:supabase-secrets` | PASS (static) |
| Icon integrity | `npm run verify:icons` | PASS (manifest frozen; 101/101) |
| PreBase eslint ratchet | `npm run verify:eslint-prebase` | PASS vs baseline (PreBase paths only; existing debt allowed) |
| Release assurance | `npm run assurance:release` | Static + privacy + PreBase eslint ratchet — **not** full-repo eslint |
| npm audit | `npm audit` / `npm audit --omit=dev` | **0 vulnerabilities** (root) after 2026-07-22 remediation |
| Install-script allowlist | `npm install-scripts ls` | No unreviewed scripts (root + key nested trees) |

## npm audit remediation — 2026-07-22

Previously recorded findings (`shell-quote` high, `tar` critical) and additional transitive advisories were **remediated** (not accepted):

| Package | Action |
|---|---|
| `tar` | Direct/`overrides` → `^7.5.21` (root, remote, `build/npm/gyp`) |
| `shell-quote` | `overrides` → `^1.10.0` (root + nested) |
| `svgo` / `gulp-svgmin` | Removed `gulp-svgmin`; local `build/lib/gulp/svgmin.ts` uses `svgo@^4`; root `overrides` `svgo` |
| `body-parser`, `fast-uri`, `hono`, `@hono/node-server` | Root + nested `overrides` to patched ranges |
| `js-yaml`, `linkify-it`, `brace-expansion`, `dompurify`, `tmp`, `diff`, `ip-address` | Overrides and/or direct bumps in affected trees |

**Verification (2026-07-22):**

- Root: `npm audit` → `found 0 vulnerabilities`; `npm audit --omit=dev` → `found 0 vulnerabilities`
- Nested trees patched to `0` (including `remote/`, `build/`, `test/{smoke,mcp,monaco,sanity,automation,integration/browser}`, language-feature extensions, `build/agent-sdk/agents/claude`, `extensions/copilot/chat-lib` with `--ignore-scripts` due to disabled Copilot postinstall)
- Icons: `verify:icons` 101/101; platform icon SHA-256 unchanged

**Note:** `@hono/node-server` is overridden to `^2.0.11` under MCP SDK consumers; smoke that MCP host tooling still loads if you use `test/mcp`.

## `allowScripts` (npm install-script allowlist)

Root `package.json` now includes an explicit `allowScripts` allowlist for required native / postinstall packages (`@vscode/*`, `node-pty`, `kerberos`, `ssh2`, `fsevents`, etc.). Nested trees (`remote/`, `build/`, `test/sanity`, `test/automation`, …) have matching approvals where install warned.

This is **prep for BETA-031** (npm 12). `build/npm/preinstall.ts` still rejects npm ≥12 until a full npm 12 install + native rebuild is validated.

## Session secrets

- Access/refresh tokens: `PreBaseCloudSessionAdapter` → `ISecretStorageService` only
- Magnus provider keys: extension `SecretStorage`
- Never in Settings JSON, localStorage, or profile sync payloads
- Enforced statically by `verify:privacy` (adapter + cloud service; fail token-in-`IStorageService`)

## Hosted Agents

**Disabled** — see [HOSTED_MAGNUS.md](HOSTED_MAGNUS.md). Gateway remains fail-closed (`501`). No client hosted picker that claims hosted works. BETA-035 is deferred for public beta until the re-enable checklist passes.

## Dependency policy

- Do not upgrade Node/npm/Electron/TypeScript without version research ([TECHNOLOGY_VERSIONS.md](TECHNOLOGY_VERSIONS.md)).
- npm 12 still blocked by preinstall until BETA-031 validation (allowlist now present).
- Prefer `overrides` / direct bumps over blind `npm audit fix --force`.

## Accepted temporary risks

| Risk | Mitigation |
|---|---|
| Full root eslint ~80k upstream warnings | `assurance:release` uses PreBase-path ratchet (`verify:eslint-prebase`); does **not** claim full eslint clean |
| PreBase-path eslint debt (baseline errors/warnings > 0) | Ratchet prevents increases; pay down separately |
| Runtime network observation | Manual GUI checklist in [ASSURANCE.md](ASSURANCE.md#runtime-network-observation) |
| Signing credentials absent | Unsigned artifacts only; [RELEASE_SIGNING.md](RELEASE_SIGNING.md) |
| Disabled Copilot `chat-lib` postinstall | Install with `--ignore-scripts` for audit remediation only; Copilot remains disabled/out of product path |
| `.tmp/` reference trees | Ignored for product audit; not shipped |

## Remediation backlog

1. ~~Classify reachability for recorded `shell-quote` / `tar` findings~~ — **remediated 2026-07-22** (see above).
2. Complete privacy runtime observation (BETA-014).
3. RLS adversarial two-user tests (BETA-034).
4. Hosted gateway before any public hosted Agents (BETA-035) — keep disabled until then.
5. Validate npm 12 with committed `allowScripts` and lift preinstall guard (BETA-031).
6. Copilot subtree hygiene: root `compile-copilot` / `watch-copilot` / `copilot:*` scripts removed; `extensions/copilot` still has thousands of tracked files and **no** `package.json` (`package.json.disabled` only) — document-only; do **not** mass-delete without an explicit safe audit.
