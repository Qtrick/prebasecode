# Technology Versions

Research date: **2026-07-20**  
Next review date: **2026-08-20**

Canonical inventory of language runtimes and development tools used by PreBase. Update this document whenever a version research or upgrade occurs.

| Technology | Current project version | Latest researched stable | Official sources | Compatibility status | Upgrade recommendation | Action taken | Blockers |
|---|---|---|---|---|---|---|---|
| TypeScript primary CLI (`@typescript/native` → `typescript@7`) | `npm:typescript@^7.0.2` → **7.0.2** (`node_modules/.bin/tsc`) | **7.0.2** | [Announcing TS 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/), [npm typescript](https://www.npmjs.com/package/typescript) | Authoritative typecheck/transpile lane | **Installed** — keep on latest 7.x patch | Installed 2026-07-20; `verify:typescript`, `typecheck-client`, `assurance` pass | No stable programmatic API until 7.1 |
| TypeScript compat API (`typescript` → `@typescript/typescript6`) | `npm:@typescript/typescript6@^6.0.2` → **6.0.2** (import API **6.0.3**; `tsc6`) | **6.0.2** | [Announcing TS 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/) | Required for `import 'typescript'` consumers | **Installed** — retain until TS 7.1 API | Installed 2026-07-20 dual-lane with primary | typescript-eslint + 20+ `build/lib/*` API imports |
| `@typescript/native-preview` / `tsgo` CLI | **Removed** from root lockfile | Superseded by `typescript@7.0.2` | Same as above | Replaced by stable `@typescript/native` alias | Do not reintroduce | Removed during BETA-006 install | Build helper renamed to `typescriptCompiler.ts` (spawns `tsc`) |
| Node.js | v24.17.0 (local) | Track LTS; research before bump | [nodejs.org](https://nodejs.org/) | OK for current Electron 42 | **Defer** unless TS7/Electron require | Deferred | Product/Electron matrix |
| npm | **11.18.0** (required by `build/npm/preinstall.ts`) | 12.0.1 available | [npm v12.0.1](https://github.com/npm/cli/releases/tag/v12.0.1), [npm 12 allowScripts](https://github.blog/changelog/2026-06-09-upcoming-breaking-changes-for-npm-v12/) | **Blocked at ≥12** until npm 12 install + native rebuild validated | Stay on **11.18.0** for installs | Rolled back from 12.0.1 on 2026-07-20 after preinstall guard; 2026-07-22: root `allowScripts` committed (BETA-031 In Progress) | npm 12 defaults block dependency install scripts; allowlist present — still need full 12.x retest before lifting preinstall |
| Bun | Not used | — | — | N/A | Skip | None | — |
| pnpm | Not used | — | — | N/A | Skip | None | — |
| Yarn | Not used | — | — | N/A | Skip | None | — |
| Electron | 42.5.0 | Research before bump | Electron releases | OK | **Defer** | Deferred | Unrelated to this task |
| Rust | 1.96.1 (local `rustc`; used by TS7 native toolchain upstream, not PreBase app code) | Match platform | [rust-lang.org](https://www.rust-lang.org/) | Host toolchain only | **Defer** | Deferred | Not a PreBase dependency |
| Cargo | Present with Rust | — | — | N/A for app | Defer | Deferred | — |
| Go | Not found locally | TS7 compiler is Go-native upstream | — | N/A for PreBase source | Defer | Deferred | — |
| Python | 3.14.2 (local) | — | — | Scripts only | Defer | Deferred | — |
| Java/JDK | Not installed | — | — | N/A | Skip | None | — |
| React | (workbench / webviews as applicable) | Audit with package lock | npm | Unchanged this task | Defer unless TS7 forces | Deferred | — |
| ESLint | Via `build/eslint.ts` + typescript-eslint 8.45.0 | Research with TS7 | eslint.org, typescript-eslint | Typed lint needs TS6 API | Keep TS6 API lane | Compat lane verified 2026-07-20 | `npm run eslint` not in assurance |
| typescript-eslint | 8.45.0 | Confirm TS7 peer notes | typescript-eslint.dev | Uses `typescript` package API | Compat lane | Documented 2026-07-20 | No TS7 API yet |
| Test runner | mocha 10.x + playwright | — | — | OK | Defer | Deferred | — |
| Bundler | gulp / build/next / rspack / vite (build tools) | — | — | Primary `tsc` in gulp stream | Repair as needed | `build/lib/typescriptCompiler.ts` → `npx tsc` | Full `compile-extensions` not in assurance |
| Webview bundler | Graph uses inline webview HTML (no separate bundle) | — | — | OK | N/A | Documented | Graph core/host under `graphs/src/` (symlink compile) |
| Packaging | `@vscode/gulp-electron` / gulp packaging | — | — | Audit native TS7 binaries (build-time only) | Do not ship unused TS binaries | Documented 2026-07-20 | — |
| Native build toolchain | node-gyp / platform tools | — | — | Unchanged | Defer | Deferred | — |

## Notes

- Authoritative package manager: **npm** (root `package-lock.json`).
- **Dual lanes (installed):** `@typescript/native` → TS **7.0.2** (`tsc`); `typescript` → `@typescript/typescript6` **6.0.2** (`tsc6`, import API 6.0.3). Audit: `npm run verify:typescript`.
- Primary typecheck: `npm run typecheck-client` → `tsc` (TS7). Alias: `npm run typecheck:ts7`.
- `build/package.json` `typecheck` → `npx tsc --project build/tsconfig.json` (TS7).
- `build/lib/typescriptCompiler.ts` / gulp extension pipelines spawn **`tsc`** (TS7), not the removed `tsgo` / native-preview CLI.
- Test harnesses (`test/automation`, `test/smoke`, `test/mcp`, `test/monaco`, `test/integration/browser`) use `node_modules/typescript/bin/tsc` → **compat** `tsc6`.
- Graph package: `npm run typecheck:graphs` → TS7 on `graphs/tsconfig.json` (core); host via symlink + `typecheck-client`.
- **Phase F (2026-07-20):** No TS/npm version bumps; dual lanes verified. Editor checklist: `docs/TYPESCRIPT_EDITOR_VERIFICATION.md`. Fixture: `test/fixtures/typescript-lanes/`.
- Application icons are protected; checksum manifest: `build/icons/icon-integrity.sha256` (**101** paths). Verify: `npm run verify:icons`.
- Assurance tiers: [docs/ASSURANCE.md](ASSURANCE.md) (`assurance:quick` default).
- Never modify icon assets or icon-selection product fields as part of version work.
