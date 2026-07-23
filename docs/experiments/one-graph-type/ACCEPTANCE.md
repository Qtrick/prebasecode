# Acceptance — One Graph Type (Code Graph)

Branch: `One-Graph-Type` (≡ `ONE-GRAPH-TYPE`). Rollback: `efabd9ed4abde12e0f79055cd63f0e5681c40abe`.

## Status

**Not Complete — OGT-010 Needs GUI evidence.**  
Automated tests ≠ GUI acceptance. Do not invent Result/Evidence.

### Architecture Graph sources are PRESERVED (not deleted)

Active product paths stay empty. Sources live under:

- `graphs/src/preserved/architecture/` (VS Code-era layouts / pick / depth)
- `graphs/src/preserved/architecture/legacy-first-test/` (Vite/React First-Test archive)

Boundary verifier requires the preserved tree and rejects active Architecture product paths.

**GUI still required** to prove:

1. Opening Code Graph never shows a blank webview / stuck “Preparing graph…” after a successful scan.
2. No Architecture / Network product toggle or Arch layout chrome remains in Maps / Home / Settings.
3. Legacy restore of old Arch/Net editor tabs lands on Code Graph canvas (3D network), not an empty or SVG path.
4. `openArchitecture` / `openNetwork` aliases still open Code Graph without errors.
5. Community Force default; confidence dash styles; local explain inspector without auto-AI.

Until those rows have Result + Evidence from a real launch, OGT-010 stays **Needs Verification**.

## How to run

1. `git branch --show-current` → `One-Graph-Type`
2. Launch PreBase with a fresh throwaway profile
3. Open Code Graph (`prebase.graph.open`)
4. Capture screenshots under `.tmp/one-graph-acceptance/` (ignored) or attach paths below

## Matrix

| Commit | Platform | Project | Nodes | Edges | Layout | Test | Expected | Result | Evidence | Defect | Retest |
|---|---|---|---|---|---|---|---|---|---|---|---|
| | darwin | small TS fixture | | | community | Activity Bar one Code Graph; no Arch/Net product toggle | Pass | | | | |
| | darwin | React/Vite | | | | Scan/rescan/cancel; communities list; search; select | Pass | | | | |
| | darwin | medium app | | | | Inspector local structure; open source; no auto-AI | Pass | | | | |
| | darwin | mixed-language if available | | | | Confidence solid/dashed/dotted visible | Pass | | | | |
| | darwin | PreBase repo | | | | Large-project smoke; no blank workbench | Pass | | | | |
| | darwin | any | | | | Magnus path + affected + explain + bridges | Pass | | | | |
| | darwin | restore | | | | Old Arch/Net tabs restore → Code Graph (canvas, not blank/SVG) | Pass | | | | |
| | darwin | any | | | | Bridge / Important / Potentially Affected Maps actions | Pass | | | | |
| | darwin | any | | | community | Community checkbox hides nodes on canvas | Pass | | | | |

## Automated gates (supporting only)

| Gate | Last result |
|---|---|
| `verify:icons` | 2026-07-22 — **101/101 OK** |
| `verify:graphs-boundary` | 2026-07-22 — **OK** |
| `verify:graphs-out` | 2026-07-22 — **PASS** (after `transpile-client`) |
| `verify:startup` (+ `PREBASE_STARTUP_LAUNCH=1`) | 2026-07-22 — **PASS** (extension host + `[PreBase] workbench restored`) — evidence: `.tmp/startup-launch-unsandboxed.log` |
| `test:graphs` | 2026-07-22 — **46** pass |
| `typecheck:graphs` | 2026-07-22 — **Pass** |
| `typecheck:graphs-preserved` | 2026-07-22 — **Pass** (archive lane) |

## GUI matrix honesty

Startup launch PASS ≠ Code Graph feature acceptance. Sidebar/community/confidence/path/Magnus GUI rows above remain empty until exercised in a throwaway profile.

## Honesty

- Main BETA-003 / BETA-004 remain **Needs Verification** and are **not** satisfied by this experiment.
- This checklist is Code Graph acceptance for **OGT-010** only.
- Architecture preservation tracked under preserved tree + boundary; GUI proof lives here.
