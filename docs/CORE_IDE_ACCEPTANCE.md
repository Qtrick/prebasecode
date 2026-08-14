# Core IDE acceptance (Phase I)

Checklist for PreBase workbench behavior outside graph-specific acceptance ([GRAPH_ACCEPTANCE.md](GRAPH_ACCEPTANCE.md)). **Needs Verification** until run in a built or launched-from-sources IDE with evidence recorded.

## Evidence standard

Same as graph acceptance: date, build SHA/version, tester, pass/fail, notes. Attach logs for crashes.

## Startup and workspace

| # | Scenario | Steps | Expected | Status | Evidence |
|---|---|---|---|---|---|
| C1 | Fresh profile | New isolated user data dir; launch PreBase; choose Continue Offline | Window opens; no immediate crash | Pass | 2026-08-14 source launch, `bd413b67`, macOS arm64: PreBase auth gate and offline onboarding rendered; no VS Code/Copilot modal or status UI. [`fresh-profile.md`](../reports/beta-acceptance/2026-08-14T17-47-21Z-bd413b6-darwin-arm64/launch/fresh-profile.md) |
| C2 | Existing profile | Reopen with prior `settings.json` | Settings migrate; no duplicate config errors | Needs Verification | — |
| C3 | Folder workspace | File → Open Folder | Explorer + editor usable | Needs Verification | — |
| C4 | Crash recovery | Kill process during edit; relaunch | Recovery prompt or restored buffers | Needs Verification | — |
| C5 | Reload window | Developer: Reload Window | Extensions and PreBase contrib reload cleanly | Needs Verification | — |

## Editor and workbench

| # | Scenario | Steps | Expected | Status | Evidence |
|---|---|---|---|---|---|
| E1 | Save / undo | Edit file; save; undo | Disk and buffer consistent | Needs Verification | — |
| E2 | Search | Workspace search | Results open files | Needs Verification | — |
| E3 | SCM | Git repo with changes | Source control view works | Needs Verification | — |
| E4 | Terminal | Open integrated terminal | Shell runs in workspace cwd | Needs Verification | — |
| E5 | Debug | Launch simple Node/debug config | Session starts (if debug ext present) | Needs Verification | — |
| E6 | TypeScript fixture | Open `test/fixtures/typescript-lanes/` | See [TYPESCRIPT_EDITOR_VERIFICATION.md](TYPESCRIPT_EDITOR_VERIFICATION.md) manual rows | Needs Verification | — |

## PreBase shell

| # | Scenario | Steps | Expected | Status | Evidence |
|---|---|---|---|---|---|
| P1 | PreBase Settings | Open PreBase Settings editor | Categories render; graph keys persist | Needs Verification | — |
| P2 | Onboarding | First-run or reset onboarding | Flow completes without error | Needs Verification | — |
| P3 | Account | Sign in / out (if API configured) | Tokens via secret storage; no plaintext in settings | Needs Verification | — |
| P4 | Runtime preview | Open runtime preview | Strict CSP webview; lifecycle cleanup on close | Needs Verification | — |
| P5 | Magnus / Agents | Open Agents; send prompt | Extension activates; no hard crash | Needs Verification | — |

## Automated static gates (2026-07-20)

| Check | Command | Result |
|---|---|---|
| Client typecheck | `npm run typecheck-client` | Pass |
| Privacy static | `npm run verify:privacy` | Pass (runtime network observation still manual) |
| Assurance quick | `npm run assurance:quick` | Pass |

## Related backlog

- [BETA_READINESS.md](BETA_READINESS.md) — BETA-010, BETA-011, BETA-012, BETA-013, BETA-022, BETA-014 (runtime network)
