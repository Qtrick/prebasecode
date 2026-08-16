# PreBase — Internal Engineering Reference

> **Audience:** Engineers, contractors, and approved AI agents working on the PreBase codebase.
> This is not a public-facing README. External users and open-source contributors are not the target audience.

---

## What PreBase is

PreBase is an AI-assisted desktop IDE and code-visualization platform. It combines:

- A full VS Code workbench (forked from **Code - OSS 1.128**, commit-locked in `product.json`)
- **Architecture & Network Maps** — interactive codebase graphs rendered by the graph subsystem under `graphs/`
- **Runtime Preview** — in-IDE localhost preview for front-end dev servers
- **Agents** — AI chat participant backed by Google Gemini, wired through the VS Code 1.128 chat stack

PreBase is **not** an open-source release of VS Code. It is a commercial product with its own build, release, signing, and deployment pipeline. Do not treat it as a disposable upstream fork.

---

## Naming conventions

| You see in the UI | Lives in the codebase as |
|-------------------|--------------------------|
| **Agents** | `extensions/prebase-magnus/`, command prefix `prebase.magnus.*` |
| **Architecture / Network / Maps** | `graphs/` |
| **PreBase Settings** | `src/vs/workbench/contrib/prebase/browser/prebaseSettingsEditor.ts` |
| **PreBase (app name)** | `product.json` → `nameShort`, `nameLong`, `applicationName` |

The AI subsystem is called **Magnus** in the codebase (historical internal code name). The product label is **Agents**. File names and command IDs use `magnus`; UI copy uses `Agents`. Do not rename the file tree.

---

## Repository layout

```
src/vs/workbench/contrib/prebase/   # Home, Maps, Runtime, Account, Settings, graph host
extensions/prebase-magnus/          # Agents extension (AI chat + Code Graph descriptions)
graphs/                             # Architecture & Network graph subsystem (authoritative)
  src/                              # TypeScript source — single source of truth
  src/host/workbench/               # VS Code host integration
  scripts/                          # Boundary verifier, assurance helpers
scripts/
  code.sh                           # macOS / Linux launch from source
  code.bat                          # Windows launch from source
  startup/                          # verify-magnus-runtime.mjs and startup checks
  assurance/                        # Static verifier scripts
  privacy/                          # Privacy audit
  supabase/                         # Supabase migration validation
docs/
  TECHNOLOGY_VERSIONS.md            # Canonical toolchain version inventory
  BETA_READINESS.md                 # Canonical beta blocker backlog
  ASSURANCE.md                      # Assurance tiers and per-script documentation
  PACKAGING.md                      # gulp packaging tasks
  RELEASE_SIGNING.md                # PreBase signing preflight
  TYPESCRIPT_7_MIGRATION.md         # TS7 dual-lane architecture
product.json                        # Branding, extension allowlists, feature flags
build/icons/icon-integrity.sha256   # FROZEN — SHA-256 manifest for all platform icons
.github/copilot-instructions.md     # Authoritative coding and architecture guidelines
AGENTS.md                           # AI agent persistent policies
CONTRIBUTING.md                     # Internal engineering workflow
SECURITY.md                         # Security policy and vulnerability reporting
```

Upstream editor, terminal, git, and chat infrastructure come from Code - OSS 1.128 (`src/vs/`, `extensions/`). Source archive: `VSCode 1.128.0.zip`.

---

## Quick start (from source)

```bash
# Install dependencies — requires npm 11.x (see docs/TECHNOLOGY_VERSIONS.md)
npm install

# Fast build: transpile client + extensions
npm run build-fast

# Or full compile
npm run compile

# Launch PreBase from source (macOS/Linux)
./scripts/code.sh

# Launch PreBase from source (Windows)
scripts\code.bat

# Watch mode (incremental)
npm run watch

# Build only the Agents extension
npm run compile-magnus
npm run watch-magnus
```

User data lives under `.prebase` / `.prebase-shared` (configured in `product.json` → `dataFolderName`).

---

## Chat mode (Agents)

Agents uses the VS Code 1.128 built-in chat stack (**Ask**, **Edit**, **Agent** modes in the chat input toolbar). These are the authoritative chat surfaces.

Legacy: `Agents: Select Mode` and `prebase.magnus.defaultMode` exist for prototype compatibility (`ask`, `plan`, `patch`, `runtime`, `agent`). Prefer the VS Code mode picker for new work.

