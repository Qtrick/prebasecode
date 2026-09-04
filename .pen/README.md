# `.pen/` — UI canvas store (project convention)

This directory is **our** storage for pen.dev UI canvases. It is not required by pen.dev itself.

## Research notes (official pen.dev)

| Fact | Source |
|------|--------|
| `.pen` is a **file format** (JSON canvas), not an official project folder | [pen.dev .pen files](https://docs.pen.dev/core-concepts/pen-files), [format](https://docs.pen.dev/for-developers/the-pen-format) |
| Keep design files **in the project workspace** next to code so agents can see both | [Design ↔ Code](https://docs.pen.dev/design-and-code/design-to-code) |
| CLI writes `--out` / reads `--in`; use `--workspace` for project context; `--export` for PNG/etc. | [pen.dev CLI](https://docs.pen.dev/for-developers/pen-cli) |
| Desktop/IDE may also keep local docs under `~/.pencil/documents/<uuid>/` — **do not rely on that for the repo** | local machine layout |

We use a project `.pen/` folder so Cursor, OpenCode, Windsurf/Devin, Antigravity, and Claude all share one canvas path.

## Layout

```
.pen/
  README.md                 # this file
  manifest.json             # registry + review status
  canvases/<slug>/
    design.pen              # source of truth (commit)
    meta.json               # prompt, status, timestamps
  previews/<slug>.png       # review exports (gitignored — regenerate)
  archive/                  # local throwaway scratch (gitignored; not durable)
  bin/gc.sh                 # prune regenerable media under previews/archive
```

## Storage policy (keep the repo small)

- **Commit:** `canvases/**/design.pen`, `canvases/**/meta.json`, `manifest.json`, this README
- **Do not commit:** `previews/**`, `archive/**` (PNG/PDF exports dominate disk; archive is local scratch)
- **Regenerate** previews anytime: `pen --in .pen/canvases/<slug>/design.pen --export .pen/previews/<slug>.png --export-scale 2`
- **One live canvas per slug** — prefer overwrite in place with `--in`/`--out` on the same `design.pen` (git history is the durable version store). Optional throwaway copies may go under `archive/` (gitignored; not durable).
- Run `.pen/bin/gc.sh` to delete regenerable preview/archive **media** (png/jpeg/webp/pdf). It does not delete `.pen`/`.json` files.

`.pen` JSON is typically small (KB–low MB). Exports are the expensive part.

## Optional canvas review (agent decides)

When implementing **new UI**, the agent decides whether a pen.dev canvas pass is worth it:

- **Use `.pen/` + human review** when the surface is visually novel, brand-sensitive, multi-section, or hard to judge from code alone — create under `.pen/canvases/<slug>/`, export a preview, set `status: "review"`, and ask the human before/while implementing as needed.
- **Skip pen.dev** for small tweaks, obvious follow-existing-patterns work, bug fixes, or when speed matters more than a mockup.

If a canvas is used: store it here, show the preview, and update `manifest.json` / `meta.json` statuses (`draft` → `review` → `approved` → `implemented`) as appropriate. Not every UI needs this path.

## Slug naming

Lowercase kebab-case: `settings-privacy`, `graph-empty-state`, `onboarding-welcome`.
