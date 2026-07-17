# PreBase

PreBase is an AI-assisted desktop IDE and code visualization platform. It combines a full VS Code workbench with interactive codebase maps, in-IDE runtime preview, and an Agents chat panel.

PreBase is a fork of **Visual Studio Code / Code - OSS 1.128**. Upstream workbench, chat modes, and editor platform behavior come from that release (local source archive: `VSCode 1.128.0.zip`). PreBase-specific product code lives mainly under `src/vs/workbench/contrib/prebase/` and `extensions/prebase-magnus/`.

## Naming: Agents vs Magnus

In the **UI and docs**, the AI assistant is called **Agents**.

In the **codebase**, many filenames, package names, setting identifiers, and command IDs still use **Magnus** (for example `extensions/prebase-magnus/`, `prebase.magnus.open`, `magnus.png`). That is intentional: rename the product label, not the file tree.

| You see in the app | Lives in the repo as |
|--------------------|----------------------|
| Agents | `extensions/prebase-magnus/` |
| Agents commands | `prebase.magnus.*` |
| Agents settings | `prebase.magnus.*` |

---

## What PreBase adds

These layers are **not** stock Code - OSS:

| Feature | What it is |
|--------|------------|
| **Home** | Landing page with native recent projects |
| **PreBase Maps** | Architecture & Network graphs of your workspace |
| **Runtime Preview** | In-IDE localhost preview for Vite / Next / similar apps |
| **Agents** | AI chat (Ask / Edit / Agent) wired through the VS Code 1.128 chat stack |
| **Account** | Optional sign-in from the Activity Bar Accounts control |
| **PreBase Settings** | Maps, runtime, themes, and graph interaction |

---

## Chat modes (use VS Code’s picker — not a separate “Intent”)

