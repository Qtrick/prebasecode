# Preserved Architecture Graph assets

**Status:** Unavailable in the PreBase app (One-Graph-Type / Code Graph only).  
**Policy:** These sources are **preserved**, not deleted. Do not re-wire them into the active runtime without an explicit product decision.

## Why this tree exists

Earlier One-Graph-Type experiment docs incorrectly treated Architecture Graph removal as “delete sources.” The corrected mandate is:

1. Architecture Graph must be **unavailable** in the product UI / open path.
2. Architecture implementation assets must remain under `graphs/src/preserved/architecture/`.
3. Active Code Graph must not import this tree.

## What lives here

See [ASSET_MANIFEST.md](./ASSET_MANIFEST.md) for original → preserved path mapping.  
See [LEGACY_SETTINGS.md](./LEGACY_SETTINGS.md) for deprecated settings / command aliases that remain registered for migration only.

Includes:

1. Dual-graph baseline TypeScript layouts / pick / shared helpers (via `git mv`).
2. `legacy-first-test/` — First-Test zip snapshot of older Architecture/Network React UI (pyramid labels, Arch components, legends). Archive only.

Pyramid / scattered are modes inside `layouts/hierarchy/hierarchyLayout.ts`, not separate source files.

Two eras are preserved:

1. **VS Code `graphs/` Architecture layouts** — `layouts/`, `interaction/`, `analysis/`, `tests/` (moved via `git mv` from active paths).
2. **First-Test Vite/React Architecture + early Network UI** — [`legacy-first-test/`](./legacy-first-test/) recovered from `PreBase First Test main.zip` (not a drop-in for the workbench host).

## Typecheck / compile policy

- Active package `graphs/tsconfig.json` **does not include** `src/preserved/**` (must not ship in runtime bundles).
- Non-production lane: `graphs/tsconfig.preserved-architecture.json` + `npm run typecheck:graphs-preserved` (root) / `npm run typecheck:preserved` (graphs package).
- Covers VS Code-era preserved `.ts` layouts/interaction/analysis only. Imports rewritten to shared `graphTypes` + active `architectureLayers` + local `dependencyDepth` / `layout*`.
- Preserved unit tests under `tests/` are kept for documentation but excluded from this lane (mocha globals; not run by `test:graphs`).
- `legacy-first-test/` is a Vite/React reference snapshot — never typechecked here.
- Not part of `assurance:quick` (intentional — archive lane, not runtime).

## Runtime rules

- Do **not** import from `graphs/src/preserved/**` in active host, layouts, core, or tests under `graphs/src/tests/unit/`.
- Active product paths must stay empty:
  - `graphs/src/layouts/architecture/`
  - `graphs/src/architecture/`
  - `graphs/src/layouts/shared/`
  - `graphs/src/core/analysis/dependencyDepth.ts`
  - `graphs/src/tests/unit/architecturePick.test.ts`
- `graphs/src/core/analysis/architectureLayers.ts` stays **active** (metadata enrichment for Code Graph).
- Preserved sources are excluded from the active `graphs/tsconfig.json` and are not run by `npm run test:graphs`.

## Restore / reactivation

To reactivate Architecture as a product later, move files back to their original paths (see ASSET_MANIFEST), re-enable Settings UI / commands, and update the boundary verifier. Prefer `git log --follow` on these paths for history.

Rollback SHA for the dual-graph baseline: `efabd9ed4abde12e0f79055cd63f0e5681c40abe`.
