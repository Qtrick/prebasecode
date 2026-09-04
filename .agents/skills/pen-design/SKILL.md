---
name: pen-design
description: >
  Create high-quality visual designs — websites, app screens, dashboards, slides, marketing materials, social media graphics — using the pen.dev CLI tool. Use this skill whenever the user wants to create, generate, or visualize any kind of UI design, mockup, wireframe, layout, webpage, app screen, presentation slide, poster, banner, or marketing asset. Also use it when the user says things like "design me a...", "make a visual for...", "create a mockup of...", "what would X look like?", or wants to turn an idea into a visual. During new UI implementation, the agent decides whether a pen.dev canvas under .pen/ (and optional human review) is useful — skip it for small or pattern-following work. Prefer combining pen.dev with other available UI skills (ui-ux-pro-max, design, design-system, ui-styling, frontend-design, design-taste-frontend, brand, slides, banner-design) — pen.dev is additive and optional, not exclusive or mandatory.
---

# pen.dev Design

Create professional visual designs from natural language descriptions using the pen.dev CLI. pen.dev is a headless design tool that generates `.pen` files (a structured JSON design format) and can export them as images.

## Optional canvas review (agent decides)

When implementing **new UI**, decide whether pen.dev helps:

- **Use it** for novel screens, brand-sensitive layouts, multi-section surfaces, or when a visual mockup would clarify direction — store under `.pen/canvases/<slug>/`, export a preview, update `manifest.json` / `meta.json`, show the image, and optionally ask the human to review before or during implementation.
- **Skip it** for small tweaks, bug fixes, wiring existing patterns, or when a mockup would add little value.

pen.dev is **not required** for every UI change. If `.pen/README.md` exists and you do create a canvas, follow its storage rules. If the folder is missing and you need a canvas, create the standard layout (see below).

## Project `.pen/` canvas store

Official pen.dev uses `.pen` as a **file extension**, not a required folder. Apps may also keep local docs in `~/.pencil/documents/` — do **not** use that for the repo.

**Project convention (all agents):** store canvases in workspace `.pen/`:

```
.pen/
  README.md
  manifest.json
  canvases/<slug>/design.pen
  canvases/<slug>/meta.json
  previews/<slug>.png          # gitignored — regenerate
  archive/                     # gitignored
  bin/gc.sh
```

**Storage (save disk):**

- Commit `design.pen`, `meta.json`, `manifest.json` (JSON is small).
- Do **not** commit PNG/PDF exports; regenerate with `--export`.
- One live canvas per slug; prefer overwrite in place with `--in`/`--out` (git history is durable). Optional throwaway copies may go under `archive/` (gitignored; not durable).
- Run `.pen/bin/gc.sh` to clear regenerable preview/archive **media** only (keeps `.pen`/`.json`).

**CLI paths example:**

```bash
slug="settings-privacy"
mkdir -p ".pen/canvases/$slug" ".pen/previews"
pen --workspace . \
  --out ".pen/canvases/$slug/design.pen" \
  --prompt "<user's exact request>" \
  --export ".pen/previews/$slug.png" \
  --export-scale 2
```

Then write/update `.pen/canvases/$slug/meta.json` and `.pen/manifest.json`.

### meta.json shape

```json
{
  "slug": "settings-privacy",
  "title": "Settings — Privacy",
  "status": "review",
  "prompt": "exact user prompt",
  "pen": ".pen/canvases/settings-privacy/design.pen",
  "preview": ".pen/previews/settings-privacy.png",
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601",
  "approvedAt": null,
  "implementedAt": null
}
```

Statuses: `draft` → `review` → `approved` → `implemented` (or `rejected`).

## Use alongside other UI tools

pen.dev is **one tool in the UI toolkit**, not a replacement for the others:

| Role | Skills / tools |
|------|----------------|
| Visual mockup / exploration | **pen.dev** (this skill) + `.pen/` store |
| Direction, anti-slop, layout intelligence | `ui-ux-pro-max`, `design`, `design-taste-frontend`, `frontend-design` |
| Tokens, components, brand | `design-system`, `ui-styling`, `brand` |
| Specialized surfaces | `slides`, `banner-design` |

