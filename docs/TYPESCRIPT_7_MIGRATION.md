# TypeScript 7 Migration Plan

Research date: **2026-07-20**

## Target

| Field | Value |
|---|---|
| **Status** | **Installed** (2026-07-20) — dual lanes verified via `npm run verify:typescript` |
| Primary CLI (`@typescript/native`) | `npm:typescript@^7.0.2` → **7.0.2** (`tsc --version`) |
| Compat API (`typescript`) | `npm:@typescript/typescript6@^6.0.2` → **6.0.2** (import API **6.0.3**; `tsc6`) |
| Former native preview | `@typescript/native-preview` / `tsgo` **removed** from root dependencies |
| Official guidance | Side-by-side TS6 API + TS7 `tsc` until 7.1 ships a new API |

## Official sources

1. [Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/) — GA native Go compiler; no stable programmatic API; `@typescript/typescript6` + npm aliases.
2. [Announcing TypeScript 7.0 RC](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-rc/)
3. [Announcing TypeScript 7.0 Beta](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-beta/)
4. [npm `typescript` 7.0.2](https://www.npmjs.com/package/typescript)
5. [npm `@typescript/typescript6` 6.0.2](https://www.npmjs.com/package/@typescript/typescript6)

## Architecture (installed lanes)

### 1. Primary compiler lane (authoritative)

- Package alias: `"@typescript/native": "npm:typescript@^7.0.2"` → **`tsc` Version 7.0.2**.
- Used by: `typecheck-client`, `typecheck:ts7`, `assurance`, `graphs` package `typecheck`, monaco/dts/layers checks, `build/package.json` `typecheck`, gulp `build/lib/typescriptCompiler.ts` (spawns `npx tsc`).
- Scripts: `typecheck:ts7`, `verify:typescript` (`graphs/scripts/verify-typescript-lanes.mjs`).

### 2. Compatibility API lane

- `"typescript": "npm:@typescript/typescript6@^6.0.2"` so `import … from 'typescript'` resolves to TS6 API (`tsc6` binary, API 6.0.3).
- Used by: `build/lib/*` compiler API, typescript-eslint, html language features, any AST tooling.
- Must never silently replace primary typecheck (`tsc` vs `tsc6`).

### 3. Editor language-service lane

- Prefer TypeScript 7 LSP where PreBase/VS Code host supports it.
- Document fallback to TS6 language service if required.
- Built-in TypeScript extension behavior must be audited after install.

## Recommended npm alias layout (from Microsoft)

```json
{
  "devDependencies": {
    "@typescript/native": "npm:typescript@7.0.2",
    "typescript": "npm:@typescript/typescript6@6.0.2"
  }
}
```

Adjust scripts so authoritative typecheck invokes `@typescript/native` / TS7 `tsc`, not `tsc6`.

`@typescript/native-preview` removed; stable **7.0.2** wired (2026-07-20).

## Affected packages / consumers (inventory)

Research method: search root `package.json` scripts, `build/package.json`, `build/**/*.ts`, `extensions/typescript*`, and `from 'typescript'` / `tsserverlibrary` imports (2026-07-20). **Verified** column updated after install checkpoint.

### Root `package.json` — CLI (TS7 `tsc`)

| Script | Invokes | Lane | Verified (2026-07-20) |
|---|---|---|---|
| `typecheck-client` | `tsc` → `src/tsconfig.json` | TS7 | Yes — `assurance` |
| `monaco-compile-check` | `tsc` → `src/tsconfig.monaco.json` | TS7 | Script wired; not in `assurance` |
| `vscode-dts-compile-check` | `tsc` (2 projects) | TS7 | Script wired; not in `assurance` |
| `valid-layers-check` | `layersChecker.ts` (API) + `tsc` (6 checker tsconfigs) | Mixed | Script wired; not re-run this checkpoint |
| `define-class-fields-check` | `propertyInitOrderChecker.ts` (API) + `tsc` | Mixed | Script wired; not re-run this checkpoint |
| `tsec-compile-check` | `tsec` CLI | Audit tsec vs TS7 | Not re-run |
| `update-build-ts-version` | `npm install` compat + `@typescript/native` aliases | Dual lane | Matches installed layout |

### `build/package.json`

| Script | Invokes | Verified |
|---|---|---|
| `typecheck` | `cd .. && npx tsc --project build/tsconfig.json` | Wired to TS7; not in `assurance` |

### Build — gulp TS7 stream (`build/lib/typescriptCompiler.ts`)

| Consumer | Path | Role | Verified |
|---|---|---|---|
| Gulp TS7 stream | `build/lib/typescriptCompiler.ts` | Spawns **`npx tsc`** for extension compile pipelines | Code + `transpile-client` in `assurance` |
| Extension gulpfile | `build/gulpfile.extensions.ts` | `createTypeScriptCompilerStream`, `spawnTypeScriptCompiler` | Not full `compile-extensions` in assurance |

### Build — compiler API (`import … from 'typescript'`)

All require **compat lane** (`@typescript/typescript6`) until TS 7.1 API:

| File |
|---|
| `build/checker/layersChecker.ts` |
| `build/lib/compilation.ts` |
| `build/lib/tsb/index.ts` |
| `build/lib/tsb/builder.ts` |
| `build/lib/tsb/transpiler.ts` |
| `build/lib/treeshaking.ts` |
| `build/lib/nls.ts` |
| `build/lib/nls-analysis.ts` |
| `build/lib/formatter.ts` |
| `build/lib/standalone.ts` |
| `build/lib/monaco-api.ts` |
| `build/lib/tsconfigUtils.ts` |
| `build/lib/typeScriptLanguageServiceHost.ts` |
| `build/lib/checkCyclicDependencies.ts` |
| `build/lib/extractExtensionPoints.ts` |
| `build/lib/propertyInitOrderChecker.ts` |
| `build/lib/mangle/index.ts` |
| `build/lib/mangle/renameWorker.ts` |
| `build/lib/mangle/staticLanguageServiceHost.ts` |
| `build/next/private-to-property.ts` |

**Count:** 20 files under `build/` (excluding tests).

### Other repository API consumers

| Consumer | Path | Notes |
|---|---|---|
| HTML embedded JS/TS | `extensions/html-language-features/server/src/modes/javascriptMode.ts`, `javascriptSemanticTokens.ts` | API |
| TS language features (web) | `extensions/typescript-language-features/web/src/*.ts` | `typescript/lib/tsserverlibrary` types/runtime |
| Agent protocol sync | `scripts/sync-agent-host-protocol.ts` | API |
| Self-host VS Code extensions | `.vscode/extensions/vscode-selfhost-*` | API (dev-only) |
| Copilot TS server plugin tests | `extensions/copilot/.../serverPlugin/...` | API (copilot subtree) |

### Test / automation — `tsc` via `node_modules/typescript`

| Package | Compile script |
|---|---|
| `test/automation` | `node ../../node_modules/typescript/bin/tsc` |
| `test/smoke` | same (after automation compile) |
| `test/mcp` | same |
| `test/monaco` | same |
| `test/integration/browser` | same |
| `test/sanity` | `tsc` (local `typescript` devDep `^6.0.0-dev`) |

After dual-lane install, these resolve to **compat** `tsc6` (verified: `tsc6 --version` → 6.0.3).

### Extensions — `typecheck-web` / gulp

Built-in extension **package.json** scripts no longer depend on `@typescript/native-preview`. Gulp extension typecheck uses `build/lib/typescriptCompiler.ts` → **`tsc`**. Full `compile-extensions` / per-extension `typecheck-web` not re-run in this checkpoint (see BETA-029).

### Lint

| Consumer | Path | Notes | Verified |
|---|---|---|---|
| typescript-eslint | root `devDependencies` `typescript-eslint@8.45.0` | Uses `typescript` package API — compat lane | Installed; `npm run eslint` not in assurance |
| ESLint driver | `build/eslint.ts` | ESLint only; TS types via eslint/typescript-eslint config | Not re-run |

### Graph / parsers (not TypeScript compiler)

| Consumer | Path | Notes | Verified |
|---|---|---|---|
| Graph core (package) | `graphs/src/core/` (+ host under `graphs/src/host/`) | BETA-001; symlink `prebase/graphs` | `verify:graphs-boundary` |
| Graph package | `graphs/` | `npm run typecheck:graphs` (TS7, core-only) | Yes |
| Babel | `@babel/parser` in root deps | Unrelated to TS7 lanes | — |

### Summary counts

| Lane | Approx. sites |
|---|---|
| CLI TS7 `tsc` | Root scripts + `build/package.json` + gulp `typescriptCompiler.ts` stream + assurance |
| API compat required | 20 `build/` + html-language-features + TS extension web + scripts/selfhost |
| `tsc6` binary (test harness) | 5+ test packages |

## Upgrade phases

| Phase | Status |
|---|---|
| 1. Finish graph migration on current compiler baseline | **Done** — `graphs/src/`, symlink, boundary verifier |
| 2. Checkpoint git state (graph-only) | Done (checkpoint 3+4) |
| 3. Write baseline timings/diagnostics | Deferred (optional) |
| 4. Install aliases; review lockfile | **Done** — dual lanes installed |
| 5. Wire `typecheck:ts7` / replace preview CLI | **Done** — root + build `tsc`; preview removed |
| 6. Fix CLI path assumptions; keep API on compat | **Done** — `verify:typescript` |
| 7. Repair tsconfigs for removed/changed options | **Done** for client lane (`assurance` pass) |
| 8. Assurance + editor smoke | **Partial** — `npm run assurance` pass; editor checklist in `docs/TYPESCRIPT_EDITOR_VERIFICATION.md` (manual items open) |
| 9. Document residual TS6 consumers and 7.1 removal plan | **Done** — this doc + BETA-021 |
| **F. Phase F verification (2026-07-20)** | **Done** — see [Version research summary](#version-research-summary-phase-f) below |

## Version research summary (Phase F)

| Field | Installed | Latest stable researched | Action |
|---|---|---|---|
| Primary CLI (`@typescript/native` → `typescript`) | **7.0.2** (`tsc --version`) | **7.0.2** | **No upgrade** — already on latest stable |
| Compat API (`typescript` → `@typescript/typescript6`) | **6.0.2** (import API **6.0.3**; `tsc6`) | **6.0.2** | **No upgrade** — required until TS **7.1** programmatic API |
| `@typescript/native-preview` / `tsgo` | Removed | Superseded by stable `typescript@7` | N/A |

**Official sources (unchanged from install):** [Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/), [npm `typescript` 7.0.2](https://www.npmjs.com/package/typescript), [npm `@typescript/typescript6` 6.0.2](https://www.npmjs.com/package/@typescript/typescript6).

**Rollback plan:** Restore root `package.json` + `package-lock.json` from the last pre-TS7 checkpoint; run `npm ci`; re-run `npm run verify:typescript` and `npm run assurance`. Keep `graphs/` migration intact.

**Phase F automated evidence:** `verify:typescript`, `typecheck-client`, `typecheck:graphs`, `compile-magnus`, `compile-extension:typescript-language-features`, `extensions/typescript-language-features` `typecheck-web`. ESLint: migration-touched `build/lib/typescriptCompiler.ts` clean; scoped `graphs/**` header policy in `eslint.config.js`; full-repo `npm run eslint` still fails on pre-existing warnings (see BETA-009). Editor UI: [`docs/TYPESCRIPT_EDITOR_VERIFICATION.md`](TYPESCRIPT_EDITOR_VERIFICATION.md).

## Rollback plan

- Restore `package.json` + `package-lock.json` from graph-migration checkpoint.
- Keep `graphs/` migration intact.
- Do not leave half-upgraded lockfile.
- Re-run `npm ci` and baseline typecheck.

## Success criteria

- Authoritative typecheck runs TypeScript **7.0.2**.
- `import 'typescript'` for build tools resolves to **6.0.2** compat API (documented).
- Graph package typechecks under TS7.
- Lint/tests/watch/packaging verified or blockers filed in `docs/BETA_READINESS.md`.
- No application icons changed.

## Current limitations

- TS7 has **no** stable programmatic API (expected in **7.1**).
- typescript-eslint and many build scripts must stay on TS6 API until then.
- Editor LSP migration may need a documented fallback.

## Future TS6 removal plan

- Track BETA-021.
- After TypeScript 7.1 API GA: re-inventory every API consumer, port or delete, remove `@typescript/typescript6` alias, re-run assurance.
