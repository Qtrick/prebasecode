# PreBase assurance

Repeatable static checks for graph boundary, toolchain lanes, icons, privacy, and graph unit tests. These scripts do **not** replace full VS Code CI (`core-ci`, hygiene, electron tests) or manual product smoke.

## npm scripts

| Script | Purpose |
|--------|---------|
| `npm run assurance` | Alias for `assurance:quick` |
| `npm run assurance:quick` | Boundary + TS lanes + icon manifest + `typecheck:graphs` + `typecheck-client` + `test:graphs` |
| `npm run assurance:graphs` | Boundary + graph typecheck + graph unit tests |
| `npm run assurance:static` | `assurance:quick` + configuration/command uniqueness |
| `npm run assurance:privacy` | Static privacy audit (`verify:privacy`) |
| `npm run assurance:full` | `assurance:static` + `assurance:privacy`; **skips** root `eslint` (run manually before release) |
| `npm run assurance:package` | Icon manifest + signing preflight (informational) + gulp packaging task smoke — see [PACKAGING.md](PACKAGING.md) |
| `npm run release:signing-preflight` | Enforces `PREBASE_*` signing env **names** for this OS (`--release`); does not sign |

Individual verifiers:

- `verify:graphs-boundary` — graph ownership under `graphs/`
- `verify:typescript` — TS7 primary + TS6 compat lane versions
- `verify:icons` — SHA-256 manifest at `build/icons/icon-integrity.sha256` (read-only; does not rewrite icons)
- `verify:privacy` — product telemetry flags, forbidden endpoints, secret-storage patterns, webview CSP
- `verify:config-uniqueness` — duplicate `prebase.*` command IDs and configuration enum keys

## Icon integrity

Protected platform and PreBase icon bytes are listed in [`build/icons/icon-integrity.sha256`](../build/icons/icon-integrity.sha256). The verifier hashes on-disk files and fails on missing paths or drift.

**Policy:** Do not change application/Dock/installer icon bytes or product icon selection fields without explicit product approval. Update the manifest only when deliberately approving new icon bytes (separate change from the icons themselves).

## Privacy (static)

`scripts/privacy/audit.mjs` checks:

- `product.json` → `enableTelemetry: false`
- No active forbidden telemetry/crash/survey keys or URL patterns in `product.json`
- Account tokens via `ISecretStorageService` (`prebaseAccountService.ts`)
- Agents model key via VS Code `SecretStorage` (`extensions/prebase-magnus/src/secretStorage.ts`)
- Strict CSP meta tags in graph and runtime webview HTML builders

### Runtime network observation

**Needs Verification** without a GUI launch:

1. Start PreBase from sources with network logging (proxy or OS firewall log).
2. Open workspace, graph editors, runtime preview, and Agents; perform typical actions.
3. Confirm no unexpected calls to Microsoft telemetry / crash / NPS endpoints.
4. Expected third-party traffic may include Open VSX, user-configured model provider APIs, and user-initiated URLs in runtime preview.

Record findings in [BETA_READINESS.md](BETA_READINESS.md) under BETA-014.

## CI

Pull requests run the **PreBase assurance (fast)** job in [`.github/workflows/pr.yml`](../.github/workflows/pr.yml) (`npm run assurance:quick` + `assurance:privacy`) on `ubuntu-latest` after `npm ci` (Electron download skipped).

Full upstream compile/hygiene remains in the existing **Compile & Hygiene** job.

## Acceptance templates (manual GUI)

- [GRAPH_ACCEPTANCE.md](GRAPH_ACCEPTANCE.md) — Architecture + Network (BETA-003/004)
- [CORE_IDE_ACCEPTANCE.md](CORE_IDE_ACCEPTANCE.md) — startup, editor, PreBase shell (BETA-010–013, 022)
- [GRAPH_PERFORMANCE.md](GRAPH_PERFORMANCE.md) — layout CPU micro-benchmarks (BETA-024); not FPS claims

## Related backlog

- [BETA_READINESS.md](BETA_READINESS.md) — BETA-014 (privacy), BETA-015/016 (packaging/icons), BETA-017/027 (assurance + CI)
- [PACKAGING.md](PACKAGING.md), [RELEASE_SIGNING.md](RELEASE_SIGNING.md) — Phase J packaging/signing prep
