# Graph Node Morph Research — Code Graph selected-node card

**Date researched:** 2026-08-01  
**Branch:** `main`  
**Visual reference:** PreBase First Test `ArchitectureNode.tsx` + `flow-adapter.ts` (64×62 / entry 66)

Language: visual comfort and clarity — no medical claims.

---

## Sources

| Source | Principle | Decision | A11y | Perf | Test |
|---|---|---|---|---|---|
| MDN `requestAnimationFrame` | Time-based frames; pause in background | Drive morph with RAF + timestamps; park when idle | Reduced motion bypass | Stop scheduling when morphT settled | Large-delta clamp unit test |
| Pointer Events (W3C) | Capture, cancel, lostpointercapture | Selection vs drag thresholds; card hit region matches visual | Keyboard selection shares model | No permanent listeners beyond webview life | Hit-test + interruption tests |
| WCAG 2.2 / prefers-reduced-motion | Do not rely on motion alone | Snap or brief crossfade when reduce-motion | Required | Avoid idle animation | Reduced-motion path test |
| VS Code webview docs | Theme CSS vars, CSP, disposal | Card colors from `--vscode-*` / Night ladder; escape labels | HC themes flow | Dispose morph maps on close | Webview HTML CSP regression |
| First Test ArchitectureNode | Compact identity card | Extract geometry into `selectedNodeCard.ts`; no React Flow | Semantic inspector remains source of truth | One primary card only | Presentation interpolation tests |
| Detail-on-demand (graph UX) | Expand focus, keep others compact | Idle=dots; primary selected=card; secondary highlights stay dots | Avoid hundreds of Tab stops | Bound animating nodes to ≤2 | Rapid switch test |

---

## Implementation decisions

1. **One canvas representation** — interpolate width/height/radius/opacities; never swap in a disconnected popup as the node.
2. **morphT ∈ [0,1]** — interruptible; reverse from current progress.
3. **Screen-space target size** — ~64×62 CSS px at t=1; convert via current transform inverse scale when drawing in graph space.
4. **Content reveal** — icon ~0.25–0.55; label ~0.45–1.0 (fade before collapse).
5. **RAF park** — wake for morph/rotation/camera; clear completed zero-progress entries.
6. **No AI on expand** — inspector/local facts only; Magnus requires explicit action.

---

## Related modules

- Active: `graphs/src/presentation/selectedNodeCard.ts`
- Dormant reference: `graphs/src/preserved/architecture/legacy-first-test/components/nodes/ArchitectureNode.tsx`
