# Beta acceptance execution - 2026-08-14

This is an evidence record for the current stabilization campaign, not a second backlog. The worktree and current source are authoritative. `PASS` requires recorded automated, GUI, runtime, or package evidence; implementation alone is not evidence.

| ID | Current implementation | Automated evidence | GUI/runtime/package evidence | Current status | Exact gap | Next action |
|---|---|---|---|---|---|---|
| BETA-001 | `graphs/` owns the active Code Graph; dormant Architecture assets are isolated. | Boundary verifier and client typecheck recorded historically. | None current. | Needs Verification | Settings and active graph GUI evidence. | Run Code Graph acceptance. |
| BETA-002 | Boundary verifier is wired into assurance/CI. | Local verifier evidence exists. | CI run not recorded here. | Needs Verification | Green CI evidence. | Confirm PR job on a future change. |
| BETA-003 | Architecture assets are preserved, not registered as an active surface. | Ownership test normalizes legacy restore. | Not applicable to active beta UI. | Deferred After Beta / superseded | Historical rows were stale. | Preserve assets; do not accept as active product. |
| BETA-004 | One active Code Graph uses the compatible `network` identifier. | Deterministic layout and interaction tests exist. | Not yet recorded. | Needs Verification | Real visual/layout/interactions. | Run against a fixture workspace. |
| BETA-005 | Graph unit suite covers ownership, picking, and layouts. | `npm run test:graphs` exists. | CI result not current. | Needs Verification | Current local and CI result. | Run after graph changes / CI. |
| BETA-008 | TS7 entrypoints replace preview compiler. | Historical assurance evidence. | N/A. | Needs Verification | Full extension compile matrix. | Run packaged extension compile. |
| BETA-009 | Compat API lane and scoped lint ratchet exist. | Static verifier exists. | N/A. | Needs Verification | Full-repo lint remains known debt. | Maintain scoped gate; resolve upstream debt separately. |
| BETA-010 | Startup restoration and auth gate are implemented. | Startup static verifier exists. | Core fresh/existing/crash/reload matrix open. | Needs Verification | Real source launch evidence. | Launch isolated PreBase profile. |
| BETA-011 | Native workbench is inherited with PreBase contributions. | Typecheck only. | Editor/search/SCM/terminal/debug matrix open. | Needs Verification | Real fixture workflow. | Execute C3/E1-E6. |
| BETA-012 | Magnus extension, native tools, and Test-mode policy are registered. | Mode-registry coverage, manifest parity, and Magnus compile pass; Test can exercise Runtime Preview while writes remain Edit/Agent-only. | Fresh GUI confirms Agents shell; no provider-backed agent loop. | Needs Verification | Live agent prompt/tool invocation. | Run with an explicitly configured provider/session. |
| BETA-013 | Managed and external runtime services exist; owned external CDP screenshot capture is bounded and image-validated. | Focused external-target/bounds tests and lifecycle/CSP checks pass. | No managed or owned-external runtime fixture was launched. | Needs Verification | Managed/external lifecycle and screenshot acceptance. | Launch deterministic runtime fixture and record one owned external capture. |
| BETA-014 | Static telemetry, secret storage, and CSP gates exist. | `verify:privacy` exists. | Network observation open. | In Progress | Runtime endpoint classification. | Use a read-only launch observation. |
| BETA-015 | Packaging documentation, preflight, and task smoke exist. | `assurance:package` exists; `npm run gulp vscode-darwin-arm64` reached extension bundling on 2026-08-14. | Full unsigned artifact absent: `compile-copilot-extension-build` calls `packageCopilotExtensionStream` with an empty glob after Copilot was intentionally disabled, causing `Invalid glob argument`. | Blocked | Copilot-free package path and actual unsigned package/launch. | Make the package task skip disabled Copilot rather than reintroducing it, then retry. |
| BETA-016 | Frozen icon manifest and verifier exist. | Start-of-run `verify:icons` PASS (101/101). | Package bundle evidence open. | Needs Verification | Packaged bundle check. | Re-run after package work. |
| BETA-017 | Assurance tiers are present. | Historical local passes. | CI confirmation open. | Needs Verification | Recent repeatability/CI evidence. | Record targeted campaign checks. |
| BETA-018 | Partial reduced-motion hooks exist. | No complete a11y suite. | No keyboard/HC evidence. | Not Started | Accessibility matrix. | Run after core launch. |
| BETA-022 | Versioned onboarding and account lifecycle are implemented. | Focused OAuth tests exist. | Sign-in/out GUI not recorded. | Needs Verification | First-run and configured-account flow. | Use offline then configured scenario when safe. |
| BETA-023 | Supply-chain documentation and scoped security lint exist. | Static audits documented. | Packaged/native smoke open. | In Progress | Package execution and remaining dependency finding. | Cover during package acceptance. |
| BETA-024 | Bounded layouts and CPU benchmark exist. | Node benchmark available. | No render FPS/memory evidence. | In Progress | Real graph performance/memory. | Measure during Code Graph launch. |
| BETA-025 | Notice process is documented. | No release artifact evidence. | N/A. | In Progress | PreBase notice pipeline. | Address with packaging work. |
| BETA-027 | PreBase assurance workflow is defined. | Workflow source present. | Green execution not recorded. | In Progress | CI evidence. | Confirm on a PR/CI run. |
| BETA-029 | Selected extension compiles pass historically. | Focused compile evidence exists. | N/A. | Needs Verification | Complete extension matrix. | Run once package path is stable. |
| BETA-033 | Supabase auth and SecretStorage adapter are implemented. | Static scans and OAuth tests. | Hosted sign-in unavailable here. | In Progress | Dedicated configured account evidence. | Block externally unless test credentials supplied. |
| BETA-034 | Migrations/RLS validators and an opt-in two-user runtime harness exist. | `assurance:cloud` passes; harness syntax, no-config SKIP, partial-config fail-closed, redaction, and 0600 artifact paths were checked locally. | No live two-user run: dedicated non-production credentials were not supplied. | In Progress | Recorded two-user runtime PASS artifact. | Supply dedicated non-production credentials and run `test:supabase-rls-runtime`. |
| BETA-037 | No current tracker row or implementation was found. | N/A. | N/A. | Not Applicable | Canonical tracker has no BETA-037. | Add only if product scope identifies it. |
| BETA-038 | Adaptive icon packaging verifier exists. | Historical dev-app PASS. | Packaged app missing. | Needs Verification | Real package artifact. | Verify after unsigned package. |
| BETA-039 | Theme parity/settings discovery exist. | Static parity evidence recorded historically. | Light/HC GUI matrix open. | Needs Verification | Real theme switching/initial paint. | Run after launch. |
| BETA-040 | Authenticated LinkUp gateway/tool path exists. | Static implementation only. | Live deployment/tool loop open. | Needs Verification | Gateway credentials and signed-in test. | Block externally unless configured. |

## Campaign evidence

Each executable scenario writes a sanitized manifest under `reports/beta-acceptance/<run-id>/`. The manifest records commands, timestamps, status, logs, and screenshots without tokens, cookies, prompts, provider keys, or query bodies.
