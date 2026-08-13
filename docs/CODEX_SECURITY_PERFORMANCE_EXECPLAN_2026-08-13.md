# Security and Performance Execution Plan — 2026-08-13

## Current milestone

Current-HEAD continuation on `main` at `85ac6690ab2ff1e56502b78c9d75ae6076b9474e`.
Initial worktree was clean; icon integrity verified at 101/101 before edits.

## Accepted work

- Gemini transport: remove query-string credentials after current official
  provider research; test and implement real cancellation in the active pass.
- Gemini picker: remove shut-down/deprecated model entries; do not expose newer
  thought-signature-dependent models until the raw conversation protocol can
  preserve their required state.
- Desktop provider documentation: workspace `.env` is not a SecretStorage
  substitute, so its stale provider-key fields are removed.

## Completed this pass

- Gemini uses `x-goog-api-key` only: no credential is sent in an URL or
  Authorization header. Its VS Code cancellation token now aborts real fetches,
  streaming frames are capped at 1 MiB, and a 10 MiB managed-screenshot cap
  protects Desktop IPC.
- CDP discovery accepts only successful localhost responses up to 1 MiB, and
  every CDP protocol request is individually timed out and cleaned up.
- Graph dependency-depth traversal uses indexed breadth-first queue traversal;
  layout importance and directory proximity use linear-time maps rather than
  repeated scans.
- `verify:eslint-prebase-security` is a strict zero-debt gate over assurance,
  Desktop, and Magnus sources. It runs in `assurance:release` before the legacy
  ratchet; the legacy baseline was not changed.

## Validation

- `verify:icons`: PASS (101/101); icon bytes and integrity manifest untouched.
- `typecheck-client`, `compile-magnus`, `typecheck:graphs`, `test:graphs`:
  PASS. Graph suite: 31 passing.
- Gemini source tests: 8 passing. Compiled CDP tests: 4 passing.
- `verify:eslint-prebase-security`: PASS (23 files; 0 errors, 0 warnings).
- `git diff --check`: PASS.
- `verify:eslint-prebase`: expected FAIL, 68 errors / 2,184 warnings versus
  baseline 64 / 2,168; no rebaseline was performed.

## GUI launch evidence

The launch workflow started an isolated throwaway profile successfully with a
short `/tmp` path and reached the Electron CDP-ready state. The first attempt
correctly failed before workbench startup because macOS Unix-domain socket paths
exceeded their length limit. The short-path instance then exited before the
automation client could attach, so no GUI FPS, heap, or lifecycle measurement is
claimed. The attempt retained no source profile changes and does not close
BETA-003, BETA-004, BETA-012, BETA-013, or BETA-024.

## Baseline and blockers

- `verify:eslint-prebase` began at 70 errors / 2,184 warnings against its
  64-error / 2,168-warning baseline; no rebaseline is authorized.
- Root dependency audit cannot be refreshed in this sandbox without sending
  dependency metadata to the public registry; this requires explicit approval.
- GUI, package/native, privacy-network, RLS, and cross-platform evidence remain
  open and are not claimed by this plan.
