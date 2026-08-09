# VS Code 1.133 Upstream Parity Audit

Date: 2026-08-09  
Working tree SHA (task start): `ab379c6e05fcd688dcf2dee372434ff7510e5d9e`  
Machine-readable report: [`reports/upstream-vscode-parity.json`](../reports/upstream-vscode-parity.json)

## Versions

| | PreBase archive / tree | VS Code reference archive |
|--|--|--|
| `package.json` version | **1.128.0** | **1.133.0** |
| Electron | **42.8.0** (upgraded 2026-08-09) | **42.8.0** |

Archives inspected (extracted outside the repo):

- `/Users/qunyingfan/Downloads/Prebasecode Main.zip` → `/tmp/prebase-parity-archives/prebase-main-ref/prebasecode-main`
- `/Users/qunyingfan/Downloads/VSCode main.zip` → `/tmp/prebase-parity-archives/vscode-main-ref/vscode-main`

(Illegal-byte search fixtures skipped during extract; not material to product code.)

## File inventory (noise dirs excluded)

| Metric | Count |
|--|--|
| PreBase files | 15,890 |
| VS Code files | 17,036 |
| Common paths | 15,473 |
| Only in PreBase | 417 |
| Only in VS Code | 1,563 |
| Common paths with size change | 2,342 |

Priority hashed subsystem (`src/vs/{base,platform,code,workbench}`, selected extensions, `build/{lib,darwin}`):

- Identical (hash): sample counted in JSON
- Changed: **1,943**
- Only VS Code: **1,291**
- Security-keyword candidate paths: **187** (see JSON)

## Themes

Stock **color** themes: PreBase already matches all **19** upstream IDs; extras are PreBase Dark / PreBase Light only.

Stock **file icon** themes: PreBase was missing **`vscode-modern-icons`** (`extensions/theme-modern-icons`). Ported from the VS Code 1.133 archive in this task.

Manifest: `build/themes/vscode-builtins.json`  
Verifier: `npm run verify:theme-parity`

## Major changed / upstream-only subsystems

- `src/vs/**` (bulk of delta)
- `extensions/theme-modern-icons` (upstream-only → ported)
- `extensions/copilot/**` (reject product restore)
- `build/**`, azure pipelines, smoke tests
- Electron 42.5 → 42.8 packaging metadata

## Candidate fix classes (semantic)

1. **SECURITY** — electron-main webPreferences, webview CSP, IPC validation, workspace trust, auth
2. **CORRECTNESS / CRASH** — workbench, filesystem, terminal/PTY
3. **ELECTRON** — 42.8 notes are functional (throttling, ICO temp files); no CVE called out in 42.8.0 notes
4. **PACKAGING** — adaptive icon is PreBase-owned; upstream packaging deltas reviewed selectively
5. **THEMES** — Modern Icons ported; color set already complete

## Rejected upstream categories

| Category | Reason |
|--|--|
| Full `src/vs` rebase | Erases PreBase architecture |
| Copilot product / GitHub Copilot provider | Intentionally removed |
| Microsoft telemetry / crash / surveys | Privacy (BETA-014) |
| Microsoft branding / updater endpoints | Product identity |
| Hosted Microsoft AI product surfaces | Conflicts with Magnus / privacy |

## Electron decision

**Applied** 42.5.0 → **42.8.0** on 2026-08-09 (GHSA-r4w5-6pfg-jxp5; VS Code 1.133 `ms_build_id` + checksums). Packaged/native smoke still open.

- Official 42.8.0 notes: Linux MemAvailable, macOS background-throttle fix, Windows ASAR ICO temp cleanup
- No dedicated security advisory in those notes
- Native modules / node-pty / packaging matrix not re-validated here
- Track under BETA-023; revisit with full assurance after focused smoke

## This task’s concrete ports

- `extensions/theme-modern-icons` (file icon parity)
- Theme Settings dynamic discovery (not an upstream file copy)
- macOS adaptive icon packaging (PreBase-owned; informed by Apple + proven `.icon`→`Assets.car` packaging principles)
