# Graph settings ownership

## Canonical definitions (`graphs/`)

| Artifact | Path |
|---|---|
| Configuration keys enum | `graphs/src/common/configuration/graphConfigKeys.ts` |
| Registry contribution | `graphs/src/host/workbench/graphConfigurationContribution.ts` |
| Public package surface | `graphs/src/settings/index.ts` |

`registerPreBaseGraphConfiguration()` is invoked from allowlisted `prebaseConfiguration.ts` (mixed PreBase bootstrap). **Do not** register `prebase.graph.*` keys twice.

## Settings UI (allowlisted host shell)

The **PreBase Settings** editor graph category (`_renderGraph`, interaction sliders, performance controls) lives in:

`src/vs/workbench/contrib/prebase/browser/prebaseSettingsEditor.ts`

This is intentional per [OWNERSHIP.md](../OWNERSHIP.md) and [docs/MIGRATION.md](../docs/MIGRATION.md#bootstrap-allowlist-outside-graphs). The shell:

- Imports `PreBaseGraphConfigKeys` from `prebaseConfiguration.ts` (re-export of graph keys only).
- Uses `IPreBaseGraphService` for session layout mode display.
- Does **not** duplicate default values — defaults remain in `graphConfigurationContribution.ts` property schema.

**Extraction target (post-beta or BETA-001):** move graph panel DOM builders into `graphs/src/settings/` as a workbench-facing helper; keep thin registration in `prebaseSettingsEditor.ts`.

## Defaults single source

| Concern | Source of truth |
|---|---|
| JSON schema defaults | `graphConfigurationContribution.ts` |
| Reset-all key list | `PREBASE_GRAPH_RESETTABLE_CONFIG_KEYS` in `graphConfigKeys.ts`, composed into `PREBASE_RESETTABLE_CONFIG_KEYS` in `prebaseConfiguration.ts` |
| VS Code Settings TOC | `settingsLayout.ts` + graph channel id `prebaseGraph` |

Run `npm run verify:config-uniqueness` after adding keys or commands.
