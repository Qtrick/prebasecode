# PreBase graphs package

Architecture Graph and Network Graph implementation for PreBase. **All graph-owned code must live under this directory** (see [OWNERSHIP.md](./OWNERSHIP.md) and `.cursor/rules/graphs-ownership.mdc`).

## Current status (2026-07-20, checkpoint 3+4)

**Migration:** Core and host sources live under `graphs/src/`. Workbench compiles them through a symlink bridge (see below). Legacy `common/graph/` and graph-only `browser/*` modules are **removed**.

| Role | Path |
|---|---|
| Core (parsing, layout, types) | `graphs/src/core/` (27 modules; flat layout for now) |
| Host (editors, webview, services) | `graphs/src/host/workbench/` |
| Unit tests | `graphs/src/tests/unit/` (`architecturePick`, `networkLayout`) |
| Boundary verifier | `graphs/scripts/verify-boundary/verify.mjs` → `npm run verify:graphs-boundary` |

**Not extracted yet (documented allowlist):** graph settings registration remains in `src/vs/workbench/contrib/prebase/common/prebaseConfiguration.ts`; graph commands/actions remain in `src/vs/workbench/contrib/prebase/browser/prebase.contribution.ts`. See [docs/MIGRATION.md](./docs/MIGRATION.md#bootstrap-allowlist-outside-graphs).

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
│   ├── core/                 # Graph algorithms, parsing, layout
│   ├── host/workbench/       # Workbench adapters (webview, services, maps)
│   ├── tests/unit/           # Node/mocha unit tests (run via workbench test harness)
│   ├── index.ts              # Public core exports
│   ├── browser.ts            # Host re-exports (typechecked via main src/)
│   └── node.ts               # Node-safe core exports
├── scripts/
│   ├── verify-boundary/
│   └── verify-typescript-lanes.mjs
└── docs/
    └── MIGRATION.md
```

## Workbench bootstrap (allowed outside `graphs/`)

Thin registration and mixed PreBase settings shell — full allowlist in [OWNERSHIP.md](./OWNERSHIP.md) and [MIGRATION.md](./docs/MIGRATION.md#bootstrap-allowlist-outside-graphs).

## Validation

- `npm run verify:graphs-boundary` (repo root) — graph boundary verifier (BETA-002).
- `npm run verify:typescript` (repo root) — dual-lane audit (TS7 `tsc` + TS6 API `tsc6`); exits non-zero if primary lane missing.
- `cd graphs && npm run typecheck` — graph **core** only.
- `npm run typecheck-client` — full workbench including graph host via symlink.

## Related docs

- [Migration plan](./docs/MIGRATION.md) — inventory, symlink/build notes, extraction backlog
- [Beta readiness](../docs/BETA_READINESS.md) — graph migration blockers
- [Graph system rule](../.cursor/rules/graph-system.mdc) — behavior preservation checklist
