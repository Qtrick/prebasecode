---
trigger: model_decision
description: >
  Use when creating, refining, or implementing any UI, UX, mockup, visual design, landing page, app screen, dashboard, styling, banner, or slide. Combine UI skills; optionally use pen.dev under .pen/ when a canvas review would help — agent decides, not mandatory.
---

# UI Ensemble + optional pen.dev

1. Use the full UI skill stack as needed (`ui-ensemble`, ui-ux-pro-max, design, design-system, ui-styling, taste, brand, etc.).
2. **Agent decides** whether to mock in **pen-design** under `.pen/canvases/<slug>/` and whether to ask the human to review that canvas. Skip pen.dev for small/obvious UI work.
3. If a canvas is used: store in `.pen/` (not `~/.pencil/documents/`), show the preview, update manifest/meta. Commit canvas JSON (`design.pen`, `meta.json`, `manifest.json`); do not commit preview PNGs.
4. Keep `pen --prompt` as the user's words. pen.dev is additive, not exclusive.
5. Follow `.pen/README.md` when present.
