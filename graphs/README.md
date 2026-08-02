# PreBase graphs package

**Code Graph** (Network-based) is the sole active graph product. Architecture Graph implementation is **preserved dormant** under `graphs/src/preserved/architecture/` (not registered at runtime). **All graph-owned code must live under this directory** (see [OWNERSHIP.md](./OWNERSHIP.md) and `.cursor/rules/graphs-ownership.mdc`).

## Current status (2026-08-01 — one Code Graph on MAIN)

| Role | Path |
|---|---|
| Product type + normalize | `graphs/src/common/types/graphProduct.ts` |
| Shared types & configuration | `graphs/src/common/types/`, `graphs/src/common/configuration/` |
| Settings registration | `graphs/src/host/workbench/graphConfigurationContribution.ts` |
| Settings UI | `graphs/src/host/workbench/settings/graphSettingsUi.ts` |
| Commands | `graphs/src/commands/graphCommandIds.ts`, `graphs/src/host/workbench/graphContribution.ts` |
| Scan / parse / generate / analysis / query | `graphs/src/core/` |
| Active layouts | `graphs/src/layouts/network/` (Community Force default + Organic/Sphere/…) |
| Selected-node card presentation | `graphs/src/presentation/selectedNodeCard.ts` |
| Preserved Architecture + First Test refs | `graphs/src/preserved/architecture/` |
| Host (editor, Maps sidebar, services) | `graphs/src/host/workbench/` |
| Unit tests | `graphs/src/tests/unit/` |
| Boundary verifier | `npm run verify:graphs-boundary` |

**Public command:** `prebase.graph.open` (Code Graph). Legacy `openArchitecture` / `openNetwork` redirect with `f1: false`.

**Still allowlisted outside `graphs/` (thin bootstrap only):** `prebase.contribution.ts`, `prebaseConfiguration.ts`, Settings shell. See [docs/MIGRATION.md](./docs/MIGRATION.md) and [docs/MAIN_ONE_GRAPH_MIGRATION.md](../docs/MAIN_ONE_GRAPH_MIGRATION.md).

### Workbench integration

Authoritative `.ts` under `graphs/src/` is compiled through the normal VS Code pipeline via:

`src/vs/workbench/contrib/prebase/graphs` → `../../../../../graphs/src`

Requires `preserveSymlinks: true` on the main `src/tsconfig.json` compile options (see [MIGRATION.md](./docs/MIGRATION.md)). Host modules with `vs/**` relative imports are typechecked via `npm run typecheck-client` through the symlink.

`graphs/tsconfig.json` is a **core-only** `noEmit` lane (`npm run typecheck` in this package). It does not typecheck host workbench adapters.

## Layout

```
graphs/
├── README.md
├── OWNERSHIP.md
├── package.json
├── tsconfig.json             # Core-only typecheck lane
├── src/
│   ├── common/               # graphTypes, fileTypeColors, configuration keys
│   ├── core/                 # scanning, parsing, resolution, generation, analysis
│   ├── layouts/              # architecture + network layout engines
│   ├── architecture/         # interaction helpers (e.g. pick)
│   ├── host/workbench/       # Workbench adapters + settings/graphSettingsUi.ts
│   ├── settings/             # Public settings re-exports
│   ├── tests/unit/           # Node/mocha unit tests
│   ├── index.ts              # Public core exports
│   ├── browser.ts            # Host re-exports (typechecked via main src/)
│   └── node.ts               # Node-safe core exports
├── scripts/
│   ├── verify-boundary/
│   └── verify-typescript-lanes.mjs
└── docs/
    ├── MIGRATION.md
    └── GRAPH_SETTINGS_MAP.md
```

## Workbench bootstrap (allowed outside `graphs/`)

Thin registration and mixed PreBase settings shell — full allowlist in [OWNERSHIP.md](./OWNERSHIP.md) and [MIGRATION.md](./docs/MIGRATION.md#bootstrap-allowlist-outside-graphs).

## Validation

- `npm run verify:graphs-boundary` (repo root) — graph boundary verifier (BETA-002).
- `npm run verify:typescript` (repo root) — dual-lane audit (TS7 `tsc` + TS6 API `tsc6`); exits non-zero if primary lane missing.
- `npm run typecheck:graphs` — graph **core** only (`common/`, `core/`, `layouts/`, `architecture/`).
- `npm run typecheck-client` — full workbench including graph host via symlink.
- `npm run test:graphs` — unit tests under `graphs/src/tests/unit/` (Node strip-types; no `out/` compile required).

## Related docs

- [Migration plan](./docs/MIGRATION.md) — inventory, symlink/build notes, extraction backlog
- [Beta readiness](../docs/BETA_READINESS.md) — graph migration blockers
- [Graph system rule](../.cursor/rules/graph-system.mdc) — behavior preservation checklist
