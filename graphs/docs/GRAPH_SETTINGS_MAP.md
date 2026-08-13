# Graph settings map (beta audit)

Last updated: **2026-08-12** (single Code Graph cleanup).

Registration: `graphs/src/host/workbench/graphConfigurationContribution.ts`  
Keys: `graphs/src/common/configuration/graphConfigKeys.ts`  
Settings UI: `graphs/src/host/workbench/settings/graphSettingsUi.ts` (`graphs/src/settings/ui.ts` re-export)  
Registration barrel (DOM-free): `graphs/src/settings/index.ts`  
Shell (nav only): `src/vs/workbench/contrib/prebase/browser/prebaseSettingsEditor.ts`

| Setting ID | Default | UI | Runtime consumer | Status |
|---|---|---|---|---|
| `prebase.graph.initialZoom` | 0.92 | Graph | graph webview snapshot | Wired |
| `prebase.graph.showEdgeLabels` | false | Graph | graph webview | Wired |
| `prebase.graph.reduceMotion` | false | Appearance | graph animations | Wired |
| `prebase.graph.quality` | balanced | Performance | edge animation | Wired |
| `prebase.graph.layoutAnimationDuration` | 750 | Advanced | fit-view | Wired |
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

Architecture-only settings (`defaultType`, `defaultArchitectureLayout`,
`architectureMode`, architecture legend/ring controls, and scatter controls)
are intentionally not registered. Existing user values are inert compatibility
data; the active product always opens the Code Graph.
