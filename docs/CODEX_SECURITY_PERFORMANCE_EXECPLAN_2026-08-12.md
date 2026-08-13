# Security and Performance Execution Plan — 2026-08-12

## Current milestone

**Milestone:** Current-HEAD hardening and graph hot-path pass.  This is not a
ship-readiness claim.

## Findings and decisions

| ID | Finding | Decision |
| --- | --- | --- |
| SEC-001 | A model-controlled `force` input could select `stop()` and bypass the configured desktop-app termination confirmation. | Fixed: the tool schema and command no longer accept that control; all tool-triggered stops use `kill()`, the confirmation-aware operation. |
| SEC-002 | Runtime console/network evidence retained an unbounded number and size of strings. | Fixed: retain only the newest 200 entries, 4,000 characters per entry, and 64,000 total characters; surface dropped-entry metadata. |
| PERF-001 | Graph importance was recomputed by scanning all edges per node; graph BFS queues used `shift()`; parsing was sequential. | Fixed: build one importance map per operation, use indexed queues, and parse in cancellation-aware batches of eight. |

## Benchmark baseline

See [`reports/performance/2026-08-12/baseline/graph-layout.md`](../reports/performance/2026-08-12/baseline/graph-layout.md). It is a CPU-only layout microbenchmark, not GUI FPS or memory evidence.

## Verification

- `npm run typecheck-client` — pass (6.4 s).
- `npm run gulp compile-extension:prebase-magnus` — pass (0 TypeScript errors).
- `npm run typecheck:graphs` — pass; `npm run test:graphs` — 28 passing, 0 failures/skips.
- `node --experimental-strip-types --import=./graphs/scripts/graphs-test-register.mjs node_modules/mocha/bin/mocha.js src/vs/workbench/contrib/prebase/test/browser/runtimeSafetyBoundaries.test.ts --ui tdd --timeout 5000` — 3 passing, 0 failures/skips.
- `npm run verify:graphs-boundary` — pass; `npm run verify:privacy` — static pass with the existing GUI runtime-network warning; `npm run verify:icons` — 101/101 pass.
- `VSCODE_SKIP_PRELAUNCH=1 scripts/test.sh --run src/vs/workbench/contrib/prebase/test/browser/runtimeSafetyBoundaries.test.ts` could not start its Electron test host (`app` was undefined before test load); the source-Mocha result above is the available automated evidence.
- `npm run verify:eslint-prebase` remains blocked at 70 errors / 2,184 warnings versus its 64-error / 2,168-warning ratchet baseline. The directly touched code has 0 lint errors; the only targeted warning is the pre-existing PreBase i18n-resource reminder in `prebaseRuntimeService.ts`. Do not claim the aggregate ratchet passes.
- `npm audit --omit=dev` could not be refreshed: the sandbox cannot resolve the npm registry and the escalated request was rejected because dependency metadata could include private package names. No audit result is claimed for 2026-08-12.
- GUI lifecycle, packaged-app, native-module, privacy-network, RLS, and cross-platform evidence remain open.

## Next milestone

1. Run packaged/native and GUI Runtime Preview/desktop lifecycle smoke in an approved environment.
2. Refresh root and nested dependency audits where private package metadata may be sent to the registry.
3. Measure graph scan and renderer idle CPU/memory in a launched workbench before considering workers or native acceleration.
4. Reconcile the PreBase-path ESLint ratchet before release assurance can pass.
