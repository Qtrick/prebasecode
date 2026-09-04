---
name: ui-ensemble
description: >
  Combine all available UI design skills and tools when creating, refining, or implementing interfaces. Use whenever the user asks for UI, UX, visual design, mockups, landing pages, app screens, dashboards, styling, design systems, banners, slides, or polish. For new UI, the agent decides whether a pen.dev canvas under .pen/ (and optional human review) is useful — skip it when the change is small or pattern-following. Orchestrates pen.dev with ui-ux-pro-max, design, design-system, ui-styling, frontend-design, design-taste-frontend, brand, slides, and banner-design.
---

# UI Ensemble

Use **all relevant UI tools together**. Do not pick a single skill and ignore the rest.

## Optional pen.dev canvas (agent decides)

For **new UI**, decide case-by-case:

| Prefer pen.dev + optional human review | Usually skip pen.dev |
|----------------------------------------|----------------------|
| Novel screens, landing/marketing, brand-sensitive layouts | Small copy/spacing/CSS tweaks |
| Multi-section dashboards / onboarding | Bug fixes, wiring existing components |
| User asked for a mockup / “what would it look like?” | Clear existing pattern to follow |
| Visual direction is ambiguous | Speed > mockup fidelity |

If you use pen.dev: store under `.pen/canvases/<slug>/`, show the preview, update `manifest.json` / `meta.json`. Ask for human review when the canvas is the decision artifact — not as a mandatory gate for every UI task.

See `.pen/README.md` when present.

## Why

| Layer | Skills / tools |
|------|----------------|
| Visual mockup (optional) | **pen-design** / pen.dev + `.pen/` store |
| Direction / anti-slop | `ui-ux-pro-max`, `design`, `design-taste-frontend`, `frontend-design` |
| Tokens / components / brand | `design-system`, `ui-styling`, `brand` |
| Specialized | `slides`, `banner-design` |

## Workflow

1. **Read the brief** — design read when taste skills apply.
2. **Decide** whether a pen.dev canvas helps; if yes, mock under `.pen/` and show the export (optionally pause for human feedback).
3. **Direct + systematize** — UX/taste + design-system/brand/styling.
4. **Implement** — from canvas when one exists; otherwise from brief + other UI skills.
5. **Fine-tune** — optional further pen.dev iteration if useful.

## Rules

- pen.dev is **additive and optional**, never mandatory or exclusive.
- Do not rewrite `pen --prompt` with invented design details.
- Commit canvas JSON (`design.pen`, `meta.json`, `manifest.json`); do not commit `.pen/previews` binaries — regenerate exports.
- If a listed skill is missing, skip it and continue with what is available.
