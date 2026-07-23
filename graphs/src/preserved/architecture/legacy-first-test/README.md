# Legacy First-Test Architecture / Graph snapshot

**Source archive:** `PreBase First Test main.zip` (commit `1b7bd8ad614d5db0979a6335616146df50312067`)  
**Product era:** Pre–VS Code PreBase (Vite + React renderer + optional Rust `prebase_core`)  
**Runtime status:** **Not imported. Not bundled. Not registered.**

## Why this tree exists

The current PreBase IDE graph lives under `graphs/` (VS Code workbench). Earlier One-Graph-Type work removed active Architecture product paths. The user-supplied First-Test archive still contains the original Architecture Graph React UI (pyramid/hierarchy labels, Architecture nodes/edges, dual Architecture/Network sidebars).

Those assets are preserved here so they are not lost, even though they are **incompatible** with the VS Code `graphs/` host (different React app, different store, different native graph.rs).

## Contents

| Area | Role |
|---|---|
| `components/` | Architecture/Network React canvas, legend, sidebar, toolbar |
| `features/architecture-graph/` | Architecture legend feature |
| `features/network-graph/` | Early Network layout engine / legend |
| `features/graph-shared/` | Shared zoom / legend shell |
| `utils/` | Architecture modes, edges, search, visibility |
| `state/graph-store.ts` | First-Test graph store |
| `core/` | Early graph generator + architecture layers |
| `native/graph.rs` | Rust graph helpers from First-Test (reference only) |

## Rules

1. Active Code Graph code must **not** import this directory.
2. Do not register these components in the workbench.
3. Do not treat this as a drop-in restore for `graphs/src/preserved/architecture/layouts/**` (those are the VS Code-era TypeScript layouts).
4. Future evaluation: extract algorithms/ideas only; rewrite against `graphs/` host APIs.

## Last verified

Recovered into this tree on 2026-07-22 during One-Graph-Type Architecture preservation pass.
