# Graph ownership boundary

PreBase **owns** the Architecture Graph and Network Graph product surface. Implementation ownership is centralized under repository root `graphs/`.

## In scope (must live under `graphs/`)

- Graph data model, parsing, import resolution, layout engines (`graphs/src/core/`, `graphs/src/layouts/`, `graphs/src/common/`)
- Architecture vs Network graph modes, picks, depth/layer visuals
- Graph settings definitions consumed by the IDE (graph-specific keys) — `graphs/src/common/configuration/`, `graphs/src/host/workbench/graphConfigurationContribution.ts`, re-exported from `graphs/src/settings/`
- Graph canvas interaction keys: `prebase.interaction.panSensitivity`, `zoomSensitivity`, `networkDragDirection`, `nodeDragDelayMs` (not `prebase.interaction.terminalVisibility.*`, which are workbench shell)
- Commands, keybindings, and Magnus tools that manipulate graph state — `graphs/src/commands/`, `graphs/src/host/workbench/graphContribution.ts`
- Webview/canvas rendering and interaction (zoom, drag, rotation, selection)
- Graph diagnostics, logging, and performance instrumentation
- Graph unit/integration tests and fixtures
- Graph-specific documentation and boundary verification scripts

## Out of scope (may remain in generic VS Code / workbench layers)

- File service, workspace trust, editor tabs, generic webview host
- Unrelated PreBase contrib (home, onboarding, runtime preview, settings shell)
- Generic configuration/registry infrastructure (graphs **register** into it)

## Adapters

Code that connects generic workbench services to graph APIs is **graph-owned** and belongs under `graphs/src/host/` (or subpaths).

Workbench compile bridge:

- `src/vs/workbench/contrib/prebase/graphs` → `../../../../../graphs/src` (symlink; no logic)

## Minimal host allowlist (outside `graphs/`)

These files may stay outside `graphs/` **only** as thin bootstrap or mixed PreBase shell. They must not contain graph algorithms, layout, parsing, or rendering rules.

| Path | Purpose |
|---|---|
| `src/vs/workbench/contrib/prebase/browser/prebase.contribution.ts` | Thin bootstrap: `registerPreBaseGraphContribution()` + runtime/home/settings/account |
| `src/vs/workbench/contrib/prebase/electron-browser/prebase.desktop.contribution.ts` | Desktop entry |
| `src/vs/workbench/workbench.common.main.ts` | Workbench entry import |
| `src/vs/workbench/workbench.desktop.main.ts` | Desktop workbench entry import |
| `src/vs/workbench/contrib/prebase/graphs` (symlink → `graphs/src`) | Build bridge; no logic |
| `src/vs/workbench/contrib/prebase/common/prebaseConfiguration.ts` | Mixed PreBase settings bootstrap; calls `registerPreBaseGraphConfiguration()`; terminal visibility + runtime/home keys only |
| `src/vs/workbench/contrib/prebase/browser/prebaseSettingsEditor.ts` | Settings UI shell; imports graph types/service from `../graphs/` |
| `src/vs/workbench/contrib/prebase/browser/prebaseIcons.ts` | Shared PreBase icons including Maps/Architecture/Network glyphs |
| Settings TOC / getting-started | Shell wiring to stable command IDs |
| `extensions/prebase-magnus` | Extension host; invokes `prebase.graph.*` command IDs |

Full table with review dates: [graphs/docs/MIGRATION.md](./docs/MIGRATION.md#bootstrap-allowlist-outside-graphs).

Any file not on this list that contains graph logic, state, or rendering is a **boundary violation**.

## Enforcement

- Script: `graphs/scripts/verify-boundary/verify.mjs` — `npm run verify:graphs-boundary` (repo root)
- Policy: `.cursor/rules/graphs-ownership.mdc`
- Agents: [AGENTS.md](../AGENTS.md) graph subsystem section

## Icons and branding

Graph UI may use codicons and in-app assets. **Application/Dock/installer icons** are out of scope for graph work; see AGENTS.md icon preservation policy.
