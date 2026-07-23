# Graph settings map (beta audit)

Last updated: **2026-07-22** (One-Graph-Type: hide reserved no-op settings; Code Graph only).

Registration: `graphs/src/host/workbench/graphConfigurationContribution.ts`  
Keys: `graphs/src/common/configuration/graphConfigKeys.ts`  
Settings UI: `graphs/src/host/workbench/settings/graphSettingsUi.ts` (`graphs/src/settings/ui.ts` re-export)  
Registration barrel (DOM-free): `graphs/src/settings/index.ts`  
Shell (nav only): `src/vs/workbench/contrib/prebase/browser/prebaseSettingsEditor.ts`

| Setting ID | Default | UI | Runtime consumer | Status |
|---|---|---|---|---|
| `prebase.graph.defaultType` | code | hidden (`included:false`) | coerce → Code Graph | Migration only |
| `prebase.graph.defaultArchitectureLayout` | hierarchy | hidden (`included:false`) | **ignored** (Code Graph uses `networkLayoutMode`) | Deprecated |
| `prebase.graph.architectureMode` | — | hidden | **ignored** | Deprecated |
| `prebase.graph.networkLayoutMode` | community | Graph / Maps | `prebaseGraphService` layout | Wired |
| `prebase.graph.networkSpreadScale` | 1.2 | Graph (VS Code TOC) | layout sphere radius | Wired |
| `prebase.graph.initialZoom` | 0.92 | Graph | graph webview snapshot | Wired |
| `prebase.graph.showEdgeLabels` | false | hidden (`included:false`) | **ignored** (webview not wired) | Reserved |
| `prebase.graph.legendInteractionDim` | 40 | hidden (`included:false`) | **ignored** (webview not wired) | Reserved |
| `prebase.graph.reduceMotion` | false | Appearance | graph animations | Wired |
| `prebase.graph.quality` | balanced | Performance | scan/render budgets | Wired |
| `prebase.graph.layoutAnimationDuration` | 750 | Advanced | fit-view | Wired |
| `prebase.graph.layerRadiusScale` | 1 | hidden | **ignored** (Arch layout removed) | Deprecated |
| `prebase.graph.maxNodesPerLayer` | 24 | hidden | **ignored** | Deprecated |
| `prebase.graph.layerGap` | 96 | hidden | **ignored** | Deprecated |
| `prebase.graph.centerClearance` | 80 | hidden | **ignored** | Deprecated |
| `prebase.graph.scatterRelaxIterations` | 10 | hidden | **ignored** | Deprecated |
| `prebase.graph.folderExpansionRadius` | 82 | hidden | **ignored** | Deprecated |
| `prebase.graph.visibleRelatedConnections` | 1 | Advanced | layout ranking | Wired |
| `prebase.graph.networkIdleAutoRotate` | false | Advanced | Code Graph webview | Wired |
| `prebase.graph.maxRenderedNodes` | 280 | Advanced | snapshot filter | Wired |
| `prebase.interaction.networkDragDirection` | natural | Interaction | network drag | Wired |
| `prebase.interaction.panSensitivity` | 1 | hidden | — | Reserved |
| `prebase.interaction.zoomSensitivity` | 1 | hidden | — | Reserved |
| `prebase.interaction.nodeDragDelayMs` | 200 | hidden | — | Reserved |
| `prebase.graph.renderThrottleMs` | 0 | hidden | — | Reserved |
| `prebase.graph.networkLodNodeThreshold` | 900 | hidden | — | Reserved (OGT-006) |
| `prebase.graph.networkSimulationTicks` | 80 | hidden | — | Reserved |
| `prebase.graph.networkPhysicsStrength` | 1 | hidden | — | Reserved |
| `prebase.graph.networkEdgeOpacity` | 0.55 | hidden | — | Reserved |
| `prebase.graph.networkForceStrength` | 0.35 | hidden | — | Reserved (was falsely relayouting) |
| `prebase.graph.networkLinkDistance` | 80 | hidden | — | Reserved (was falsely relayouting) |
| `prebase.graph.networkCharge` | -120 | hidden | — | Reserved |
| `prebase.graph.networkCollisionRadius` | 24 | hidden | — | Reserved |
| `prebase.graph.networkAlphaDecay` | 0.02 | hidden | — | Reserved (was falsely relayouting) |
| `prebase.graph.showMinimap` | false | hidden (`included:false`) | stub | Deferred BETA-020 |

Do not expose reserved settings as fully working. Prefer hide or wire before calling them production-ready.
Arch layout keys remain registered for migration only — they must not drive Code Graph layout.
