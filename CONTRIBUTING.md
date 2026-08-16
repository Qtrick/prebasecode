# PreBase Internal Engineering & Contribution Guide

This guide describes the engineering workflow, repository boundaries, and quality requirements for engineers, contractors, and AI agents contributing to the PreBase codebase.

---

## 1. Engineering Workflow

1. **Workspace setup:** Clone the authorized repository. Verify runtime tooling against [docs/TECHNOLOGY_VERSIONS.md](docs/TECHNOLOGY_VERSIONS.md).
2. **Branching:** Create a focused feature/fix branch from `main`. Keep pull requests narrowly scoped.
3. **Dependencies:** Use `npm install` (requires npm 11.x). Do not introduce unvetted third-party runtime dependencies.
4. **Development loop:**
   - **Terminal 1:** `npm run watch` (incremental build)
   - **Terminal 2:** `./scripts/code.sh` (macOS/Linux) or `scripts\code.bat` (Windows)
5. **AI Agents:** Follow [AGENTS.md](AGENTS.md) and [.github/copilot-instructions.md](.github/copilot-instructions.md). Do not automatically stage, commit, or rewrite git history.

---

## 2. Core Repository Subsystems & Ownership

- **Code Graph (`graphs/`):** All Architecture/Network graph implementations live under `graphs/`. The workbench compiles them via symlink `src/vs/workbench/contrib/prebase/graphs` → `graphs/src`. Never modify graph files under `src/vs/` directly; modify `graphs/src/`. Verify with `npm run verify:graphs-boundary`.
- **Agents (`extensions/prebase-magnus/`):** First-party AI assistant. Command prefix `prebase.magnus.*`. Credential resolution uses OS SecretStorage and root `.env` for source dev.
- **Application Icons (FROZEN):** Do not modify Dock/app/installer icons or `build/icons/icon-integrity.sha256` without explicit authorization. Verified with `npm run verify:icons`.
- **Privacy & Telemetry:** Telemetry and crash reporting to third parties must remain disabled. Verified with `npm run verify:privacy`.
- **Extension Registry:** Open VSX only. Do not point `product.json` at Visual Studio Marketplace.

---

## 3. Pull Request Requirements

Every internal pull request must include:
- A clear summary of the problem, root cause, and technical solution.
- Exact commands executed and their verification status (PASS/FAIL).
- For UI/visual changes: manual verification evidence or screenshots from normal launch.
- Any impact on [docs/BETA_READINESS.md](docs/BETA_READINESS.md) or [docs/ASSURANCE.md](docs/ASSURANCE.md).

---

## 4. Verification & Quality Gates

Run the smallest relevant check first:

```bash
# Typecheck
npm run typecheck-client
npm run typecheck:graphs

# Unit tests
npm run test:prebase-magnus
npm run test:graphs

# Static & integrity assurance
npm run verify:graphs-boundary
npm run verify:icons
npm run verify:privacy
npm run verify:config-uniqueness
npm run verify:prebase-magnus-manifest
npm run assurance:quick

# Runtime verification (real PreBase launch in clean profile)
npm run verify:magnus-runtime
```

---

## 5. Security & Privacy Responsibilities

- Never commit secrets, tokens, API keys, or private workspace data.
- Maintain strict isolation between user project workspaces and PreBase application credentials.
- Report any security vulnerability following the internal procedure in [SECURITY.md](SECURITY.md).

