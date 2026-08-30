# Project Guidance Compatibility

PreBase Magnus discovers trusted, workspace-bound project guidance from common AI coding tool layouts. Discovery is **read-only**: no hooks, shell, MCP, remote fetches, or user-global `~/` configs. `allowed-tools` / permissions from ecosystems are **advisory metadata only** (`allowedToolsHint`) and never escalate PreBase approvals.

Setting: `prebase.magnus.projectGuidance.enabled` (default `true`).

Hard limits: workspace trust, path traversal blocking, secret scrubbing, `MAX_PROMPT_GUIDANCE_CHARS=16000`.

## Support matrix

| Artifact | Location | Ecosystem | PreBase behavior | Scope / activation | Security deviation | Support level |
|---|---|---|---|---|---|---|
| Agents hierarchy | `AGENTS.md`, `AGENTS.override.md` | Agents | Load hierarchical always guidance | Always (ancestor dirs for targets) | Workspace-bound only | Full |
| Copilot instructions | `.github/copilot-instructions.md` | GitHub | Always-on root guidance | Always | Secrets scrubbed | Full |
| GitHub path instructions | `.github/instructions/*.instructions.md` | GitHub | Path when `applyTo`/`globs` present; **manual when omitted** | Path / Manual | No remote | Full |
| GitHub prompts | `.github/prompts/*.prompt.md` | GitHub | Playbook catalog; activate via `activate_rule` | Manual | Advisory only | Catalog + activate |
| Cursor rules | `.cursor/rules/*.mdc`, `.cursorrules` | Cursor | `alwaysApply` / globs / description → always / path / intelligent / manual | Cursor modes | Workspace-bound | Full |
| Cursor commands | `.cursor/commands/*.md` | Cursor | Legacy playbooks (catalog) | Manual (`activate_rule`) | No auto inject | Catalog + activate |
| Cursor agents | `.cursor/agents/*.md` | Cursor | Agent profile catalog only | Catalog only | Bodies not injected | Catalog |
| Claude markdown | `CLAUDE.md`, `CLAUDE.local.md`, `.claude/CLAUDE.md` | Claude | Hierarchical always + `@` imports | Always | Absolute/`..` imports blocked | Full |
| Claude rules | `.claude/rules/**` | Claude | Path/`applyTo` or always | Path / Always | `claudeMdExcludes` applied first | Full |
| Claude settings | `.claude/settings.json`, `.claude/settings.local.json` | Claude | **Only** `claudeMdExcludes` merged | Exclude before load | Rest of settings ignored | Partial |
| Claude commands | `.claude/commands/*.md` | Claude | Playbook catalog | Manual (`activate_rule`) | No hooks | Catalog + activate |
| Claude agents | `.claude/agents/*.md` | Claude | Agent profile catalog only | Catalog only | Bodies not injected | Catalog |
| Gemini markdown | `GEMINI.md` + `context.fileName` | Gemini | Hierarchical always | Always | Absolute `@` blocked | Full |
| Gemini settings | `.gemini/settings.json` | Gemini | **Only** `context.fileName` | Extra filenames | Rest ignored | Partial |
| Gemini skills | `.gemini/skills/**/SKILL.md` | Gemini | Skill catalog / activate | Explicit activate | Metadata until activate | Full |
| Windsurf rules | `.windsurf/rules/**`, `.windsurfrules` | Windsurf | `always_on` / `glob` / `model_decision` / `manual` | Mapped modes | Workspace-bound | Full |
| Windsurf workflows | `.windsurf/workflows/*.md` | Windsurf | Playbook catalog | Manual | No auto | Catalog + activate |
| Devin rules | `.devin/rules/**` | Devin | Alias of Windsurf trigger mapping | Same as Windsurf | Workspace-bound | Alias |
| Devin skills | `.devin/skills/**/SKILL.md` | Devin | Skill catalog | Explicit activate | Content-hash dedupe | Full |
| Cline rules | `.cline/rules/**`, `.clinerules/**` | Cline | Always / path via globs | Always / Path | Workspace-bound | Full |
| Cline workflows | `.cline/workflows/*.md` | Cline | Playbook catalog | Manual | No auto | Catalog + activate |
| OpenCode config | `opencode.json`, `.opencode/opencode.json` | OpenCode | Local instruction paths/globs; remote URLs diagnostic only | Always (local) | No `~/.config/opencode`; no HTTP fetch | Partial |
| OpenCode skills | `.opencode/skills/**/SKILL.md` | OpenCode | Skill catalog | Explicit activate | Workspace-bound | Full |
| Kiro steering | `.kiro/steering/**/*.md` | Kiro | `inclusion` always / fileMatch / manual / auto; `#[[file:]]` workspace-bound | Mapped modes | No escape refs | Full |
| Kiro skills | `.kiro/skills/**/SKILL.md` | Kiro | Skill catalog | Explicit activate | Workspace-bound | Full |
| Codex skills | `.codex/skills/**/SKILL.md` | Codex | Skill catalog | Explicit activate | Content-hash dedupe | Full |
| Codex agents | `.codex/agents/*.md` | Codex | Agent profile catalog only | Catalog only | Bodies not injected | Catalog |
| Agents skills | `.agents/skills/**/SKILL.md` | Agents | Skill catalog | Explicit activate | Content-hash dedupe | Full |
| Cognition / Codeium skills | `.cognition/skills/**`, `.codeium/skills/**` | Cognition / Codeium | Skill catalog | Explicit activate | Content-hash dedupe | Full |
| Skill metadata | Skill `SKILL.md` frontmatter | Multi | Optional `argumentHint`, invocable flags, `allowedToolsHint`, triggers, license, compatibility, nested `metadata` map | Catalog filters `modelInvocable=false` from model prompt list | `allowed-tools` advisory only | Full |
| Private / user-global memory | `~/.…`, auto-memory | Multi | **Not imported** | — | Intentionally unsupported | Unsupported |

## Activation tool

`prebase_project_guidance` operations:

- `get_for_paths` — JIT path targets / delta
- `activate_skill` — load skill body after catalog selection
- `activate_rule` — activate intelligent/manual rules **or playbooks** by `rulePath`

## UI

Command **Agents: View Project Guidance** uses native Quick Pick groups: summary counters, Currently Applied, Path-Specific, On Demand, Skills, Playbooks, Agent Profiles, Diagnostics. Row descriptions include provenance (Always / Matches glob / Manual / Intelligent available / Catalog only).
