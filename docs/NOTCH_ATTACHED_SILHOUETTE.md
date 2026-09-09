# Notch-Attached Silhouette (Broad-Top Design)

## Problem
The expanded Magnus Live Activity appeared as a floating black card because the expanded path started at `(0, effShoulderR)` and curved upward to the housing, creating a narrow neck (~185pt at y=14) with top-attachment-to-body ratio ~0.53.

## Solution
Redesigned the expanded path to a broad-top geometry where the top spans the full body width and the shoulders are shallow concave curves (6pt radius) that carve downward from the top corners.

### Key Changes

**`native/prebase-live-activity/src/live_activity.mm`:**

1. **Expanded path** (`CreateNotchedIslandPath` expanded branch): Top-left `(pad, 0)` → full-width top to `(pad+totalW, 0)` → shallow 6pt shoulder curving to body walls `(pad+totalW, shoulderDrop)` → body walls → bottom corners. 14-element path topology preserved for CAShapeLayer morph compatibility.

2. **Shoulder metrics** (`ComputeSilhouetteShoulderMetrics`): Simplified to always return `effR = 6.0`. Old `kExpandedShoulderRMin` (22.0) and `kExpandedShoulderRMax` (40.0) removed.

3. **Composer centering**: Added `PrebaseCenteredTextFieldCell` subclass that overrides `drawingRectForBounds:` for vertical text centering in the composer NSTextField.

4. **Dead space reduction**: `kContentMinScrollHeight` reduced from 40 to 24pt, `kFooterReserved` increased from 36 to 55pt (matches actual `kControlHeight + kBottomCornerRadius + 5`).

5. **Naked "+0" hidden**: `compactMetricsLabel` payload only includes additions when `additions > 0`.

**`src/vs/workbench/contrib/prebase/test/browser/magnusLiveActivity.test.ts`:**

- 8 new tests: broad-top path geometry, shallow shoulder radius, top-attachment ratio=1.0, morph compatibility, nonDegenerateShoulder, stable content insets, shallow shoulder drop, degenerate topology curve

### Verification
- 133 unit tests: all passing
- Static contract: all passing
- Live acceptance: native diagnostics confirm `shoulderFlare=6`, `effShoulderR=6`, `nonDegenerate=True` for all expanded states
- Icon integrity: 101/101 OK
- Graph boundary: OK
- Native binary: compiled with 2 warnings (unused `kOpticalShoulderInsetMin`, legacy `kExpandedWidthPad` alias)

### Open Items
- **Approval height limit**: Live acceptance fails with `approval panelFrame height (173pt) exceeds limit 165pt`. Pre-existing, not a regression. Needs either layout adjustment or validated limit update.
