# Security and supply chain (beta)

Last updated: **2026-08-09** (nested-tree audit remediation pass 2 + Electron 42.8.0 + `allowScripts`; BETA-023 still not Complete — packaged/native smoke open)

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
| npm audit | `npm audit` / nested package audits | **0** at root + `build` / `build/npm/gyp` / `build/vite` / `build/rspack` / `remote` (2026-08-09 pass 2); Emmet `image-size` still 1 high (no upstream fix) |
| allowScripts | `npm install-scripts ls` | Committed allowlist in root `package.json` (native `@vscode/*`, `node-pty`, etc.; deny `es5-ext` / `husky` / `ssh2`) |

## npm audit — 2026-08-09 remediation

| Tree | Before | After | Notes |
|---|---|---|---|
| Root | 18 (incl. Electron moderate GHSA-r4w5-6pfg-jxp5) | **0** | `npm audit fix` (no `--force`) + Electron **42.8.0** |
| `extensions/mermaid-markdown-features` | 4 | **0** | `npm audit fix` |
| `test/smoke`, `test/automation`, `test/monaco` | 1–3 | **0** | `npm audit fix` |
| `test/mcp` | 7 → 2 remaining after safe fix | **0** | Override `@hono/node-server@2.0.12` (avoid force-bumping MCP SDK) |
| `test/integration/browser` | 2 → 1 (`tmp`) | **0** | Direct `tmp` **0.2.6 → 0.2.7** |
| Built-in extensions (`markdown-language-features`, `npm`, `notebook-renderers`, language servers, etc.) | Several high/moderate during `npm install` | **0** (except Emmet) | `npm audit fix` per extension (no `--force`) |
| `test/sanity` | 4 | **0** | `npm audit fix` + override `diff@8.0.4` |
| `build/npm/gyp` | 4 (1 moderate, 2 high, 1 critical: `brace-expansion`, `ip-address`/`socks`, `tar`) | **0** | Pass 2: `npm audit fix` (no `--force`) → `brace-expansion@2.1.4`, `ip-address@10.4.0`, `socks@2.8.9`, `tar@7.5.22` |
| `build` | 4 high (`brace-expansion`, `fast-uri`, `js-yaml`, `linkify-it`) | **0** | Pass 2: `npm audit fix` |
| `build/vite` | 2 high (`nanoid`, `postcss`) | **0** | Pass 2: `npm audit fix` |
| `build/rspack` | 1 high (`fast-uri`) | **0** | Pass 2: `npm audit fix` |
| `remote` | 4 (3 high, 1 critical: `ip-address`, `shell-quote`, `tar`, `undici`) | **0** | Pass 2: `npm audit fix` |
| `extensions/emmet` | 1 high (`image-size`) | **1 remaining** | No patched `image-size` release yet (advisory `*`, latest 2.0.2); DoS in ICNS/JXL/HEIF parsers |

Do not mark BETA-023 Complete until Electron download/native rebuild + packaged assurance evidence is attached. Emmet `image-size` stays accepted-temporary until upstream ships a fix.

## Session secrets

- Access/refresh tokens: `PreBaseCloudSessionAdapter` → `ISecretStorageService` only
- Magnus provider keys: extension `SecretStorage`
- Never in Settings JSON, localStorage, or profile sync payloads
- Enforced statically by `verify:privacy` (adapter + cloud service; fail token-in-`IStorageService`)

## Hosted Agents

**Disabled** — see [HOSTED_MAGNUS.md](HOSTED_MAGNUS.md). Gateway remains fail-closed (`501`). No client hosted picker that claims hosted works. BETA-035 is deferred for public beta until the re-enable checklist passes.

## Dependency policy

- Do not upgrade Node/npm/Electron/TypeScript without version research ([TECHNOLOGY_VERSIONS.md](TECHNOLOGY_VERSIONS.md)).
- npm 12 still blocked by preinstall (BETA-031) until native rebuild is retested on npm 12.
- Root `allowScripts` allowlist is committed; approve/deny via `npm install-scripts`.

## Accepted temporary risks

| Risk | Mitigation |
|---|---|
| Full root eslint ~80k upstream warnings | `assurance:release` uses PreBase-path ratchet (`verify:eslint-prebase`); does **not** claim full eslint clean |
| PreBase-path eslint debt (baseline errors/warnings > 0) | Ratchet prevents increases; pay down separately |
| Runtime network observation | Manual GUI checklist in [ASSURANCE.md](ASSURANCE.md#runtime-network-observation) |
| Signing credentials absent | Unsigned artifacts only; [RELEASE_SIGNING.md](RELEASE_SIGNING.md) |
| Electron 42.8.0 vs npm’s suggested 42.8.1 | Stayed on **42.8.0** to match VS Code 1.133 `ms_build_id` + `electron.txt` checksums |

## Remediation backlog

1. Electron 42.8.0: run `npm run electron` / native rebuild + packaged app smoke; decide whether to follow MS build metadata to 42.8.1 later (BETA-023).
2. Complete privacy runtime observation (BETA-014).
3. RLS adversarial two-user tests (BETA-034).
4. Hosted gateway before any public hosted Agents (BETA-035) — keep disabled until then.
5. Copilot subtree hygiene: root `compile-copilot` / `watch-copilot` / `copilot:*` scripts removed; `extensions/copilot` still has thousands of tracked files and **no** `package.json` (`package.json.disabled` only) — document-only; do **not** mass-delete without an explicit safe audit.
6. npm 12 migration after allowScripts native retest (BETA-031).