When a canvas exists: implement with taste/system/styling skills using that `.pen` + preview as a visual reference. Also load `ui-ensemble`.

## Setup

Before designing, make sure the pen.dev CLI is available.

### Check installation

```bash
which pen || npx pen version
```

If `pen` is not found, install it:

```bash
npm install -g @pen.dev/cli
```

If global install fails due to permissions, install locally instead:

```bash
npm install @pen.dev/cli
```

Then run it via `npx pen` (or `./node_modules/.bin/pen`) instead of `pen`.
You can learn about the available commands via the `pen --help` command.

### Authentication

#### pen.dev user

To use the CLI, an authenticated user logged in to pen.dev is required. First, check
the current user configuration on the machine with the `pen status` command.

If not logged in, there are the following options:

- use `pen signup --email you@example.com --username johndoe --name "John Doe"` command, to create a new user.
- use `pen login --email you@example.com [--code abc123]` to authenticate an existing or newly created user.
- optionally, the `PEN_CLI_KEY` env var can also be used for authentication if its set in your session.

#### Claude Code agent

The CLI needs auth to run its AI agent for which Claude Code is required. For that
there needs to be an authenticated Claude Code user set in the system configuration
either via env var or a user subscription.

If none of these are available, tell the user what options they have and help them set one up.

### Staying up to date

This skill stays in sync with the **pen.dev CLI npm package** (`@pen.dev/cli`). The published package includes `SKILL.md` at its root; the package version is the skill version.

**Check for a newer CLI / skill**

- Latest version on the registry: `npm view @pen.dev/cli version`
- Installed CLI: `pen version`, or `npm list -g @pen.dev/cli` (global) / `npm list @pen.dev/cli` (project)

**Upgrade the CLI**, then refresh copied skill files if they are not symlinked to `~/.agents/skills/pen-design`.

**When to check for an update:** once early in the session before the first pen.dev run; again if the user upgraded the CLI or flags look wrong.

## Creating a Design

```bash
pen --workspace . --out <output.pen> --prompt "<design description>" --export <output.png> --export-scale 2
```

For project UI work, prefer paths under `.pen/` (see above).

Key flags:
- `--out, -o` — where to save the `.pen` file (required)
- `--prompt, -p` — what to design (required)
- `--prompt-file, -f` — attach an image or text file to send with the prompt (repeatable)
- `--export, -e` — export an image of the result
- `--export-scale` — image resolution multiplier (use 2 for crisp output)
- `--export-type` — format: `png` (default), `jpeg`, `webp`, `pdf`
- `--in, -i` — start from an existing `.pen` file (for iteration)
- `--workspace, -w` — workspace folder for agent context (use project root)
- `--model, -m` — Claude model to use (defaults to Opus)

### Passing the Prompt

Pass the user's request directly as the prompt — do not expand, or add detail beyond what the user actually said. The pen.dev CLI has its own AI designer agent that handles creative decisions. Adding your own design specifics on top of the user's request will conflict with the CLI agent and produce worse results.

### Timing Expectations

- **Simple:** 1-2 minutes · **Medium:** 2-3 minutes · **Complex:** 3-5+ minutes

Tell the user upfront. Use a generous timeout (at least 600000ms / 10 minutes).

### Showing the Result

After the command completes, read the exported PNG and show it. Always show the image when you created a canvas. Optionally ask for human feedback when that review would help — not as a mandatory stop for every UI task.

## Iterating on a Design

```bash
pen --workspace . --in .pen/canvases/<slug>/design.pen --out .pen/canvases/<slug>/design.pen \
  --prompt "Make the header larger and change the accent color to green" \
  --export .pen/previews/<slug>.png --export-scale 2
```

Update status in meta/manifest as you go (`draft` / `review` / `approved` / `implemented`) when tracking a canvas; no mandatory approval gate.

## Working Directory

Prefer `.pen/canvases/` for UI canvases. Do not use temp directories for work the user will review. Do not use `~/.pencil/documents/` for project canvases.
