# Code Graph Active-Surface Audit

Date: 2026-08-11

## Decision

PreBase exposes one active **Code Graph**, implemented by the former Network
renderer. It is the only graph surface with the supported 3D orbit interaction.
Architecture rendering, layout, and presentation code is retained as dormant
implementation material; it is not a user-selectable product surface.

## Active-surface reconciliation

| Former surface | Classification | Current behavior |
| --- | --- | --- |
| Default graph configuration | Active product | Defaults to Code Graph / Network renderer. |
| Graph editor input and restore | Legacy compatibility | Missing, malformed, `architecture`, and `network` persisted values normalize to the Code Graph input. |
| Maps sidebar | Active product | Offers one Code Graph action and Network 3D layout controls. |
| Home and onboarding | Active product | Offer Code Graph only. |
| Former Architecture open/switch commands | Legacy compatibility | No longer public or registered as product commands. |
| Architecture layouts, pick helpers, renderer code | Preserved dormant asset | Retained under `graphs/` for future selected-node/morph work; not routed by active UI. |
| Historical documentation | Documentation history | Kept where it accurately describes prior architecture. |

## Rotation consequence

Before this reconciliation, the default Architecture Graph opened a separate
renderer without Network's canvas orbit interaction. The Network renderer
already owned pointer capture, thresholded primary-pointer rotation,
perspective projection, and depth sorting. Routing active entry points to Code
Graph therefore fixes the product-path mismatch rather than introducing a
second camera system.

## Validation expectations

- Restored legacy graph tabs must converge on one Code Graph tab without a
  restore loop.
- Code Graph uses the Network `positions3d` layout data and its canvas accepts
  primary-pointer drag for rotation around the graph center.
- Architecture assets remain present but are not exposed through commands,
  settings, Home, onboarding, or Maps.
