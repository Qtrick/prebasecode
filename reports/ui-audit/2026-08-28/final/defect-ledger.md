# UI defect ledger — 2026-08-28

Grouped PreBase-owned issues found during Phase 3 closure. Stock Code OSS Accessibility Help is out of scope.

| ID | Surface | Sev | Problem | Root cause | Fix | Status |
|---|---|---|---|---|---|---|
| A1 | Code Graph | P0 | Alt/Option+F1 stole VS Code Accessibility Help | Graph key handler caught F1+alt | Local help is `?` + visible help button | Fixed |
| A2 | Settings / onboarding | P1 | Screen-reader help said app never optimized | Code OSS `auto` with no SR; PreBase did not force `off` | Core-ide acceptance records auto/on; no product default `off` | Fixed (evidence still needs live rerun) |
| U1 | Runtime / Test Lab | P1 | Equal-weight full-width button wall | Every action used the same button style | Primary/secondary tokens; Detect in session row; Reports shortened | Fixed |
| U2 | Web Search settings | P1 | Provider-centric Configure/Test/Clear walls | LinkUp/Firecrawl treated as primary UX | Hosted hybrid status first; local keys in `<details>` | Fixed |
| U3 | Maps | P2 | Five stacked layout buttons | Full-width layout rows | Wrapped chips; Live badge uses a CSS status dot | Fixed |
| U4 | Code Graph | P2 | Small graphs left unused canvas; zero-edge copy missing | Fit zoom capped at 1.6; status omitted empty-edge truth | Fit cap 3.2 for ≤10 nodes; informational zero-edge status; compact legend | Fixed |
| U5 | Temporal | P1 | Camera could reset after manual zoom/pan | Empty-diff flicker cleared `hasFittedTemporalView` | `userAdjustedViewport`; do not refit on state refresh | Fixed |
| U6 | Chrome glyphs | P2 | Raw ✕ / ⟳ / ● in chrome | Unicode used as control chrome | SVG close; “Reset all”; CSS live dot. ⇄ kept as data viz | Fixed |
| U7 | Settings / Home / Onboarding | P2 | `system-ui` and mixed button colors | Custom palettes instead of workbench tokens | `--vscode-font-family`; button tokens; Home primary stays brand teal | Fixed |
| U8 | Onboarding | P2 | Seven labeled pills crowded the progress row | Every step showed full name | Current step labeled; others numbered + title | Fixed |
| U9 | Themes / 200% / narrow | P1 | Incomplete live matrix | Prior audit had ~6 screenshots | Requires live walkthrough + `reports/ui-audit/2026-08-28/final/` | Open — live evidence |
