# PreBase packaging

How desktop, server (REH), and web artifacts are produced from this repository. Commands below were discovered from `npm run gulp -- --tasks-simple` and `build/gulpfile.vscode.ts` on **2026-07-20** (darwin arm64).

## Prerequisites

- Node version from [`.nvmrc`](../.nvmrc); `npm ci` at repo root (and distro mixin steps for full Microsoft-style CI).
- Compiled output: packaging tasks read from `out-vscode` / `out-vscode-min` (produced by `bundle-vscode` or esbuild bundle + minify).
- **Full** `vscode-*` tasks also run extension build, Copilot extension build, extension media, and native extensions — expect long runtimes and large disk use.
- Local dev without the Copilot submodule may fail hygiene tasks that read `extensions/copilot/package.json`; that does not change the gulp task names.

## npm script shortcuts

| Script | Gulp task |
|--------|-----------|
| `npm run compile-build` | `compile-build-with-mangling` |
| `npm run compile-extensions-build` | `compile-extensions-build` |
| `npm run minify-vscode` | `minify-vscode` |
| `npm run minify-vscode-reh` | `minify-vscode-reh` |
| `npm run minify-vscode-reh-web` | `minify-vscode-reh-web` |
| `npm run core-ci` | `core-ci` |

Packaging is invoked via `npm run gulp <task>` (see [package.json](../package.json) `gulp` script).

## Desktop client (Electron)

Gulp registers per **platform** and **arch** pairs in `BUILD_TARGETS` inside `build/gulpfile.vscode.ts`:

| Platform | Architectures |
|----------|----------------|
| `win32` | `x64`, `arm64` |
| `darwin` | `x64`, `arm64` |
| `linux` | `x64`, `armhf`, `arm64` |

For each pair there are four task names (example: **darwin arm64**):

| Task | Role |
|------|------|
| `vscode-darwin-arm64` | Full pipeline: compile-build (or esbuild path), extensions, bundle/minify, then **ci** package steps |
| `vscode-darwin-arm64-min` | Same with minified `out-vscode-min` |
| `vscode-darwin-arm64-ci` | **Package only** — assumes `out-vscode` already populated; writes `../VSCode-darwin-arm64/` next to the repo |
| `vscode-darwin-arm64-min-ci` | Package-only minified variant |

On the **host matching** platform and CPU, gulp also exposes:

- `vscode` → `vscode-<platform>-<arch>` for current machine
- `vscode-min` → minified variant

**Output layout (darwin):** `../VSCode-darwin-<arch>/<ProductName>.app` (product name from [product.json](../product.json), e.g. `PreBase.app`).

**Output layout (win32):** `../VSCode-win32-<arch>/` with versioned resources folder when enabled.

**Output layout (linux):** `../VSCode-linux-<arch>/` plus separate deb/rpm/snap prepare/build tasks (`vscode-linux-x64-prepare-deb`, `vscode-linux-x64-build-deb`, etc.).

### Typical local sequence (unsigned smoke — **Needs Verification** for full run)

Microsoft’s darwin publish compile step ([`product-build-darwin-compile.yml`](../build/azure-pipelines/darwin/steps/product-build-darwin-compile.yml)) uses:

```bash
npm run gulp core-ci
npm run gulp vscode-darwin-$(uname -m | sed 's/x86_64/x64/')-min-ci
```

A **full** unsigned desktop package has **not** been completed in Phase J automation (compile + package is multi-hour). Phase J verified:

- Gulp task discovery (`vscode`, `vscode-min`, `vscode-darwin-arm64-ci` present on darwin arm64).
- `npm run assurance:package` (preflight + task smoke) — see [ASSURANCE.md](ASSURANCE.md).

## Remote Extension Host (REH)

Tasks follow `vscode-reh-<platform>-<arch>` and `-min` / `-ci` variants, e.g. `vscode-reh-darwin-arm64-min-ci`. CI renames output folders to `vscode-server-darwin-<arch>`.

## REH Web

Tasks follow `vscode-reh-web-<platform>-<arch>` (and `-min`, `-ci`).

## Web workbench (browser)

Separate gulpfile: `vscode-web`, `vscode-web-min`, `vscode-web-ci`, `vscode-web-min-ci` (from `build/gulpfile.vscode.web.ts`).

## Symbols

`vscode-symbols-darwin`, `vscode-symbols-win32-x64`, `vscode-symbols-linux-x64`, etc.

## Windows installers (downstream of client build)

Examples from gulp task list:

- `vscode-win32-x64-system-setup`, `vscode-win32-x64-user-setup`
- `vscode-win32-x64-inno-updater` (and arm64 counterparts)

## CI reference (upstream Microsoft)

Official pipelines live under [`build/azure-pipelines/`](../build/azure-pipelines/). PreBase does **not** inherit Microsoft’s Azure subscriptions, Key Vaults, or ESRP registrations. Use those YAML files as **behavioral reference** only; PreBase release signing is documented in [RELEASE_SIGNING.md](RELEASE_SIGNING.md).

## Assurance

| Script | Purpose |
|--------|---------|
| `npm run assurance:package` | Icon gate + signing preflight (non-release) + gulp task smoke |
| `npm run verify:icons` | Icon byte integrity vs `build/icons/icon-integrity.sha256` |

## Related backlog

- [BETA_READINESS.md](BETA_READINESS.md) — BETA-015 (packaging), BETA-016 (icons)