VS Code 1.128 exposes chat capability through the built-in mode / agent picker in the chat input (**Ask**, **Edit**, **Agent**). That is the product model PreBase should follow ([VS Code chat](https://code.visualstudio.com/docs/copilot/chat/chat-agent-mode), [agents overview](https://code.visualstudio.com/docs/agents/overview)).

The original PreBase prototype used a custom five-way **Ask / Plan / Edit / Test / Agent** “intent-like” mode picker beside the model dropdown. That felt clunky next to the workbench: two vocabularies, two pickers, and Plan/Test sat outside VS Code’s `ChatModeKind`.

**Recommendation for users and contributors:**

1. Pick mode in the **Agents / Chat** input toolbar (Ask / Edit / Agent).
2. Prefer custom agents / prompts for specialized Plan or Test workflows later — same picker surface as VS Code, not a second QuickPick.
3. In PreBase Settings, **Node drag hover delay** only controls graph node dragging, not chat mode. (Older builds labeled this “Intent.”)

Legacy note: `Agents: Select Mode` and `prebase.magnus.defaultMode` still exist for compatibility with the prototype. Prefer the VS Code mode picker.

---

## Quick start (from source)

```bash
# Install dependencies (first time)
npm install

# Fast build: transpile client + extensions + Agents extension
npm run build-fast

# Or full compile
npm run compile

# Launch PreBase with an isolated profile
./scripts/code.sh
```

| Script | Purpose |
|--------|---------|
| `npm run watch` | Watch client, extensions, and Agents extension |
| `npm run typecheck-client` | Typecheck the workbench |
| `npm run compile-magnus` | Build the Agents (`prebase-magnus`) extension only |
| `./scripts/code.sh` | Run the desktop app |

User data for this build lives under `.prebase` / `.prebase-shared` (see `product.json`).

---

## Feature guides

### 1. Home & recent projects

1. Launch PreBase and open a folder once (`File → Open Folder…`).
2. Command Palette → **PreBase: Open Home**.
3. Click a recent project, or use **Open Folder** from Home.

Recent lists use the **native** workbench history (same as File → Open Recent).

---

### 2. PreBase Maps (Architecture & Network)

- **Architecture** — layers and file relationships (Hierarchy / Pyramid / Scattered).
- **Network** — spatial 3D-ish view (Organic, Sphere, Constellation, Clustered, Radial) with drag-to-rotate, scroll-to-zoom, and optional idle spin (off by default).

**Try it:**

1. Open a folder with source files.
2. Open **PreBase Maps** in the Activity Bar.
3. Run **PreBase: Scan Workspace** (or open Architecture / Network from the palette).
4. Switch layouts from Maps chips or PreBase Settings.
5. Empty-space drag rotates the Network graph; adjust **Network drag direction** under PreBase Settings → Interaction if it feels reversed.
6. **PreBase: Fit Graph View** / **Reset Graph View** if the camera drifts.

Large repos: lower max rendered nodes/edges in PreBase Settings if the map feels heavy.

---

### 3. Node descriptions

Selecting a graph node shows a structural overview plus an optional AI description when a compatible Agents model is available.

---

### 4. Runtime Preview

Detects common front-end stacks, starts `dev` / `start`, and loads localhost in an in-IDE preview. Prefer **Start** over Connect when nothing is listening yet. Vite projects typically use `http://localhost:5173`.

---

### 5. Agents (AI)

Agents is PreBase’s default frontier-model-backed chat participant on the VS Code 1.128 chat stack. Open it from the **Agents** view in the auxiliary bar, Home, or Command Palette → **Agents: Open**.

#### Using Agents with Maps / Runtime

- Attach graph selection or runtime context from Maps / Runtime actions.
- Prefer Ask / Edit / Agent from the chat mode picker.

---

### 6. Account & settings

- **Accounts / profile** at the bottom of the Activity Bar: Sign In / Create Account when `prebase.account.apiBaseUrl` is set.
- Account sessions are independent from the Agents model service.
- **PreBase: Open PreBase Settings** for themes, maps, runtime, and interaction.

---

## Repository layout (PreBase-focused)

```
src/vs/workbench/contrib/prebase/   # Home, Maps, Runtime, account, settings, graphs
extensions/prebase-magnus/          # Agents extension (Magnus = historical code name)
product.json                        # Branding, Agents default chat wiring
scripts/code.sh                     # Launch desktop PreBase from source
```

Upstream editor, terminal, git, and chat shell still come from the Code - OSS 1.128 tree (`src/vs/`, `extensions/`). Local comparison archive: `VSCode 1.128.0.zip`.

---

## Extension gallery (Open VSX only)

PreBase **does not** use the Visual Studio Marketplace. Marketplace Terms of Use restrict that service to Microsoft’s binaries; OSS forks must not point `extensionsGallery` at `marketplace.visualstudio.com`.

| Surface | Source |
|---------|--------|
| Extensions view (search / install / update) | [Open VSX Registry](https://open-vsx.org/) via `product.json` → `extensionsGallery` |
| Built-in debug helpers (`js-debug`, …) | GitHub release VSIXes from each extension’s `repo` field |
| Web workbench embeds (`build/vite`, `build/rspack`) | Same Open VSX endpoints |

Verify locally:

```bash
node build/assert-open-vsx.mjs
```

Not every Marketplace extension is mirrored on Open VSX. Prefer Open VSX listings, publisher mirrors, or installing a VSIX from an open-source release. Do not re-point `product.json` at Microsoft’s gallery.

---

## Development notes

- Prefer workbench services (configuration, editor panes, webview `postMessage`). Do not invent a second recents DB or fake signed-in state.
- After editing `src/`, run `npm run transpile-client` or `npm run watch` so `out/` stays current.
- Agents extension changes: `npm run compile-magnus` (or `watch-magnus`).
- Coding expectations: `.cursor/rules/prebase-development.mdc` and `.github/copilot-instructions.md` when present.

---

## License

PreBase builds on [Code - OSS (microsoft/vscode)](https://github.com/microsoft/vscode) components licensed under the [MIT](LICENSE.txt) license. See `LICENSE.txt` and third-party notices in the repository.

Copyright for PreBase-specific contributions: PreBase contributors. Upstream Code - OSS portions: copyright their respective authors (including Microsoft Corporation for the original Code - OSS project).
