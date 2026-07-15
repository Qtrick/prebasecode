# PreBase IDE

PreBase is an AI-assisted desktop IDE and code visualization platform. It helps you write code, see how a project is structured as interactive graphs, preview running apps, and work with an in-editor AI assistant (Magnus).

PreBase is built on the open-source [Code - OSS / Visual Studio Code](https://github.com/microsoft/vscode) editor platform (MIT), with PreBase-specific workbench features layered on top. Upstream source and history live in that repository.

## What PreBase adds

These features are **not** part of stock Code - OSS / typical editor builds. They live mainly under `src/vs/workbench/contrib/prebase/` and `extensions/prebase-magnus/`.

| Feature | What it is |
|--------|------------|
| **Home** | PreBase landing page with native recent projects |
| **PreBase Maps** | Architecture & Network graphs of your workspace |
| **Runtime Preview** | In-IDE localhost preview for Vite / Next / similar apps |
| **Magnus** | Gemini-backed AI chat + graph file descriptions |
| **Account** | Optional sign-in from the Activity Bar Accounts / profile control |
| **PreBase Settings** | Dedicated settings for maps, runtime, themes, and graph behavior |

---

## Quick start (from source)

```bash
# Install dependencies (first time)
npm install

# Fast build: transpile client + extensions + Magnus
npm run build-fast

# Or full compile
npm run compile

# Launch PreBase with an isolated profile
./scripts/code.sh
```

Useful scripts:

| Script | Purpose |
|--------|---------|
| `npm run watch` | Watch client, extensions, and Magnus |
| `npm run typecheck-client` | Typecheck the workbench |
| `npm run compile-magnus` | Build the Magnus extension only |
| `./scripts/code.sh` | Run the desktop app |

Data for this build is stored under `.prebase` / `.prebase-shared` (see `product.json`), not the stock editor data folders.

---

## Feature guides

### 1. Home & recent projects

**What:** A PreBase Home editor that lists recent folders/workspaces using the **native** recent-projects service (same authority as File → Open Recent). No separate recents database.

**Try it:**

1. Launch PreBase and open a folder once (`File → Open Folder…`).
2. Command Palette → **PreBase: Open Home**.
3. Click a recent project to reopen it, or use **Open Folder** from Home.
4. Empty workspaces can auto-show Home when `prebase.home.openWhenEditorsEmpty` is enabled.

---

### 2. PreBase Maps (Architecture & Network)

**What:** Visual maps of your codebase.

- **Architecture graph** — layers and file relationships in Hierarchy / Pyramid / Scattered layouts.
- **Network graph** — 3D-ish spatial view (Organic, Sphere, Constellation, Clustered, Radial) with selection, pan/zoom, and optional idle rotation (off by default).

**Try it:**

1. Open a folder with source files.
2. Open the **PreBase Maps** view in the Activity Bar / sidebar.
3. Run **PreBase: Scan Workspace** (or open Architecture / Network from the palette).
4. Switch layout with the chips in Maps, or **PreBase: Switch Architecture Layout** / Network layout settings.
5. Click a node to select it; use the popup to open/reveal the file or attach context to Magnus.
6. **PreBase: Fit Graph View** / **Reset Graph View** if the camera drifts.

**Tips:**

- Large repos: lower max rendered nodes/edges in PreBase Settings if the map feels heavy.
- **PreBase: Show Graph Diagnostics** explains scan status and truncation.
- Empty projects show a helper to open a folder before scanning.

---

### 3. Node descriptions (Magnus-backed)

**What:** Selecting a graph node can show a short structural overview plus an optional AI description from Magnus.

**Try it:**

1. Configure Magnus (see below) with `GEMINI_API_KEY` in `.env`.
2. Open Architecture or Network, select a file node.
3. Read the overview; if Magnus is configured, an AI blurb appears (cached per file/content).
4. **PreBase: Regenerate Selected Node Description** forces a fresh AI pass.
5. **PreBase: Clear Graph Description Cache** drops cached blurbs.

Without an API key, the structural overview still works; AI text shows as unavailable.

---

### 4. Runtime Preview

**What:** Detects common front-end stacks (Vite + React, Next.js, etc.), starts the project’s `dev` / `start` script in a PreBase terminal, picks a sensible localhost URL (e.g. Vite → `:5173`), and shows the app in an in-IDE preview panel.

**Try it:**

1. Open a web app folder (`package.json` with `dev` / Vite / Next).
2. Open **Runtime Preview** from the Activity Bar / Maps-adjacent sidebar, or Command Palette → PreBase runtime commands.
3. Prefer **Start** so PreBase launches the detected script (not Connect alone with nothing listening).
4. When the server prints a local URL, PreBase auto-detects it and loads the preview.
5. Use the toolbar: Back / Forward / Reload / External / Copy URL; set viewport presets in Runtime / Settings.

**Tips:**

- **Connect** only marks “connected” when something is actually listening; if you see *Waiting…*, Start the server or fix the URL.
- Vite projects should default to `http://localhost:5173`, not `3000`.
- Preview runs in a workbench webview (localhost HTTP), similar to a dedicated browser panel.

---

### 5. Magnus AI

**What:** PreBase’s chat assistant (Ask / Edit / Agent participants) backed by Google Gemini. Keys are resolved from a gitignored `.env` (workspace or product root), not mixed with PreBase Account tokens.

**Setup:**

1. Add to the product or workspace `.env` (never commit this file):

   ```bash
   GEMINI_API_KEY=your_key_here
   ```

   `GOOGLE_API_KEY` is also accepted for Gemini.

2. Command Palette → **Magnus: Check Configuration** — you should see the key variable and `env-file` source (value is never shown in UI as a secret dump).
3. **Magnus: Open API Keys (.env)** opens the preferred `.env` for editing; save to hot-reload.
4. **Magnus: Open** opens chat; pick model/mode via **Magnus: Select Model** / **Select Mode**.

**Use with Maps / Runtime:**

- **Magnus: Attach Graph Selection** — after selecting a node in Maps.
- **Magnus: Attach Runtime Context** — attach preview/session context from Runtime Preview.
- Graph node descriptions call `prebase.magnus.describeFile` when Magnus is configured.

---

### 6. Account & settings

**Account**

- Use the **Accounts / profile** control at the bottom of the left Activity Bar.
- Menu options: **Sign In…**, **Create Account…**, and when signed in **Manage Account** / **Sign Out**.
- Requires a configured HTTPS `prebase.account.apiBaseUrl`. If unset, Sign In opens that setting (no fake local login).
- Magnus API keys and PreBase Account sessions are separate stores.
- First-run onboarding is deferred for now (source kept for a later release).

**Settings & themes**

- **PreBase: Open PreBase Settings** → Appearance for quick themes (PreBase + VS Code classics: Dark+, Light+, Abyss, Monokai, Solarized, …) or **Browse all themes…**.
- Or Command Palette → **Preferences: Color Theme** / search `prebase.` in Settings.

---

## Repository layout (PreBase-focused)

```
src/vs/workbench/contrib/prebase/   # Home, Maps, Runtime, account, settings, graphs
extensions/prebase-magnus/          # Magnus AI extension
product.json                        # PreBase branding & app identity
scripts/code.sh                     # Launch desktop PreBase from source
```

Core editor, terminal, git, and extension host behavior still come from the shared Code - OSS tree under `src/vs/` and `extensions/`.

---

## Development notes

- Prefer the existing workbench service patterns (configuration, editor panes, webview `postMessage`, SecretStorage). Do not introduce a second recents DB or fake signed-in state.
- After editing TypeScript under `src/`, run `npm run transpile-client` or `npm run watch` so `out/` stays in sync before launching.
- Magnus changes: `npm run compile-magnus` (or `watch-magnus`).
- Coding expectations for this tree: see `.cursor/rules/prebase-development.mdc` and `.github/copilot-instructions.md` when present.

---

## License

PreBase builds on [Code - OSS (microsoft/vscode)](https://github.com/microsoft/vscode) components licensed under the [MIT](LICENSE.txt) license. See `LICENSE.txt` and third-party notices in the repository for details.

Copyright for PreBase-specific contributions: PreBase contributors. Upstream Code - OSS portions: copyright their respective authors (including Microsoft Corporation for the original Code - OSS project).
