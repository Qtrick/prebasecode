# Network layout research — 2026-08

## Product decision

Sphere is **geometry-first**: every node occupies an approximately even
three-dimensional shell, with only a small bounded link-length correction.
Topology does not assign the radius.

Radial is **structure-first**: an entry node is the center; otherwise the
highest layout importance and then stable ID select the center. Undirected BFS
distance determines concentric 3D shells. Each disconnected component selects
its own importance root and occupies a stable outer sector. This makes graph
distance visible as radius rather than producing another spherical point cloud.

The radius of a radial shell is at least the configured link distance times its
layer index and is expanded when the layer's point capacity would violate the
configured node spacing. The entry root is pinned at the world origin; Radial
does not use centroid normalization afterward.

## Research matrix

| System | Relevant idea | PreBase decision |
|---|---|---|
| [yFiles RadialLayout](https://docs.yworks.com/yfiles-html/dguide/layout/radial_layout.html) | Center policy, BFS layers, parent sectors, minimum node/layer distance and capacity expansion | Adopt BFS center-out layers and capacity-aware shell radii; use deterministic sectors for disconnected components. We do not add yFiles or an edge router. |
| [D3 hierarchy tree](https://d3js.org/d3-hierarchy/tree) | Treat one coordinate as angle and one as radius; root can be fixed at origin | Adapt polar semantics to controlled 3D shells. We retain depth bands so the result remains volumetric rather than a flat tree. |
| [D3 forceCollide](https://d3js.org/d3-force/collide) | Nodes need center distance at least radius(a) + radius(b); bounded iterative relaxation has a runtime cost | Adopt the separation invariant with equal effective radii (`2 × collisionRadius`), bounded deterministic passes, and a final finite expansion fallback. |
| [d3-force-3d](https://github.com/vasturiano/d3-force-3d) | 3D force layouts can combine link and collision forces, but use iterative simulation | Adapt only the target-distance spring principle. Reject the dependency and an open-ended simulation: Radial remains deterministic, synchronous, and structure-first. |
| Graph analytics practice | Entries and degree/importance are useful structural center signals; components must be intentional | Adopt entry → importance → degree → stable-ID priority. No expensive centrality library is required for the existing capped workspace graph. |

## Constraints and safety

- No external layout dependency was added.
- Radial runs bounded BFS, bounded collision passes, and a single finite scale
  fallback. It does not recurse or search for empty slots indefinitely.
- Dangling links are ignored, all ordering is deterministic, and malformed IDs
  are only used as map keys/hash input.
- The configured maximum rendered-node cap remains the product-level bound.

## Settings truth

`networkCollisionRadius`, `networkLinkDistance`, and
`networkForceStrength` now reach `NetworkLayoutRuntimeConfig` and change
layout geometry. `networkCharge`, `networkAlphaDecay`,
`networkPhysicsStrength`, and `networkSimulationTicks` remain explicitly
reserved because this deterministic engine does not consume them.
