# PreBase Agents Instructions

This repository is the PreBase IDE product (VS Code–based). Treat it as a first-party product, not a disposable upstream checkout.

## Required reading

- [Copilot / project instructions](.github/copilot-instructions.md) — architecture, coding guidelines, validation
- [Technology versions](docs/TECHNOLOGY_VERSIONS.md) — researched toolchain versions
- [TypeScript 7 migration](docs/TYPESCRIPT_7_MIGRATION.md) — compiler lanes and compatibility
- [Beta readiness backlog](docs/BETA_READINESS.md) — canonical beta blockers and validation
- [Assurance scripts](docs/ASSURANCE.md) — `npm run assurance` tiers and privacy/icon gates
- [Packaging](docs/PACKAGING.md) and [release signing](docs/RELEASE_SIGNING.md) — gulp tasks and PreBase signing preflight

## Persistent policies

1. **Version research** — Before upgrading compilers/runtimes/major tools, research official sources, report risks, baseline, then upgrade. See `.cursor/rules/version-upgrade-research.mdc`.
2. **Beta reminder** — Every final agent response must end with `Beta Readiness Reminder` sourced from `docs/BETA_READINESS.md`. See `.cursor/rules/beta-readiness-reminder.mdc`.
3. **Graph ownership** — All Architecture/Network graph implementation lives under root `graphs/`. See `.cursor/rules/graphs-ownership.mdc` and `graphs/OWNERSHIP.md`.
4. **Application icons** — Never modify Dock/application/installer icons or icon-selection product fields unless the user explicitly requests icon work.

## Graph subsystem

Public entrypoints and docs live under `graphs/` ([README](graphs/README.md), [OWNERSHIP](graphs/OWNERSHIP.md)). Authoritative graph sources are under `graphs/src/` (core + `host/workbench/`); the workbench compiles them via symlink `src/vs/workbench/contrib/prebase/graphs` → `graphs/src`. Settings registration and graph command registration remain in allowlisted `prebaseConfiguration.ts` and `prebase.contribution.ts` until extraction (BETA-001). Run `npm run verify:graphs-boundary` for boundary checks (BETA-002).
