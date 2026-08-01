# PreBase cleansing audit — One-Graph-Type

Findings from the application-wide quality pass on the `One-Graph-Type`
experiment. Scope is PreBase-owned code: `graphs/src` (excluding the frozen
`graphs/src/preserved` archive), `src/vs/workbench/contrib/prebase`,
`extensions/prebase-magnus`, the PreBase build/assurance scripts, and the
theme and hygiene gates that guard them. Upstream VS Code code was only
touched where PreBase had already forked it.

Severity ladder: Blocker > Critical > High > Medium > Low > Cosmetic.

Status values: `fixed`, `fixed (test)`, `deferred`, `intentional`,
`false positive`.

## Summary

| Severity | Found | Fixed | Deferred |
| --- | --- | --- | --- |
| Blocker | 3 | 3 | 0 |
| Critical | 6 | 6 | 0 |
| High | 11 | 11 | 0 |
| Medium | 9 | 8 | 1 |
| Low | 4 | 3 | 1 |
| **Total** | **33** | **31** | **2** |

## Findings

| ID | Subsystem | Problem | Severity | Evidence | Root cause | Fix | Regression test | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C-01 | Build / assurance | `npm run typecheck-client` and therefore `assurance:quick` failed with 148 errors on this branch | Blocker | `tsc -p src/tsconfig.json` output | the `graphs` symlink pulls `graphs/src` into `src/vs/**`, so the frozen `preserved/` Architecture archive was compiled by the primary TS7 lane, which `graphs/tsconfig.json` already excludes | exclude `vs/workbench/contrib/prebase/graphs/**` archive paths from `src/tsconfig.json` | `npm run typecheck-client` in `assurance:quick` | fixed |
| C-02 | Build / hygiene | the husky pre-commit hook aborted on every commit touching PreBase code, so the gate was effectively off | Blocker | `git commit` → unhandled `ENOENT extensions/copilot/package.json`; copyright and allowed-JS failures | `checkCopilotEnginesVersion` read a manifest PreBase does not ship; the copyright check only knew the Microsoft banner; `.eslint-allowed-javascript-files` had drifted by 19 files | teach `build/hygiene.ts` the two PreBase banners and the Node harness scripts, guard the Copilot manifest read, refresh the allowlist, add the matching eslint override | the hook itself runs on every commit | fixed |
| C-03 | Lint ratchet | `verify:eslint-prebase` had been failing since the network-graph rewrite (2168 → 5653 warnings) | Blocker | `npm run verify:eslint-prebase` | new graph sources were never run through repository lint rules, and the archived `preserved/` tree was being linted | scope out `graphs/src/preserved/**`, apply autofixes, fix the real findings, reseed at 0/0 over 122 files | `npm run verify:eslint-prebase` (release gate) | fixed |
| C-04 | Magnus | the Gemini API key was sent as a `?key=` query parameter | Critical | `geminiClient.ts` auth method `query` | convenience fallback | header-only auth; the query path is removed | — | fixed |
| C-05 | Magnus | `DesktopCdpEvalTool` evaluated model-supplied JavaScript in the previewed application with no confirmation | Critical | `desktopTools.ts` | tool was written for a trusted-author assumption | modal confirmation showing the expression, plus a Workspace Trust check | — | fixed |
| C-06 | Runtime Preview | `0.0.0.0` and `[::]` were classified as local, so a wildcard bind host skipped the external-navigation confirmation | Critical | `permissionClassifier.ts` `LOCAL_HOST_RE` matched any `0.*` host | the regex was written for "looks numeric and low" rather than for the loopback range | tighten the regex to real loopback forms and rewrite wildcard binds to loopback before classifying | `test/common/permissionClassifier.test.ts` | fixed (test) |
| C-07 | Runtime Preview | stopping the preview did not cancel a start already in flight, so a managed Electron window could open *after* the user stopped it | Critical | `prebaseRuntimeService.start()` waits up to 45s for a renderer with no cancellation | start had no token; `stop()` only tore down the terminal | `start()` carries a `CancellationTokenSource` that `stop()`/`dispose()` cancel; the URL poll observes it; a session that still opens is closed | — | fixed |
| C-08 | Graph | `relayout()` had no generation guard, so two rapid layout changes could finish out of order and leave stale node positions on screen | Critical | `prebaseGraphService.relayout()` wrote results unconditionally after `await` | no sequencing | monotonic `_relayoutGeneration`, shared with `scanWorkspace()` and `cancelScan()` | — | fixed |
| C-09 | Graph | a throwing layout kernel left the graph permanently on "Updating layout…" | Critical | no `try`/`catch` around the layout call | — | wrap and report, and release the status | — | fixed |
| H-01 | Magnus | one shared `CancellationTokenSource` meant a new prompt silently disabled cancellation for a request already in flight | High | `MagnusChatState.cancellation` was a single field | — | per-request tokens in a `Set`, cancelled together by the cancel command | — | fixed |
| H-02 | Magnus | attached files were sent to the model as bare paths, so the model answered about file contents it had never seen | High | `chatParticipant.ts` pushed `Attached file: ${file}` | — | read the file with workspace containment, secret-path and length checks | — | fixed |
| H-03 | Magnus | `read_file_range` treated `endLine` as exclusive while the tool schema implied inclusive, truncating the last line | High | `workspaceIntelligence.readFile` | schema/implementation mismatch | inclusive, clamped to `lineCount - 1`; schema description corrected | — | fixed |
| H-04 | Magnus | a shell task that never emitted a process exit hung the tool call forever | High | `runVisibleTask` awaited `onDidEndTaskProcess` only | tasks can end without a process | 10-minute timeout plus an `onDidEndTask` fallback, both disposed | — | fixed |
| H-05 | Magnus | non-OK streaming responses were left undrained and their raw payload was surfaced to the user | High | `geminiClient.streamGenerateContent` | — | drain the body, map to `GeminiRequestError` with an actionable message, log the detail | — | fixed |
| H-06 | Magnus | `MagnusLanguageModelProvider` was never disposed, leaking its emitter for the extension's lifetime | High | `extension.ts` did not push it into `subscriptions` | — | implement `dispose()` and register it | — | fixed |
| H-07 | PreBase commands | `ServicesAccessor` was used after `await` in the account, runtime and graph commands | High | `prebase.contribution.ts`, `graphContribution.ts` | an accessor is only valid for the synchronous part of an `Action2` handler | resolve services up front | — | fixed |
| H-08 | Runtime Preview | "Open Terminal" created and abandoned a terminal on every click when no dev server was running | High | `prebaseRuntimeService.openTerminal()` | the instance was never stored | reuse and dispose a tracked `_idleTerminal` | — | fixed |
| H-09 | Graph webview | the RAF loop rescheduled itself every frame even with a completely static scene | High | `graphEditor.ts` render loop | loop was unconditional | invalidation funnels through `markDirty()`; the loop parks when nothing animates and is woken on demand | `graphWebviewHtml.test.ts` "render loop parks when the scene is static" | fixed (test) |
| H-10 | Graph webview | a host request whose handler threw never got a reply, so node popups could sit on a loading state forever | High | `_onMessage` had no `catch` | — | handlers always reply; requests time out client-side | `graphWebviewHtml.test.ts` "host requests always settle" | fixed (test) |
| H-11 | Theme | `COLOR_THEME_DARK/LIGHT_INITIAL_COLORS` still held the pre-redesign palette, so a cold start painted 93 tokens with colours the theme no longer uses | High | `workbenchThemeService.ts` vs the resolved theme | the constants are hand-maintained and nothing checked them | resolve both from the shipped themes | `verify:theme-surfaces` startup check | fixed (test) |
| M-01 | Graph | changing the layout mode in Settings ran the O(n²) layout kernel twice | Medium | `graphSettingsUi.ts` called `host.relayout()` and the configuration listener relayouted too | duplicated ownership | drop the direct call; the configuration listener is the single owner | — | fixed |
| M-02 | Graph webview | the wheel handler drew synchronously on every event | Medium | `onWheel` called the draw path directly | — | mark dirty and let the RAF loop coalesce | — | fixed |
| M-03 | Runtime Preview | a refused connection fires neither `load` nor `error` on the iframe, leaving a permanent "Loading…" overlay | Medium | `runtimeEditor.ts` only handled `load` | — | error handler plus a load timeout that reports back to the host | — | fixed |
| M-04 | Runtime Preview | `navigateForMagnus` reported success whenever the URL merely parsed, and an agent asking to stop the dev server would also close a managed desktop window | Medium | `prebaseRuntimeService` | the agent path reused the user path without distinguishing outcomes | report what actually happened; refuse to close a managed session | — | fixed |
| M-05 | Settings editor | the "Saved" badge used a raw `setTimeout` that outlived a re-render | Medium | `prebaseSettingsEditor.ts` | — | `disposableTimeout` tied to the render disposables | — | fixed |
| M-06 | Runtime Preview / Settings | global `window.setTimeout` and `document.activeElement` were used from editors that can live in an auxiliary window | Medium | `runtimeEditor.ts`, `prebaseRuntimeView.ts` | multi-window support post-dates the code | `DOM.getWindow(...)` / `DOM.getActiveElement()` | eslint multi-window rules | fixed |
| M-07 | Settings editor | the settings grid was re-queried by CSS selector on every layout | Medium | `prebaseSettingsEditor.ts` | — | keep the element reference the editor already created | — | fixed |
| M-08 | Localization | `vs/workbench/contrib/prebase` was not registered in `i18n.resources.json`, so its localized strings were never exported | Medium | `i18n.resources.json` | the contribution was added after the manifest | register it | — | fixed |
| M-09 | Graph | the legend drew edge swatches in `#94a3b8`, a colour the canvas never paints | Medium | `graphEditor.ts` legend vs canvas draw | two copies of the same constant | one shared constant feeds both | `verify:theme-surfaces` forbids the raw value | fixed |
| L-01 | Graph parser | loose equality (`== null`) and duplicate `@babel/traverse` imports | Low | `parserEngine.ts` | — | strict comparison, single import | lint ratchet | fixed |
| L-02 | Graph analysis | `Object.fromEntries` replaced unchecked type assertions | Low | `architectureLayers.ts` | — | — | lint ratchet | fixed |
| L-03 | Tests | PreBase test suites did not call `ensureNoDisposablesAreLeakedInTestSuite()` | Low | `test/browser/*.test.ts` | — | added | the leak detector itself | fixed |
| L-04 | Settings editor | inputs and the settings body share `#1B1C1E` | Low | measured from the running product | the sunken-input model is what keeps `input.placeholderForeground` at 4.5:1 | none — see below | — | deferred |
| M-10 | Graph | the legend is a tall fixed overlay that occludes the scene at small window sizes | Medium | `screenshots/08-graph.png` | pre-existing layout, not colour | none — layout work, out of scope for this pass | — | deferred |

