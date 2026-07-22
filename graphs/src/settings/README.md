# Graph settings ownership

## Canonical definitions (`graphs/`)

| Artifact | Path |
|---|---|
| Configuration keys enum | `graphs/src/common/configuration/graphConfigKeys.ts` |
| Registry contribution | `graphs/src/host/workbench/graphConfigurationContribution.ts` |
| Settings UI panels | `graphs/src/host/workbench/settings/graphSettingsUi.ts` |
| Public registration surface | `graphs/src/settings/index.ts` (DOM-free) |
| Public Settings UI surface | `graphs/src/settings/ui.ts` |
| Setting → UI/runtime map | [docs/GRAPH_SETTINGS_MAP.md](../docs/GRAPH_SETTINGS_MAP.md) |

`registerPreBaseGraphConfiguration()` is invoked from allowlisted `prebaseConfiguration.ts` (mixed PreBase bootstrap). **Do not** register `prebase.graph.*` keys twice.

## Settings UI ownership (Phase A complete)

Graph category panels live under `graphs/`:

`graphs/src/host/workbench/settings/graphSettingsUi.ts`

The allowlisted shell `prebaseSettingsEditor.ts` only:

- Routes Graph / Interaction (graph controls) / Performance / Advanced through `IPreBaseGraphSettingsUiHost`
- Keeps non-graph categories (Appearance chrome, Sidebar, Editor, Extensions, About) and **terminal visibility** toggles
- Uses `IPreBaseGraphService` for session layout / relayout via the host bridge
- Does **not** import or bind `PreBaseGraphConfigKeys`

## Defaults single source

| Concern | Source of truth |
|---|---|
| JSON schema defaults | `graphConfigurationContribution.ts` |
| Reset-all key list | `PREBASE_GRAPH_RESETTABLE_CONFIG_KEYS` in `graphConfigKeys.ts`, composed into `PREBASE_RESETTABLE_CONFIG_KEYS` in `prebaseConfiguration.ts` |
| VS Code Settings TOC | `settingsLayout.ts` + graph channel id `prebaseGraph` |

Run `npm run verify:config-uniqueness` after adding keys or commands.
