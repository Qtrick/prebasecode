# PreBase graphs package

The active PreBase **Code Graph** implementation. **All graph-owned code must live under this directory** (see [OWNERSHIP.md](./OWNERSHIP.md) and `.cursor/rules/graphs-ownership.mdc`). The compatible internal identifier remains `network`; preserved Architecture assets are dormant reference material, not an active product surface (see [PRESERVED_ARCHITECTURE.md](./PRESERVED_ARCHITECTURE.md)).

## Current status (2026-07-21, Phase A Settings UI + shim removal)

**Migration:** Core, layouts, host adapters, graph settings registration (`graphConfigurationContribution.ts`), graph Settings UI (`settings/graphSettingsUi.ts`), and graph commands (`graphContribution.ts`) live under `graphs/src/`. Workbench compiles them through a symlink bridge (see below). Legacy `common/graph/`, graph-only `browser/*`, and Phase D flat `core/*.ts` shims are **removed**.

| Role | Path |
|---|---|
| Shared types & constants | `graphs/src/common/types/`, `graphs/src/common/constants/`, `graphs/src/common/configuration/` |
| Settings keys + `registerPreBaseGraphConfiguration` | `graphs/src/host/workbench/graphConfigurationContribution.ts` (re-exported from `graphs/src/settings/`) |
| Settings UI panels | `graphs/src/host/workbench/settings/graphSettingsUi.ts` |
| Command IDs + `registerPreBaseGraphContribution` | `graphs/src/commands/graphCommandIds.ts`, `graphs/src/host/workbench/graphContribution.ts` |
| Scanning, parsing, resolution, generation, analysis | `graphs/src/core/{scanning,parsing,resolution,generation,analysis}/` |
| Architecture & network layouts | `graphs/src/layouts/` (`shared/`, `architecture/`, `network/`) |
| Architecture interaction (pick/hit-test) | `graphs/src/architecture/interaction/` |
| Host (editors, webview, services) | `graphs/src/host/workbench/` |
| Unit tests | `graphs/src/tests/unit/` (`architecturePick`, `networkLayout`, `graphOwnershipBoundary`) |
| Boundary verifier | `graphs/scripts/verify-boundary/verify.mjs` → `npm run verify:graphs-boundary` |

**Still allowlisted outside `graphs/` (thin bootstrap only):** `prebase.contribution.ts` imports `registerPreBaseGraphContribution()`; `prebaseConfiguration.ts` imports `registerPreBaseGraphConfiguration()` and owns runtime/home/terminal-visibility keys; `prebaseSettingsEditor.ts` is the Settings **shell** (routes graph panels into `graphSettingsUi.ts`). See [docs/MIGRATION.md](./docs/MIGRATION.md).

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