## Deferred, with reasons

**L-04 — settings inputs share the body surface.** Raising
`settings.textInputBackground` to `#2B2B2B` would make the input well obvious,
but `input.placeholderForeground` (`#8b8b93`) drops from 5.04:1 to 4.18:1 on
that surface and fails WCAG 2.2 AA 1.4.3. The compliant alternative is a
brighter muted foreground, which changes line numbers, placeholders and
inactive Activity Bar icons everywhere; that is a foreground-ramp decision,
not a settings-editor decision, and it should be made with its own evidence.
Readability wins over affordance here, and the input keeps a `#ffffff2e`
border.

**M-10 — graph legend occlusion.** The legend is a fixed-height overlay in the
top-left of the canvas. At 1440×900 it covers roughly 8% of the scene. Fixing
it means making the legend collapsible or repositioning it, which is graph
layout work with its own UX decisions; this pass deliberately did not change
graph layout.

## Explicitly checked and found sound

These were audited and are **not** defects; recording them so the next pass
does not re-litigate them.

* **Preserved Architecture archive.** `graphs/src/preserved/**` is
  intentionally retained and is excluded from the active runtime, the typecheck
  lanes and the lint ratchet. It was not deleted and its exclusion is now
  consistent across all three gates.
* **Telemetry and crash reporting** remain disabled
  (`verify:privacy` asserts `enableTelemetry=false`).
* **Secrets** stay in `SecretStorage`; `verify:supabase-secrets` asserts no
  secret material in source.
* **Supabase RLS** — 5 migrations, 6 tables, all with RLS
  (`verify:supabase-migrations`, `verify:supabase-rls-static`).
* **Webview CSP** for the graph and runtime webviews is asserted statically by
  `verify:privacy`.
* **Application icons** — 101 protected files, byte-identical before and after
  the pass (`verify:icons`).
* **Dependencies** — no dependency was added, removed or upgraded in this
  pass. The TypeScript 7 / TypeScript 6 dual-lane setup is untouched.
