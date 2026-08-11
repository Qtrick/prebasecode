# Code Graph 3D layout research

Date: 2026-08-10  
Scope: active Network Graph's Canvas 2D renderer with perspective projection.

## Evidence and decision

The prior Organic layout seeded `z`, but its collision/repulsion, link springs, centre pressure, and final bounds used only `x` and `y`. That leaves the seed depth visually disconnected from the solved layout and is the direct cause of a rotating slab.

The selected implementation is the existing deterministic custom solver, corrected to apply every force and bound in XYZ. It retains its bounded iteration count and static coordinates after layout: no continuous physics or permanent animation loop is introduced.

Measured on this host (Node v24.17.0, five samples, median): Organic 100 nodes is 11.62 ms and 500 nodes is 344.78 ms. This is a CPU-layout microbenchmark, not an FPS or memory claim. The previous recorded 500-node figure in `GRAPH_PERFORMANCE.md` was about 307 ms on a prior run, so the depth-correct implementation is accepted for correctness and needs further large-graph/render profiling before performance completion.

## Options evaluated

| Option | Decision | Reason |
|---|---|---|
| Correct the custom solver | Chosen | Small deterministic change, no dependency or renderer replacement, existing node limits make its bounded O(n²) pass suitable for the current product envelope. |
| `d3-force-3d` | Deferred | It offers established 1D/2D/3D force primitives and a simulation lifecycle, but adds a dependency and integration/cancellation surface without evidence that the current bounded solver is the limiting issue. |
| Three.js / WebGL / 3d-force-graph | Rejected for this pass | Current Canvas renderer already projects, depth-sorts, and parks RAF while static. A renderer rewrite would add GPU/context lifecycle risk without a measured Canvas bottleneck. |
| Barnes-Hut / octree | Deferred | Worth revisiting only after measured 1,000+ node layout evidence shows the O(n²) solver is a user-visible blocker. |

## Principles adopted

- Graphify's local-first graph processing, degree prominence, confidence-aware edges, and focused exploration are appropriate principles; its HTML renderer is not ported. Graphify documents deterministic local AST parsing and edge provenance, and distinguishes extracted from inferred edges.
- Vis Network's stabilization model supports retaining coordinates once a layout settles rather than consuming idle CPU continuously.
- `d3-force-3d` confirms that a force simulation can run in three dimensions; PreBase keeps its lighter deterministic implementation for now.
- Orbit-style controls inform bounded pitch and frame-rate-independent idle movement. Manual pointer rotation remains separate from optional idle motion.
- Neo4j Bloom reinforces search, selection, and inspection as navigation alternatives to purely spatial interaction.

## Sources

- [Graphify source](https://github.com/Graphify-Labs/graphify)
- [vis-network physics](https://visjs.github.io/vis-network/docs/network/physics.html)
- [d3-force-3d](https://github.com/vasturiano/d3-force-3d)
- [3d-force-graph](https://github.com/vasturiano/3d-force-graph)
- [Three.js OrbitControls](https://threejs.org/docs/pages/OrbitControls.html)
- [Neo4j Bloom scene interactions](https://neo4j.com/docs/bloom-user-guide/current/bloom-visual-tour/bloom-scene-interactions/)

## Validation still required

The unit suite now verifies deterministic finite 3D positions, a non-flat Organic Z variance, high-degree hub centrality in XYZ, and malformed dangling links. A real GUI matrix (drag, pitch, reduced motion, high-DPI, screenshots, FPS, memory) remains required for BETA-004/BETA-024.
