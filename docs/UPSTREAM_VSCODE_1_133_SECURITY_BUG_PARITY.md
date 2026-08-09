# Upstream VS Code 1.128 → 1.133 Security / Bug Parity

Companion to [`VSCODE_1_133_UPSTREAM_PARITY_AUDIT.md`](VSCODE_1_133_UPSTREAM_PARITY_AUDIT.md) and [`reports/upstream-vscode-parity.json`](../reports/upstream-vscode-parity.json).

## Method

1. Extract PreBase Main + VS Code Main archives outside the working tree.
2. Inventory common / only-pre / only-vs / size-changed paths.
3. Hash priority subsystems.
4. Classify by category below — **do not** wholesale merge.

## Categories

| # | Category | Status this pass |
|--|--|--|
| 1 | SECURITY | Reviewed candidates in JSON; no blind mass port. Electron security posture audited against current Electron docs (contextIsolation/sandbox guidance). |
| 2 | CORRECTNESS | Deferred selective ports pending per-file analysis |
| 3 | CRASH / DATA LOSS | Deferred |
| 4 | ELECTRON | **42.8.0 deferred** (see audit) |
| 5 | TERMINAL / PTY | Deferred |
| 6 | FILESYSTEM | Deferred |
| 7 | EXTENSION HOST | Deferred |
| 8 | WEBVIEW | PreBase CSP static checks remain via `verify:privacy` |
| 9 | WORKSPACE TRUST | Deferred |
| 10 | AUTHENTICATION | PreBase Supabase path retained; do not restore Microsoft sign-in |
| 11 | REMOTE | Deferred |
| 12 | NETWORK | Deferred |
| 13 | PACKAGING | Adaptive icon packaging implemented PreBase-side |
| 14 | THEMES | Modern Icons ported; Settings dynamic discovery |
| 15 | ACCESSIBILITY | HC themes remain; BETA-018 still open for graphs a11y |
| 16 | PERFORMANCE | Deferred |
| 17 | NOT RELEVANT TO PREBASE | Copilot UX, Microsoft experiments |
| 18 | INTENTIONALLY REJECTED | Telemetry, Copilot provider, branding |

## Electron security review (PreBase desktop)

Official guidance consulted: Electron security / contextIsolation / sandbox / IPC tutorials (2026).

PreBase continues to inherit Code OSS desktop defaults for BrowserWindow. Custom PreBase surfaces should keep:

- `nodeIntegration` off for untrusted content
- `contextIsolation` on
- sandbox where feasible
- no `dock.setIcon` runtime substitute for app icon packaging

Runtime Preview / graph webviews: static CSP checked by `verify:privacy` (runtime network observation still Needs Verification — BETA-014).

## Adopted / deferred decisions

| Item | Decision | Evidence |
|--|--|--|
| Electron 42.8.0 | **Applied** 2026-08-09 | Clears GHSA-r4w5-6pfg-jxp5 (≥42.5.1); checksums from VS Code 1.133; native/packaged smoke still open |
| theme-modern-icons | **Adopt** | Missing vs 1.133; ported verbatim |
| Adaptive Assets.car | **PreBase implement** | Not upstream Code OSS packaging |
| Copilot restore | **Reject** | Product policy |
| Telemetry restore | **Reject** | `verify:privacy` |

## Regression tests

- `npm run verify:theme-parity`
- `npm run verify:macos-adaptive-icon` (darwin + `.app`)
- `build/lib/test/prebaseDarwinIcon.test.ts` (node:test)
- Existing `verify:privacy` / `assurance:quick`

Further per-fix regression tests are required before claiming security parity complete.