---

## Feature list

| Feature | What it is |
|---------|------------|
| **Home** | Landing page with native recent projects |
| **Architecture / Network Maps** | Architecture and network graphs of your workspace |
| **Runtime Preview** | In-IDE localhost preview for Vite / Next.js / similar apps |
| **Agents** | AI chat (Ask / Edit / Agent) wired through VS Code 1.128 chat stack |
| **Account** | Optional sign-in from the Activity Bar Accounts control |
| **PreBase Settings** | Maps, runtime, themes, and interaction settings |

---

## AI credential modes

Magnus resolves credentials in priority order based on the configured execution mode:

| Mode | Credential source |
|------|-------------------|
| `auto` (default) | PreBase repo root `.env` (source dev) → OS SecretStorage (BYOK) → Hosted (gated) |
| `development-env` | `GEMINI_API_KEY` from PreBase root `.env` only |
| `byok` | Gemini API key in OS SecretStorage via Agents Settings |
| `hosted` | **GATED** — infrastructure present, production chain not wired. Do not enable without product authorization. |

The secret resolver finds the PreBase repository root deterministically from `extensionPath`. `GEMINI_API_KEY` must be in the **PreBase repository root** `.env`, not a project workspace `.env`.

LinkUp (web search): separate BYOK key — `LINKUP_API_KEY` in root `.env` or configured via `Agents: Configure LinkUp Key…` in Agents Settings.

---

## Assurance tiers

Run the smallest relevant check first. See [`docs/ASSURANCE.md`](docs/ASSURANCE.md) for the complete reference.

| Command | What it proves |
|---------|----------------|
| `npm run verify:graphs-boundary` | Graph code stays under `graphs/` |
| `npm run verify:icons` | Application icons not tampered (101-path SHA-256 manifest) |
| `npm run verify:privacy` | Telemetry flags, forbidden endpoints, CSP, secret-storage patterns |
| `npm run verify:config-uniqueness` | No duplicate command IDs or config keys; includes manifest↔workbench cross-check |
| `npm run verify:prebase-magnus-manifest` | Magnus manifest ↔ product.json proposal allowlist parity |
| `npm run test:prebase-magnus` | Magnus unit tests |
| `npm run test:graphs` | Graph unit tests |
| `npm run typecheck-client` | Workbench TypeScript (TS 7) |
| `npm run assurance:quick` | Full quick static gate |
| `npm run verify:magnus-runtime` | Normal built-in launch smoke — requires all 10 lifecycle markers + `coreReady` |

> **Important:** `assurance:quick PASS` does **not** prove Agents works at runtime. Run `verify:magnus-runtime` separately.

---

## Application icons (FROZEN)

Do not modify icons, icon sources, or `build/icons/icon-integrity.sha256`. New icon artwork requires explicit product authorization and a separate manifest update PR.

---

## Graphs subsystem ownership

All Architecture/Network graph implementation lives under `graphs/`. The workbench compiles graph code via symlink. Run `npm run verify:graphs-boundary` before merging any graph change.

---

## TypeScript dual lanes

| Lane | Package | Binary | Used by |
|------|---------|--------|---------|
| Primary (TS 7) | `@typescript/native` → `typescript@7.0.2` | `tsc` | Typecheck, `typecheck-client`, `typecheck:graphs` |
| Compat API (TS 6) | `typescript` → `@typescript/typescript6@6.0.2` | `tsc6` | ESLint, `build/lib/*` API imports, test harnesses |

Run `npm run verify:typescript` to audit both lanes.

---

## Extension gallery

PreBase uses [Open VSX Registry](https://open-vsx.org/). Do not re-point `product.json` at `marketplace.visualstudio.com` (restricted to Microsoft binaries by VS Marketplace Terms).

---

## Beta readiness

Canonical beta blockers: [`docs/BETA_READINESS.md`](docs/BETA_READINESS.md).

Hosted AI (BETA-035) is **GATED**: infrastructure present, production deployment and authentication not wired.

---

## License

PreBase builds on [Code - OSS (microsoft/vscode)](https://github.com/microsoft/vscode) components licensed under the MIT License (`LICENSE.txt`). PreBase-specific contributions: copyright PreBase contributors. Upstream Code - OSS portions: copyright their respective authors (including Microsoft Corporation for the original Code - OSS project).
