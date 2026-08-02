# Legacy Architecture settings & commands

Architecture Graph is **unavailable** in the app. The keys below remain registered for migration / coerce-to-Code-Graph only. Do not surface them in Settings UI.

Source of truth for registration: `graphs/src/host/workbench/graphConfigurationContribution.ts`  
Keys enum: `graphs/src/common/configuration/graphConfigKeys.ts`

## Deprecated settings (`included: false` unless noted)

| Key | Enum | Notes |
|---|---|---|
| `prebase.graph.defaultType` | `GraphDefaultType` | Enum still lists `architecture` / `network`; values coerce to `'code'`. Marked deprecated. |
| `prebase.graph.defaultArchitectureLayout` | `GraphDefaultArchitectureLayout` | hierarchy / pyramid / scattered — unused by Code Graph |
| `prebase.graph.layerRadiusScale` | `GraphLayerRadiusScale` | Arch ring tuning |
| `prebase.graph.maxNodesPerLayer` | `GraphMaxNodesPerLayer` | Arch ring overflow |
| `prebase.graph.layerGap` | `GraphLayerGap` | Arch ring spacing |
| `prebase.graph.centerClearance` | `GraphCenterClearance` | Innermost ring |
| `prebase.graph.scatterRelaxIterations` | `GraphScatterRelaxIterations` | Scattered layout |
| `prebase.graph.folderExpansionRadius` | `GraphFolderExpansionRadius` | Tree radial children |
| `prebase.graph.architectureMode` | `GraphArchitectureMode` | product/file/dependency/… slice filter |

## Command aliases (not a separate Architecture product)

| Command ID | Behavior |
|---|---|
| `prebase.graph.openArchitecture` | Opens **Code Graph** (`f1: false`) |
| `prebase.graph.openNetwork` | Opens **Code Graph** (`f1: false`) |
| `prebase.graph.open` | Canonical Code Graph open |

See `graphs/src/commands/graphCommandIds.ts` and `graphs/src/host/workbench/graphContribution.ts`.

## Coercion

`normalizeToCodeGraphType()` in `graphs/src/common/types/graphProduct.ts` always returns `'code'` for restore / serializer / open-path args.
