# Graph settings map (beta audit)

Last updated: **2026-07-21** (Phase A Settings UI extraction).

Registration: `graphs/src/host/workbench/graphConfigurationContribution.ts`  
Keys: `graphs/src/common/configuration/graphConfigKeys.ts`  
Settings UI: `graphs/src/host/workbench/settings/graphSettingsUi.ts` (`graphs/src/settings/ui.ts` re-export)  
Registration barrel (DOM-free): `graphs/src/settings/index.ts`  
Shell (nav only): `src/vs/workbench/contrib/prebase/browser/prebaseSettingsEditor.ts`

| Setting ID | Default | UI | Runtime consumer | Status |
|---|---|---|---|---|
| `prebase.graph.defaultArchitectureLayout` | hierarchy | Graph | `prebaseGraphService` / layout | Wired |
| `prebase.graph.initialZoom` | 0.92 | Graph | graph webview snapshot | Wired |
| `prebase.graph.showEdgeLabels` | false | Graph | graph webview | Wired |
| `prebase.graph.legendInteractionDim` | 40 | Graph | architecture legend | Wired |
| `prebase.graph.reduceMotion` | false | Appearance | graph animations | Wired |
| `prebase.graph.quality` | balanced | Performance | edge animation | Wired |
| `prebase.graph.layoutAnimationDuration` | 750 | Advanced | fit-view | Wired |
| `prebase.graph.layerRadiusScale` | 1 | Advanced | layout | Wired |
| `prebase.graph.maxNodesPerLayer` | 24 | Advanced | layout | Wired |
| `prebase.graph.layerGap` | 96 | Advanced | layout | Wired |
| `prebase.graph.centerClearance` | 80 | Advanced | layout | Wired |
| `prebase.graph.scatterRelaxIterations` | 10 | Advanced | layout | Wired |
| `prebase.graph.folderExpansionRadius` | 82 | Advanced | layout | Wired |
| `prebase.graph.visibleRelatedConnections` | 1 | Advanced | layout | Wired |
| `prebase.graph.networkIdleAutoRotate` | false | Advanced | network webview | Wired |
| `prebase.graph.maxRenderedNodes` | 280 | Advanced | snapshot filter | Wired |
| `prebase.interaction.networkDragDirection` | natural | Interaction | network drag | Wired |
| `prebase.interaction.panSensitivity` | 1 | Interaction | — | Reserved (honest label) |
| `prebase.interaction.zoomSensitivity` | 1 | Interaction | — | Reserved |
| `prebase.interaction.nodeDragDelayMs` | 200 | Advanced | — | Reserved |
| `prebase.graph.renderThrottleMs` | 0 | Advanced | — | Reserved |
| `prebase.graph.networkLodNodeThreshold` | 900 | Advanced | — | Reserved |
| `prebase.graph.networkSimulationTicks` | 80 | Advanced | — | Reserved |
| `prebase.graph.networkPhysicsStrength` | 1 | Advanced | — | Reserved |
| `prebase.graph.networkEdgeOpacity` | 0.55 | Advanced | — | Reserved |
| `prebase.graph.showMinimap` | (hidden) | — | stub | Deferred BETA-020 |

Do not expose reserved settings as fully working. Prefer hide or wire before calling them production-ready.
