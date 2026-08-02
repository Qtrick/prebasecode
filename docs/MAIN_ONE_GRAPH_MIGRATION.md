# MAIN → One Code Graph Migration Matrix

**Date:** 2026-08-01  
**Authoritative tree:** current MAIN working tree  
**Primary product reference:** git branch `One-Graph-Type` @ `6941d27b` (and archive `Prebasecode One Graph Type.zip`)  
**Visual card reference:** `PreBase First Test` ArchitectureNode (64×62 / entry 66)  
**MAIN archive:** `Prebasecode main (1).zip` (aligned with HEAD at migration start)

## Decision legend

| Action | Meaning |
|---|---|
| port | Take OGT behavior largely unchanged |
| adapt | Port semantics; keep MAIN dark-surface / kickRaf / fixes |
| retain | Keep current MAIN |
| preserve | Move/keep under `graphs/src/preserved/architecture/` |
| reject | Do not bring from OGT |

## High-priority matrix

| File / area | MAIN | OGT | First Test | Decision | Reason | Tests |
|---|---|---|---|---|---|---|
| `graphs/src/common/types/graphProduct.ts` | missing | present | n/a | port | Single product type + normalize | graphProduct.test |
| Analysis modules (communities, important, bridge, explain, surprising) | missing/partial | present | n/a | port | Graphify-inspired local analysis | unit suite |
| `graphQuery.ts` | missing | present | n/a | port | Scoped query | graphQuery.test |
| `communityForceLayout.ts` + network layouts | organic default | community default | n/a | port/adapt | Community Force default | networkLayout.test |
| `preserved/architecture/**` | active under layouts/ | preserved | legacy-first-test | preserve | Dormant assets; no runtime import | ownership boundary |
| Active `layouts/architecture`, `layouts/shared`, `dependencyDepth` | present | removed | n/a | remove from active | Ownership boundary | ownership test |
| `graphEditorInput.ts` | Arch/Net titles | Code Graph singleton | n/a | port | One editor | restore tests |
| `graphContribution.ts` | dual open cmds | `prebase.graph.open` | n/a | port | One command family | contribution |
| `prebaseMapsView.ts` | Arch/Net toggle + CSS vars | Code Graph sidebar + slate hex | n/a | adapt | OGT structure + MAIN theme tokens/color-mix | manual GUI |
| `graphEditor.ts` webview | dual Arch SVG + kickRaf | Code canvas only, permanent RAF | n/a | adapt | OGT Code path + MAIN kickRaf + **new morph** | morph unit + GUI |
| `presentation/selectedNodeCard.ts` | n/a | n/a | dims | **new** | Neutral card spec; no React Flow | selectedNodeCard.test |
| Home / onboarding / gettingStarted | dual CTAs | Code Graph | n/a | adapt | One CTA; keep MAIN CSS vars | GUI |
| Settings graph config | Arch knobs visible | deprecated/hidden | n/a | port | Hide Arch; keep keys | settings map |
| Runtime Preview / cloud / dark theme | MAIN newer | older / unrelated | n/a | retain/reject | Unrelated to graph product | assurance |
| Application icons | frozen | — | — | reject any change | Absolute prohibition | verify:icons |

## Morph (MAIN-only requirement)

OGT does **not** implement dot→card morph. MAIN adds:

- `graphs/src/presentation/selectedNodeCard.ts`
- Inlined morph state in `graphEditor.ts` webview (interruptible per-node `morphState`)
- Parked RAF via `kickRaf`

## Rejected from OGT

- Hardcoded slate `#1e293b` Maps colors (replaced with `--vscode-*` + color-mix)
- Permanent 60 Hz `requestAnimationFrame` loop
- Wholesale Runtime Preview / unrelated theme diffs
- React Flow as active renderer
