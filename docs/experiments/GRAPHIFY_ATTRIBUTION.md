# Graphify Attribution (ONE-GRAPH-TYPE experiment)

Canonical experiment docs: [`one-graph-type/README.md`](./one-graph-type/README.md) · research [`one-graph-type/GRAPHIFY_RESEARCH.md`](./one-graph-type/GRAPHIFY_RESEARCH.md)

## Status

| Question | Answer |
|---|---|
| Direct Graphify source code reused in PreBase? | **No** (as of Phase F–H core, 2026-07-22) |
| Concepts / architecture / UX patterns used? | **Yes** — see `one-graph-type/GRAPHIFY_RESEARCH.md` (conceptual only) |
| Graphify branding copied? | **No** — no logos, purple identity, marketing copy, product name in UI, or screenshots |
| Mandatory Graphify Python runtime? | **No** — **rejected** for this experiment |
| vis-network / Graphify HTML exporter ported? | **No** — **rejected**; keep PreBase Network renderer |
| OGT-013 (license/attribution plan) | Research + plan documented; **no adapted/copied source** — native TS reimplementation of concepts (communities/queries/confidence) with “inspired by Graphify MIT concepts” comments only |

## Upstream identity

| Item | Value |
|---|---|
| Project | Graphify (package `graphifyy`) |
| License | MIT |
| Copyright | Copyright (c) 2026 Safi Shamsi |
| Examined archive | 0.9.23 — SHA-256 `c9fc45c172865a170a399fe82370ed0defef2d6f3390edfac2360ac5a658febe` (re-verified 2026-07-22) |
| Upstream HEAD recorded | GitHub release **v0.9.24** (2026-07-22); site also lists 0.9.25 | Keep **0.9.23** pinned archive; do not silently replace |
| Canonical repository | https://github.com/Graphify-Labs/graphify |
| Releases pointer in archive changelog | https://github.com/safishamsi/graphify/releases |

## Adapted files

**None.** Phase F–H core modules (`communities.ts`, `importantNodes.ts`, `graphQuery.ts`, confidence fields) are PreBase-authored TypeScript. No Graphify Python/JS source was copied or ported line-for-line.

If/when PreBase copies or substantially adapts Graphify source or tests:

1. Preserve upstream copyright + MIT notice in the adapted file header.
2. List exact paths here with upstream commit.
3. Add notices to PreBase third-party notices / BETA-025 evidence.
4. Clearly mark PreBase modifications.

## Required notices (template when code is adapted)

```
Portions adapted from Graphify (https://github.com/Graphify-Labs/graphify)
Copyright (c) 2026 Safi Shamsi
Licensed under the MIT License.
```

## Confirmation

- PreBase Code Graph uses PreBase colors, typography, commands, Settings, and graph components.
- User-facing product name is **Code Graph**, not Graphify.
- Archive extraction lives only under ignored `.tmp/graphify-reference/` and must not be committed.
- Decision: **reimplement concepts in TypeScript**; do not vendor Python Graphify or vis-network.
