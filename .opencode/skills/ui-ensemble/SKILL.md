---
name: ui-ensemble
description: >
  Combine all available UI design skills and tools when creating, refining, or implementing interfaces. Use whenever the user asks for UI, UX, visual design, mockups, landing pages, app screens, dashboards, styling, design systems, banners, slides, or polish. Orchestrates pen.dev (visual generation) together with ui-ux-pro-max, design, design-system, ui-styling, frontend-design, design-taste-frontend, brand, slides, and banner-design — not as alternatives, but as a stack for stronger UI.
---

# UI Ensemble

Use **all relevant UI tools together**. Do not pick a single skill and ignore the rest.

## Why

Each skill covers a different layer:

- **pen-design / pen.dev** — generate visual mockups (`.pen` + image export) to explore and validate look
- **ui-ux-pro-max** — searchable styles, palettes, typography, UX guidelines, stack patterns
- **design / design-taste-frontend / frontend-design** — taste, anti-slop, page composition
- **design-system / ui-styling / brand** — tokens, components, brand consistency
- **slides / banner-design** — specialized marketing surfaces

Using only one produces generic or inconsistent UI. Ensemble fine-tuning produces better results.

## Workflow

1. **Read the brief** — declare a one-line design read when taste skills apply.
2. **Mock** — run `pen-design` with the user's prompt verbatim; show the export.
3. **Direct** — pull guidance from `ui-ux-pro-max` / design / taste skills that fit the brief.
4. **Systematize** — apply `design-system` / `brand` / `ui-styling` for tokens and implementation consistency.
5. **Implement** — code the UI against mockup + direction + tokens.
6. **Fine-tune** — iterate pen.dev (`--in`) and re-apply taste/system skills until quality is high.

## Rules

- pen.dev is **additive**, never exclusive.
- Do not rewrite the pen.dev `--prompt` with invented design details; keep the user's wording.
- If a listed skill is not installed in this environment, skip it and continue with what is available.
- Prefer loading this skill plus `pen-design` early in any UI/visual task.
