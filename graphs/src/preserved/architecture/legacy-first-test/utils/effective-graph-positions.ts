import type { GraphSnapshot, LayoutPosition } from '@core/types'

/** Merged layout positions (snapshot + user drag overrides). */
export function getEffectiveGraphPositions(
  snapshot: GraphSnapshot,
  userPositions: Record<string, LayoutPosition> = {}
): Record<string, LayoutPosition> {
  return { ...snapshot.positions, ...userPositions }
}
