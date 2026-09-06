#include <napi.h>
#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>
#import <QuartzCore/QuartzCore.h>

// Dynamic geometry metrics — native is authoritative for production silhouette/layout.
static const CGFloat kCollapsedHeight = 34;
static const CGFloat kPeekBodyHeight = 32;
static const CGFloat kWingWidthMin = 52;
/** Fixed compact/peek wing widths — content text must not resize the notch island. */
static const CGFloat kStableCompactLeftWing = 64;
static const CGFloat kStableCompactRightWing = 64;
static const CGFloat kPillWidth = 228;
static const CGFloat kPillHeight = 30;
static const CGFloat kNotchMinSafeTop = 8;
static const CGFloat kNotchMinAuxWidth = 40;
static const CGFloat kCameraHousingMin = 24;
/** Pre-layout bootstrap — natural compact span (not the legacy 280×36 slab). */
static const CGFloat kBootstrapPanelWidth = kStableCompactLeftWing + kCameraHousingMin + kStableCompactRightWing;
static const CGFloat kBootstrapPanelHeight = kCollapsedHeight;
static const CGFloat kPillCornerRadius = 16;
static const CGFloat kShoulderRadius = 22;
static const CGFloat kBottomCornerRadius = 18;
/** Minimum optical top inset for expanded natural-width shoulders (no panel widen). */
static const CGFloat kOpticalShoulderInsetMin = 8;
static const CGFloat kOpticalShoulderInsetMax = 12;
/** Extra horizontal inset so text clears curved shoulders (path-aware safe region). */
static const CGFloat kContentSafeExtraX = 6;
/** Mandatory gutter between scroll content and footer controls (pt). */
static const CGFloat kContentFooterGutter = 8;

/** Content layout tokens — measured stacking with reserved footer. */
static const CGFloat kContentInsetX = 16;
static const CGFloat kContentInsetTop = 4;
static const CGFloat kContentGap = 3;
static const CGFloat kHeaderRowHeight = 16;
static const CGFloat kFooterReserved = 30;
static const CGFloat kControlHeight = 24;
static const CGFloat kIconControlSize = 24;
static const CGFloat kComposerCornerRadius = 7;
static const CGFloat kActionRowHeight = 15;
/** Max is an overflow guard; natural height is content-measured (never the default). */
static const CGFloat kExpandedHeightMax = 192;
static const CGFloat kExpandedHeightMin = 72;
/** Only widen past the natural notch span when option rows need horizontal room. */
static const CGFloat kExpandedWidthPad = 28;
static const NSTimeInterval kActionInFlightTimeout = 8.0;

static const NSTimeInterval kHoverDwellInterval = 0.18; // 180ms intentional acquisition
static const NSTimeInterval kExitGraceInterval = 0.25;  // 250ms hysteresis for movement into body

static NSDictionary *RectDict(NSRect r) {
	return @{
		@"x": @(r.origin.x),
		@"y": @(r.origin.y),
		@"width": @(r.size.width),
		@"height": @(r.size.height)
	};
}

static void ApplySystemSymbol(NSButton *button, NSString *symbolName, NSString *accessibilityLabel) {
	if (!button) {
		return;
	}
	button.accessibilityLabel = accessibilityLabel;
	if (@available(macOS 11.0, *)) {
		NSImage *image = [NSImage imageWithSystemSymbolName:symbolName accessibilityDescription:accessibilityLabel];
		if (image) {
			NSImageSymbolConfiguration *config = [NSImageSymbolConfiguration configurationWithPointSize:10.5 weight:NSFontWeightMedium];
			button.image = [image imageWithSymbolConfiguration:config];
			button.imagePosition = NSImageOnly;
			button.contentTintColor = [NSColor colorWithCalibratedWhite:0.82 alpha:1.0];
			button.title = @"";
			return;
		}
	}
	button.image = nil;
	button.imagePosition = NSNoImage;
	// Compact glyph fallback — full label stays on accessibilityLabel.
	button.title = @"•";
}

static CGFloat MeasureTextHeight(NSString *text, NSFont *font, CGFloat width, NSInteger maxLines) {
	if (!text.length || width <= 1 || maxLines <= 0) {
		return 0;
	}
	CGFloat lineH = ceil(font.ascender - font.descender + font.leading);
	if (lineH < 12) {
		lineH = font.pointSize + 4;
	}
	NSRect bounds = [text boundingRectWithSize:NSMakeSize(width, lineH * maxLines + 4)
		options:(NSStringDrawingUsesLineFragmentOrigin | NSStringDrawingUsesFontLeading)
		attributes:@{ NSFontAttributeName: font }];
	CGFloat h = ceil(NSHeight(bounds)) + (maxLines > 1 ? 2 : 0);
	return MIN(lineH * maxLines + 2, MAX(lineH, h));
}

/** Consistent horizontal content inset across expanded body (clears curved shoulders while aligning rows). */
static CGFloat ContentSafeInsetX(BOOL notched) {
	CGFloat base = kContentInsetX;
	if (!notched) {
		return base;
	}
	return base + kContentSafeExtraX;
}

/** Compact wing token — never arbitrary agent prose (matches TS compactWingLabel). */
static NSString *CompactWingLabelFromSnapshot(NSString *status, NSString *pendingKind, NSString *presentationLabel, NSString *testState) {
	if ([status isEqualToString:@"attention"]) {
		return [pendingKind isEqualToString:@"question"] ? @"Question" : @"Approve";
	}
	if ([status isEqualToString:@"failed"]) {
		return @"Failed";
	}
	if ([status isEqualToString:@"completed"]) {
		return @"Done";
	}
	if ([status isEqualToString:@"waiting"]) {
		return @"Waiting";
	}
	if ([status isEqualToString:@"disconnected"]) {
		return @"Offline";
	}
	if ([status isEqualToString:@"working"]) {
		return [testState isEqualToString:@"running"] ? @"Testing" : @"Working";
	}
	// Idle / unknown: accept short fixture aliases, never agent prose.
	if ([presentationLabel isEqualToString:@"Needs input"]) {
		return @"Question";
	}
	if ([presentationLabel isEqualToString:@"Approval needed"]) {
		return @"Approve";
	}
	if ([presentationLabel isEqualToString:@"Completed"]) {
		return @"Done";
	}
	if (presentationLabel.length > 0 && presentationLabel.length <= 9) {
		return presentationLabel;
	}
	return @"Magnus";
}

static NSString *FormatCompactElapsed(NSTimeInterval startedAtMsOrSec) {
	if (startedAtMsOrSec <= 0) {
		return @"";
	}
	NSTimeInterval nowMs = [[NSDate date] timeIntervalSince1970] * 1000.0;
	NSTimeInterval startedMs = startedAtMsOrSec;
	if (startedAtMsOrSec < 1e12) {
		// Seconds since epoch
		startedMs = startedAtMsOrSec * 1000.0;
	}
	NSTimeInterval elapsedSec = MAX(0, (nowMs - startedMs) / 1000.0);
	NSInteger totalSec = (NSInteger)floor(elapsedSec);
	NSInteger hours = totalSec / 3600;
	NSInteger minutes = (totalSec % 3600) / 60;
	if (hours > 0) {
		return [NSString stringWithFormat:@"%ldh", (long)hours];
	}
	if (minutes > 0) {
		return [NSString stringWithFormat:@"%ldm", (long)minutes];
	}
	return [NSString stringWithFormat:@"%lds", (long)MAX(1, totalSec)];
}

static NSInteger LiveActivityWindowLevel(void) {
	// Borderless panels at normal status/menu levels are clamped below the notch band.
	// kCGMaximumWindowLevelKey - 1 anchors safely to the physical bezel above the menu bar.
	return CGWindowLevelForKey(kCGMaximumWindowLevelKey) - 1;
}

static BOOL IsBuiltinScreen(NSScreen *screen) {
	NSNumber *screenNumber = screen.deviceDescription[@"NSScreenNumber"];
	if (!screenNumber) {
		return NO;
	}
	CGDirectDisplayID displayID = [screenNumber unsignedIntValue];
	return CGDisplayIsBuiltin(displayID);
}

static BOOL ScreenHasPhysicalNotch(NSScreen *screen) {
	if (!screen) {
		return NO;
	}
	NSEdgeInsets insets = screen.safeAreaInsets;
	NSRect auxLeft = screen.auxiliaryTopLeftArea;
	NSRect auxRight = screen.auxiliaryTopRightArea;
	return insets.top > kNotchMinSafeTop
		&& auxLeft.size.width > kNotchMinAuxWidth
		&& auxRight.size.width > kNotchMinAuxWidth
		&& NSMinX(auxRight) > NSMaxX(auxLeft);
}

struct PathElementRecord {
	CGPathElementType type;
	CGPoint points[3];
};

static std::vector<PathElementRecord> ExtractPathElements(CGPathRef path) {
	std::vector<PathElementRecord> elements;
	if (!path) {
		return elements;
	}
	std::vector<PathElementRecord> *elPtr = &elements;
	CGPathApplyWithBlock(path, ^(const CGPathElement *element) {
		PathElementRecord rec;
		rec.type = element->type;
		int pointCount = 1;
		if (element->type == kCGPathElementAddCurveToPoint) {
			pointCount = 3;
		} else if (element->type == kCGPathElementAddQuadCurveToPoint) {
			pointCount = 2;
		} else if (element->type == kCGPathElementCloseSubpath) {
			pointCount = 0;
		}
		for (int i = 0; i < pointCount; i++) {
			rec.points[i] = element->points[i];
		}
		elPtr->push_back(rec);
	});
	return elements;
}

static BOOL ValidatePathTopology(CGPathRef path1, CGPathRef path2) {
	auto el1 = ExtractPathElements(path1);
	auto el2 = ExtractPathElements(path2);
	if (el1.size() != el2.size() || el1.empty()) {
		return NO;
	}
	for (size_t i = 0; i < el1.size(); i++) {
		if (el1[i].type != el2[i].type) {
			return NO;
		}
	}
	return YES;
}

/** Shared shoulder metrics for path construction + diagnostics (single source of truth). */
typedef struct {
	CGFloat wingLeftX;
	CGFloat wingRightX;
	CGFloat flare;
	CGFloat opticalInset;
	CGFloat effShoulderR;
} SilhouetteShoulderMetrics;

static SilhouetteShoulderMetrics ComputeSilhouetteShoulderMetrics(
	CGFloat totalW,
	CGFloat depth,
	CGFloat leftW,
	CGFloat rightW,
	CGFloat housingW,
	BOOL isExpanded)
{
	SilhouetteShoulderMetrics metrics = {};
	CGFloat notchLeft = (totalW - housingW) * 0.5;
	CGFloat notchRight = notchLeft + housingW;
	CGFloat naturalLeft = MAX(0.0, notchLeft - leftW);
	CGFloat naturalRight = MIN(totalW, notchRight + rightW);
	metrics.wingLeftX = (!isExpanded) ? 0.0 : naturalLeft;
	metrics.wingRightX = (!isExpanded) ? totalW : naturalRight;
	CGFloat flareL = MAX(0.0, metrics.wingLeftX);
	CGFloat flareR = MAX(0.0, totalW - metrics.wingRightX);
	metrics.flare = MAX(flareL, flareR);
	if (isExpanded && depth > 0.5) {
		if (metrics.flare < 0.5) {
			// Optical shoulder within natural width — no panel widen, no square top corners.
			metrics.opticalInset = MIN(kOpticalShoulderInsetMax, MAX(kOpticalShoulderInsetMin, depth * 0.12));
			metrics.wingLeftX = metrics.opticalInset;
			metrics.wingRightX = totalW - metrics.opticalInset;
			metrics.flare = metrics.opticalInset;
		}
		metrics.effShoulderR = MIN(kShoulderRadius, MAX(10.0, metrics.flare * 0.85 + depth * 0.18));
	}
	return metrics;
}

static CGPathRef CreateNotchedIslandPath(CGFloat totalW,
                                        CGFloat currentH,
                                        CGFloat leftW,
                                        CGFloat rightW,
                                        CGFloat housingW,
                                        CGFloat bandH,
                                        BOOL isExpanded,
                                        BOOL isNotched) {
	CGMutablePathRef path = CGPathCreateMutable();
	const CGFloat kKappa = 0.5522847498307933984022516322796;

	if (!isNotched) {
		// Pill mode (no-notch screen fallback): 4 sides + 4 cubic bezier corner arcs
		CGFloat r = MIN(kPillCornerRadius, MIN(totalW * 0.5, currentH * 0.5));
		CGFloat kR = r * (1.0 - kKappa);

		CGPathMoveToPoint(path, NULL, r, 0);
		CGPathAddLineToPoint(path, NULL, totalW - r, 0);
		CGPathAddCurveToPoint(path, NULL, totalW - kR, 0, totalW, kR, totalW, r);
		CGPathAddLineToPoint(path, NULL, totalW, currentH - r);
		CGPathAddCurveToPoint(path, NULL, totalW, currentH - kR, totalW - kR, currentH, totalW - r, currentH);
		CGPathAddLineToPoint(path, NULL, r, currentH);
		CGPathAddCurveToPoint(path, NULL, kR, currentH, 0, currentH - kR, 0, currentH - r);
		CGPathAddLineToPoint(path, NULL, 0, r);
		CGPathAddCurveToPoint(path, NULL, 0, kR, kR, 0, r, 0);
		CGPathCloseSubpath(path);
		return path;
	}

	// TOPOLOGY-COMPATIBLE SINGLE CONTINUOUS CONTOUR
	// Exactly 1 subpath, 14 elements (1 MoveTo, 8 LineTo, 4 CurveTo, 1 CloseSubpath)
	// Expanded natural width keeps panel span, but insets the TOP edge so shoulders have
	// real lateral curvature (physical notch corners are never perfectly vertical).
	// Option-pad widenings add extra flare; collapsed/peek keep full-width top span.
	CGFloat depth = MAX(0.0, currentH - bandH);
	CGFloat effBottomR = MIN(kBottomCornerRadius, currentH * 0.42);
	CGFloat kBottom = effBottomR * (1.0 - kKappa);

	CGFloat notchLeft = (totalW - housingW) * 0.5;
	CGFloat notchRight = notchLeft + housingW;
	SilhouetteShoulderMetrics shoulder = ComputeSilhouetteShoulderMetrics(totalW, depth, leftW, rightW, housingW, isExpanded);
	CGFloat wingLeftX = shoulder.wingLeftX;
	CGFloat wingRightX = shoulder.wingRightX;
	CGFloat effShoulderR = shoulder.effShoulderR;

	// 0. Move to top-left of left wing (wingLeftX, 0)
	CGPathMoveToPoint(path, NULL, wingLeftX, 0);

	// 1. Line across top of left wing to notch start (notchLeft, 0)
	CGPathAddLineToPoint(path, NULL, notchLeft, 0);

	// 2. Line down into camera housing cutout (notchLeft, bandH)
	CGPathAddLineToPoint(path, NULL, notchLeft, bandH);

	// 3. Line across bottom of camera housing cutout (notchRight, bandH)
	CGPathAddLineToPoint(path, NULL, notchRight, bandH);

	// 4. Line up from camera housing cutout to notch end (notchRight, 0)
	CGPathAddLineToPoint(path, NULL, notchRight, 0);

	// 5. Line across top of right wing to right wing end (wingRightX, 0)
	CGPathAddLineToPoint(path, NULL, wingRightX, 0);

	CGFloat flareR = MAX(0.0, totalW - wingRightX);
	CGFloat flareL = MAX(0.0, wingLeftX);
	CGFloat shoulderBottomY = bandH + effShoulderR;

	// 6. Right organic shoulder: horizontal tangency at (wingRightX, 0), vertical at (totalW, shoulderBottomY)
	CGPathAddCurveToPoint(path, NULL,
		wingRightX + flareR * kKappa, 0,
		totalW, shoulderBottomY - effShoulderR * (1.0 - kKappa),
		totalW, shoulderBottomY);

	// 7. Line down right side to bottom-right corner start (totalW, currentH - effBottomR)
	CGPathAddLineToPoint(path, NULL, totalW, currentH - effBottomR);

	// 8. Bottom-right corner curve to (totalW - effBottomR, currentH)
	CGPathAddCurveToPoint(path, NULL,
		totalW, currentH - kBottom,
		totalW - kBottom, currentH,
		totalW - effBottomR, currentH);

	// 9. Line across bottom edge to bottom-left corner start (effBottomR, currentH)
	CGPathAddLineToPoint(path, NULL, effBottomR, currentH);

	// 10. Bottom-left corner curve to (0, currentH - effBottomR)
	CGPathAddCurveToPoint(path, NULL,
		kBottom, currentH,
		0, currentH - kBottom,
		0, currentH - effBottomR);

	// 11. Line up left side to left shoulder start (0, shoulderBottomY)
	CGPathAddLineToPoint(path, NULL, 0, shoulderBottomY);

	// 12. Left organic shoulder: vertical tangency at (0, shoulderBottomY), horizontal at (wingLeftX, 0)
	CGPathAddCurveToPoint(path, NULL,
		0, shoulderBottomY - effShoulderR * (1.0 - kKappa),
		wingLeftX - flareL * kKappa, 0,
		wingLeftX, 0);

	// 13. Close subpath
	CGPathCloseSubpath(path);
	return path;
}

static Napi::ThreadSafeFunction gCommandTsfn;
static bool gDisposed = false;

static NSString *JSString(Napi::Value value) {
	if (value.IsString()) {
		return [NSString stringWithUTF8String:value.As<Napi::String>().Utf8Value().c_str()];
	}
	return @"";
}

@class PrebaseLiveActivityController;

@interface PrebaseLiveActivityView : NSView
@property (nonatomic, strong) CAShapeLayer *shapeLayer;
@property (nonatomic, strong) CAShapeLayer *shapeMaskLayer;
@property (nonatomic, strong) NSView *compactContainer;
@property (nonatomic, strong) NSView *expandedContainer;
@property (nonatomic, strong) NSScrollView *contentScrollView;
@property (nonatomic, strong) NSView *contentDocumentView;

@property (nonatomic, strong) NSTextField *leftStatusLabel;
@property (nonatomic, strong) NSTextField *rightMetricsLabel;

@property (nonatomic, strong) NSTextField *headerTitle;
@property (nonatomic, strong) NSTextField *statusBadge;
@property (nonatomic, strong) NSTextField *activityDescription;
@property (nonatomic, strong) NSTextField *latestMessageLabel;
@property (nonatomic, strong) NSMutableArray<NSTextField *> *actionLabels;
@property (nonatomic, strong) NSMutableArray<NSString *> *actionRowIds;
@property (nonatomic, strong) NSTextField *pendingInteractionTitle;
@property (nonatomic, strong) NSTextField *pendingInteractionMessage;
@property (nonatomic, strong) NSTextField *expandedMetricsLabel;

@property (nonatomic, copy) NSString *statusLabel;
@property (nonatomic, copy) NSString *activityLabel;
@property (nonatomic, copy) NSString *latestMessage;
@property (nonatomic, copy) NSString *metricsLabel;
@property (nonatomic, copy) NSString *pendingTitle;
@property (nonatomic, copy) NSString *pendingMessage;
/** Stable action rows: @{ @"id": NSString, @"label": NSString, @"at": NSNumber? } */
@property (nonatomic, copy) NSArray<NSDictionary *> *actions;
@property (nonatomic, copy) NSString *status;
@property (nonatomic, assign) BOOL expanded;
@property (nonatomic, assign) BOOL targetExpanded;  // Explicit semantic target state
@property (nonatomic, assign) BOOL notched;
@property (nonatomic, assign) CGFloat housingWidth;
@property (nonatomic, assign) CGFloat safeAreaTop;
@property (nonatomic, assign) CGFloat leftWingWidth;
@property (nonatomic, assign) CGFloat rightWingWidth;
@property (nonatomic, assign) BOOL reducedMotion;
@property (nonatomic, assign) BOOL attention;
@property (nonatomic, assign) BOOL peekOnly;
/** Vertical space reserved for footer controls inside expandedContainer (set by controller). */
@property (nonatomic, assign) CGFloat reservedFooterHeight;
@property (nonatomic, strong) NSTrackingArea *trackingArea;
@property (nonatomic, weak) PrebaseLiveActivityController *controller;

- (void)updateShapeAndContentAnimated:(BOOL)animated duration:(NSTimeInterval)duration useTargetState:(BOOL)useTargetState;
- (void)updateShapeAndContentAnimated:(BOOL)animated duration:(NSTimeInterval)duration useTargetState:(BOOL)useTargetState targetSize:(NSSize)targetSize;
/// Text/label refresh that never cancels or snaps an in-flight geometry morph.
- (void)refreshContentSubviewsPreservingPresentation;
- (void)refreshContentSubviewsPreservingPresentationWithSize:(NSSize)layoutSize;
@end

@interface PrebaseLiveActivityController : NSObject
@property (nonatomic, strong) NSPanel *panel;
@property (nonatomic, strong) PrebaseLiveActivityView *content;
@property (nonatomic, strong) NSTextField *input;
@property (nonatomic, strong) NSButton *openButton;
@property (nonatomic, strong) NSButton *pinButton;
@property (nonatomic, strong) NSButton *approveButton;
@property (nonatomic, strong) NSButton *denyButton;
@property (nonatomic, strong) NSMutableArray<NSButton *> *optionButtons;
@property (nonatomic, copy) NSArray<NSDictionary *> *pendingOptions;
@property (nonatomic, assign) BOOL visible;
@property (nonatomic, assign) BOOL pinned;
@property (nonatomic, assign) BOOL screenLocked;
@property (nonatomic, assign) BOOL hovering;
@property (nonatomic, assign) NSUInteger hoverSessionToken;
@property (nonatomic, assign) BOOL actionInFlight;
@property (nonatomic, strong) NSTimer *actionInFlightTimer;
@property (nonatomic, assign) BOOL reducedMotion;
@property (nonatomic, assign) BOOL ignoresMouse;
@property (nonatomic, copy) NSString *sessionId;
@property (nonatomic, copy) NSString *sessionResource;
@property (nonatomic, assign) double revision;
@property (nonatomic, copy) NSString *interactionId;
@property (nonatomic, copy) NSString *pendingKind;
@property (nonatomic, assign) BOOL pendingDestructive;
@property (nonatomic, strong) id globalMonitor;
@property (nonatomic, strong) id localMonitor;
@property (nonatomic, strong) NSTimer *hoverTimer;
@property (nonatomic, strong) NSTimer *exitTimer;
@property (nonatomic, assign) NSRect collapsedHit;
@property (nonatomic, assign) NSRect lastRequestedFrame;
@property (nonatomic, copy) NSString *displayMode;
@property (nonatomic, copy) NSString *lastNativeCommand;
@property (nonatomic, weak) NSScreen *layoutScreen;
@property (nonatomic, weak) NSScreen *lastFocusedWorkScreen;
@property (nonatomic, assign) BOOL prebaseFullscreen;

@property (nonatomic, assign) BOOL lastInside;
@property (nonatomic, assign) BOOL didHoverHaptic;
@property (nonatomic, assign) BOOL didAttentionHaptic;
@property (nonatomic, assign) BOOL attentionPeek;
/** User Escape/collapse while attention: stay compact until click or attention clears. */
@property (nonatomic, assign) BOOL userDismissedAttention;
@property (nonatomic, assign) NSUInteger hapticCount;
@property (nonatomic, assign) NSUInteger hoverHapticCount;
@property (nonatomic, copy) NSString *lastHapticReason;
@property (nonatomic, assign) NSUInteger redrawCount;
@property (nonatomic, assign) NSUInteger animationCount;
@property (nonatomic, assign) NSUInteger geometryTransitionCount;
@property (nonatomic, assign) NSUInteger contentOnlyUpdateCount;
@property (nonatomic, assign) NSUInteger contentRefreshCount;
@property (nonatomic, assign) NSUInteger orderFrontCount;
@property (nonatomic, assign) double lastRenderedRevision;
@property (nonatomic, copy) NSString *lastTransitionReason;
@property (nonatomic, copy) NSString *lastGeometrySignature;
@property (nonatomic, assign) CGFloat pinnedInteractiveHeight;
@property (nonatomic, assign) BOOL transitionInFlight;
@property (nonatomic, assign) NSUInteger transitionGeneration;
/** Invalidates in-flight window-frame completion handlers without counting as a morph. */
@property (nonatomic, assign) NSUInteger layoutCompletionGeneration;
@property (nonatomic, assign) NSTimeInterval transitionEndTime;
/** Real presentation change — morph shape even when window frame cannot change (no NSScreen). */
@property (nonatomic, assign) BOOL pendingPresentationMorph;
/** True after the first layoutForScreen pass — replaces comparing against bootstrap frame size. */
@property (nonatomic, assign) BOOL hasLaidOutOnce;

- (void)applySnapshotDict:(NSDictionary *)snapshot;
- (void)teardown;
- (void)mouseUp:(NSEvent *)event;
- (void)mouseEnteredInView:(NSEvent *)event;
- (void)mouseExitedFromView:(NSEvent *)event;
- (void)clearPendingInteraction;
- (void)beginActionInFlight;
- (void)endActionInFlightRestoring:(BOOL)restore;
- (void)expandPeek;
- (void)expandInteractive;
- (void)enterInteractiveSticky;
- (void)collapse;
- (void)collapseEmittingDismiss:(BOOL)emitDismiss;
- (NSDictionary *)diagnosticsDict;
- (void)performUserHaptic;
- (void)performUserHapticWithReason:(NSString *)reason;
- (void)togglePin:(id)sender;
- (void)updatePinButtonState;
- (BOOL)simulateClickPin;
- (BOOL)simulateClickOptionIndex:(NSInteger)index;
- (BOOL)simulateClickApprove;
- (BOOL)simulateClickDeny;
- (BOOL)simulateSubmitFollowUp:(NSString *)text;
- (BOOL)simulateClickOpenInPrebase;
- (void)installLocalKeyMonitor;
- (void)removeLocalKeyMonitor;
- (void)expandPreview;
- (void)layoutForScreen;
- (void)refreshContentOnly;
- (CGFloat)computeControlsStackHeight;
- (BOOL)framesEffectivelyEqual:(NSRect)a to:(NSRect)b;
- (BOOL)isGlanceableSurface;
@end

@interface PrebaseFlippedView : NSView
@end

@implementation PrebaseFlippedView
- (BOOL)isFlipped { return YES; }
@end

@implementation PrebaseLiveActivityView

- (instancetype)initWithFrame:(NSRect)frameRect {
	self = [super initWithFrame:frameRect];
	if (self) {
		self.wantsLayer = YES;
		self.layerContentsRedrawPolicy = NSViewLayerContentsRedrawNever;

		_shapeLayer = [CAShapeLayer layer];
		// True black merges with the physical camera housing (Sapphire-compatible baseline).
		_shapeLayer.fillColor = [NSColor colorWithCalibratedWhite:0.0 alpha:1.0].CGColor;
		_shapeLayer.strokeColor = nil;
		_shapeLayer.lineWidth = 0;
		// Explicitly synchronize shape layer geometry to content view bounds
		_shapeLayer.frame = self.bounds;
		[self.layer addSublayer:_shapeLayer];

		// Silhouette mask — rectangular masksToBounds is not enough for curved shoulders.
		_shapeMaskLayer = [CAShapeLayer layer];
		_shapeMaskLayer.fillColor = [NSColor blackColor].CGColor;
		_shapeMaskLayer.frame = self.bounds;
		self.layer.mask = _shapeMaskLayer;

		_compactContainer = [[PrebaseFlippedView alloc] initWithFrame:self.bounds];
		_compactContainer.wantsLayer = YES;
		[self addSubview:_compactContainer];

		_leftStatusLabel = [self makeLabel:11.5 weight:NSFontWeightMedium color:[NSColor colorWithCalibratedWhite:0.94 alpha:1.0]];
		[_compactContainer addSubview:_leftStatusLabel];

		_rightMetricsLabel = [self makeLabel:10.5 weight:NSFontWeightRegular color:[NSColor colorWithCalibratedWhite:0.75 alpha:1.0]];
		_rightMetricsLabel.font = [NSFont monospacedDigitSystemFontOfSize:10.5 weight:NSFontWeightRegular];
		[_compactContainer addSubview:_rightMetricsLabel];

		_expandedContainer = [[PrebaseFlippedView alloc] initWithFrame:self.bounds];
		_expandedContainer.wantsLayer = YES;
		_expandedContainer.layer.masksToBounds = YES;
		_expandedContainer.alphaValue = 0.0;
		_expandedContainer.hidden = YES;
		[self addSubview:_expandedContainer];

		_headerTitle = [self makeLabel:12.5 weight:NSFontWeightSemibold color:[NSColor colorWithCalibratedWhite:0.98 alpha:1.0]];
		_headerTitle.stringValue = @"Magnus";
		[_expandedContainer addSubview:_headerTitle];

		_statusBadge = [self makeLabel:10.5 weight:NSFontWeightMedium color:[NSColor colorWithCalibratedWhite:0.62 alpha:1.0]];
		[_expandedContainer addSubview:_statusBadge];

		_contentDocumentView = [[PrebaseFlippedView alloc] initWithFrame:NSMakeRect(0, 0, 100, 40)];
		_contentDocumentView.wantsLayer = YES;

		_contentScrollView = [[NSScrollView alloc] initWithFrame:NSZeroRect];
		_contentScrollView.drawsBackground = NO;
		_contentScrollView.borderType = NSNoBorder;
		_contentScrollView.hasVerticalScroller = YES;
		_contentScrollView.hasHorizontalScroller = NO;
		_contentScrollView.autohidesScrollers = YES;
		_contentScrollView.scrollerStyle = NSScrollerStyleOverlay;
		_contentScrollView.verticalScrollElasticity = NSScrollElasticityAllowed;
		_contentScrollView.documentView = _contentDocumentView;
		[_expandedContainer addSubview:_contentScrollView];

		_activityDescription = [self makeLabel:11.5 weight:NSFontWeightMedium color:[NSColor colorWithCalibratedWhite:0.90 alpha:1.0]];
		[self configureLabel:_activityDescription lines:2 truncating:YES];
		[_contentDocumentView addSubview:_activityDescription];

		_latestMessageLabel = [self makeLabel:11 weight:NSFontWeightRegular color:[NSColor colorWithCalibratedWhite:0.78 alpha:1.0]];
		[self configureLabel:_latestMessageLabel lines:2 truncating:YES];
		_latestMessageLabel.hidden = YES;
		[_contentDocumentView addSubview:_latestMessageLabel];

		_actionLabels = [NSMutableArray array];
		_actionRowIds = [NSMutableArray array];
		for (NSInteger i = 0; i < 3; i++) {
			NSTextField *bullet = [self makeLabel:11.5 weight:NSFontWeightRegular color:[NSColor colorWithCalibratedWhite:0.78 alpha:1.0]];
			[self configureLabel:bullet lines:1 truncating:YES];
			[_actionLabels addObject:bullet];
			[_actionRowIds addObject:@""];
			[_contentDocumentView addSubview:bullet];
		}

		_pendingInteractionTitle = [self makeLabel:12 weight:NSFontWeightSemibold color:[NSColor colorWithCalibratedWhite:0.96 alpha:1.0]];
		[self configureLabel:_pendingInteractionTitle lines:2 truncating:YES];
		[_contentDocumentView addSubview:_pendingInteractionTitle];

		_pendingInteractionMessage = [self makeLabel:11 weight:NSFontWeightRegular color:[NSColor colorWithCalibratedWhite:0.80 alpha:1.0]];
		[self configureLabel:_pendingInteractionMessage lines:4 truncating:YES];
		[_contentDocumentView addSubview:_pendingInteractionMessage];

		_expandedMetricsLabel = [self makeLabel:10 weight:NSFontWeightRegular color:[NSColor colorWithCalibratedWhite:0.58 alpha:1.0]];
		_expandedMetricsLabel.font = [NSFont monospacedDigitSystemFontOfSize:10 weight:NSFontWeightRegular];
		[_contentDocumentView addSubview:_expandedMetricsLabel];
	}
	return self;
}

- (void)setFrameSize:(NSSize)newSize {
	[super setFrameSize:newSize];
	if (!self.controller.transitionInFlight) {
		if (NSEqualRects(self.controller.lastRequestedFrame, NSZeroRect)
			|| [self.controller framesEffectivelyEqual:NSMakeRect(0, 0, newSize.width, newSize.height)
												    to:NSMakeRect(0, 0, self.controller.lastRequestedFrame.size.width, self.controller.lastRequestedFrame.size.height)]) {
			self.shapeLayer.frame = self.bounds;
			self.shapeMaskLayer.frame = self.bounds;
		}
	}
}

- (NSTextField *)makeLabel:(CGFloat)size weight:(NSFontWeight)weight color:(NSColor *)color {
	NSTextField *tf = [[NSTextField alloc] initWithFrame:NSZeroRect];
	tf.editable = NO;
	tf.selectable = NO;
	tf.bordered = NO;
	tf.bezeled = NO;
	tf.drawsBackground = NO;
	tf.font = [NSFont systemFontOfSize:size weight:weight];
	tf.textColor = color;
	tf.lineBreakMode = NSLineBreakByTruncatingTail;
	tf.maximumNumberOfLines = 1;
	tf.cell.wraps = NO;
	tf.cell.scrollable = NO;
	return tf;
}

- (void)configureLabel:(NSTextField *)tf lines:(NSInteger)lines truncating:(BOOL)truncating {
	tf.maximumNumberOfLines = MAX(1, lines);
	tf.usesSingleLineMode = lines <= 1;
	tf.cell.wraps = lines > 1;
	tf.cell.scrollable = NO;
	if (lines > 1) {
		// Scrollable documents wrap fully; only truncate when the block must fit a fixed band.
		tf.lineBreakMode = truncating ? NSLineBreakByTruncatingTail : NSLineBreakByWordWrapping;
	} else {
		tf.lineBreakMode = NSLineBreakByTruncatingTail;
	}
}

- (void)layoutCompactWingChrome:(CGFloat)bandH totalW:(CGFloat)totalW leftW:(CGFloat)leftW rightW:(CGFloat)rightW housing:(CGFloat)housing {
	// Compact wing: intentional short token only (never agent prose).
	NSString *label = self.statusLabel.length ? self.statusLabel : @"Magnus";
	if (label.length > 9) {
		label = CompactWingLabelFromSnapshot(self.status, self.controller.pendingKind, label, nil);
	}
	self.leftStatusLabel.stringValue = label;
	self.leftStatusLabel.font = [NSFont systemFontOfSize:10.5 weight:NSFontWeightSemibold];
	CGFloat leftPad = 8.0;
	CGFloat maxLabelWidth = self.notched ? (leftW - leftPad - 2.0) : (totalW - 24);
	self.leftStatusLabel.frame = NSMakeRect(leftPad, MAX(4, (bandH - 15) / 2.0), maxLabelWidth, 15);
	if (self.notched && self.metricsLabel.length) {
		NSString *metrics = self.metricsLabel;
		// Right wing is ~48pt usable — keep a single short metric token.
		NSArray *parts = [metrics componentsSeparatedByString:@" · "];
		if (parts.count > 0) {
			metrics = parts[0];
		}
		if (metrics.length > 6) {
			metrics = [metrics substringToIndex:6];
		}
		self.rightMetricsLabel.stringValue = metrics;
		self.rightMetricsLabel.hidden = NO;
		self.rightMetricsLabel.alignment = NSTextAlignmentRight;
		CGFloat metricsX = leftW + housing + 6;
		CGFloat metricsW = MAX(18, rightW - 14);
		self.rightMetricsLabel.frame = NSMakeRect(metricsX, MAX(4, (bandH - 14) / 2.0), metricsW, 14);
	} else {
		self.rightMetricsLabel.hidden = YES;
	}
}

- (BOOL)placeContentBlock:(NSTextField *)field text:(NSString *)text lines:(NSInteger)lines indent:(CGFloat)indent contentW:(CGFloat)contentW y:(CGFloat *)y contentMaxY:(CGFloat)contentMaxY allowOverflow:(BOOL)allowOverflow {
	if (!field || !text.length) {
		return YES;
	}
	CGFloat avail = contentMaxY - *y;
	if (!allowOverflow && avail < 12) {
		return NO;
	}
	CGFloat fieldW = MAX(24, contentW - indent);
	CGFloat need = MeasureTextHeight(text, field.font, fieldW, lines);
	if (need < 11) {
		return NO;
	}
	// When scrolling is available, keep the measured height (never shrink glyphs into a clip).
	// Without overflow, drop the block rather than half-rendering mid-glyph.
	if (!allowOverflow && need > avail) {
		return NO;
	}
	field.stringValue = text;
	field.hidden = NO;
	[self configureLabel:field lines:lines truncating:!allowOverflow];
	CGFloat insetX = ContentSafeInsetX(self.notched);
	field.frame = NSMakeRect(insetX + indent, *y, fieldW, MAX(need, lines == 1 ? kActionRowHeight : need));
	*y += MAX(need, lines == 1 ? kActionRowHeight : need) + kContentGap;
	return YES;
}

- (BOOL)placeContentBlock:(NSTextField *)field text:(NSString *)text lines:(NSInteger)lines indent:(CGFloat)indent contentW:(CGFloat)contentW y:(CGFloat *)y contentMaxY:(CGFloat)contentMaxY {
	return [self placeContentBlock:field text:text lines:lines indent:indent contentW:contentW y:y contentMaxY:contentMaxY allowOverflow:NO];
}

/** Reconcile action rows by stable id — update labels in place, never reshuffle existing rows. */
- (void)reconcileActionRowsIntoDocument:(CGFloat *)docY contentW:(CGFloat)docContentW ok:(BOOL *)ok {
	if (!ok || !*ok) {
		return;
	}
	NSArray<NSDictionary *> *incoming = self.actions ?: @[];
	NSInteger slotCount = MIN(3, (NSInteger)self.actionLabels.count);
	NSMutableArray<NSString *> *prevIds = [self.actionRowIds mutableCopy] ?: [NSMutableArray array];
	while ((NSInteger)prevIds.count < slotCount) {
		[prevIds addObject:@""];
	}

	NSMutableArray<NSDictionary *> *ordered = [NSMutableArray array];
	NSMutableSet *used = [NSMutableSet set];
	// Preserve visible slot order when ids still present.
	for (NSInteger i = 0; i < slotCount; i++) {
		NSString *prev = prevIds[i];
		if (prev.length == 0) {
			continue;
		}
		for (NSDictionary *item in incoming) {
			NSString *aid = [item[@"id"] isKindOfClass:[NSString class]] ? item[@"id"] : @"";
			if (aid.length && [aid isEqualToString:prev] && ![used containsObject:aid]) {
				[ordered addObject:item];
				[used addObject:aid];
				break;
			}
		}
	}
	// Append new actions (newest last), then take the trailing slotCount.
	for (NSDictionary *item in incoming) {
		NSString *aid = [item[@"id"] isKindOfClass:[NSString class]] ? item[@"id"] : @"";
		NSString *label = [item[@"label"] isKindOfClass:[NSString class]] ? item[@"label"] : @"";
		if (label.length == 0) {
			continue;
		}
		if (aid.length && [used containsObject:aid]) {
			continue;
		}
		if (aid.length) {
			[used addObject:aid];
		}
		[ordered addObject:item];
	}
	while ((NSInteger)ordered.count > slotCount) {
		[ordered removeObjectAtIndex:0];
	}

	for (NSInteger i = 0; i < slotCount; i++) {
		if (i >= (NSInteger)ordered.count) {
			self.actionLabels[i].hidden = YES;
			self.actionLabels[i].accessibilityLabel = @"";
			self.actionRowIds[i] = @"";
			continue;
		}
		NSDictionary *item = ordered[i];
		NSString *aid = [item[@"id"] isKindOfClass:[NSString class]] ? item[@"id"] : [NSString stringWithFormat:@"idx-%ld", (long)i];
		NSString *label = [item[@"label"] isKindOfClass:[NSString class]] ? item[@"label"] : @"";
		self.actionRowIds[i] = aid;
		self.actionLabels[i].accessibilityLabel = label;
		NSString *bullet = [NSString stringWithFormat:@"•  %@", label];
		*ok = [self placeContentBlock:self.actionLabels[i] text:bullet lines:1 indent:2 contentW:docContentW y:docY contentMaxY:10000 allowOverflow:YES];
		if (!*ok) {
			break;
		}
	}
}

- (BOOL)isFlipped { return YES; }
- (BOOL)acceptsFirstMouse:(NSEvent *)event { return YES; }

- (NSView *)hitTest:(NSPoint)point {
	// Shape-aware hit testing: transparent panel regions must not steal menu-bar clicks.
	NSView *hit = [super hitTest:point];
	if (!hit) {
		return nil;
	}
	CAShapeLayer *shape = self.shapeLayer;
	if (!shape) {
		return hit;
	}
	NSPoint local = [self convertPoint:point fromView:self.superview];
	CAShapeLayer *presentation = (CAShapeLayer *)shape.presentationLayer;
	CGPathRef path = (presentation && presentation.path) ? presentation.path : shape.path;
	if (!path) {
		return hit;
	}
	CGPoint cgLocal = NSPointToCGPoint(local);
	CGRect pathBounds = CGPathGetPathBoundingBox(path);
	// Inflate slightly for shoulder hover acquisition near edges.
	pathBounds = CGRectInset(pathBounds, -2.0, -2.0);
	if (!CGRectContainsPoint(pathBounds, cgLocal)) {
		return nil;
	}
	if (!CGPathContainsPoint(path, NULL, cgLocal, false)) {
		// Notch cutout and exterior shoulders: pass through.
		return nil;
	}
	return hit;
}

- (void)updateTrackingAreas {
	[super updateTrackingAreas];
	if (self.trackingArea) {
		[self removeTrackingArea:self.trackingArea];
	}
	NSTrackingAreaOptions opts = NSTrackingMouseEnteredAndExited
		| NSTrackingActiveAlways
		| NSTrackingInVisibleRect;
	self.trackingArea = [[NSTrackingArea alloc] initWithRect:self.bounds options:opts owner:self userInfo:nil];
	[self addTrackingArea:self.trackingArea];
}

- (void)mouseEntered:(NSEvent *)event {
	[self.controller mouseEnteredInView:event];
}

- (void)mouseExited:(NSEvent *)event {
	[self.controller mouseExitedFromView:event];
}

- (void)mouseDown:(NSEvent *)event {
	// Peek / Attention Peek → sticky Interactive must match simulateAction("click").
	if (self.peekOnly || self.controller.attentionPeek) {
		[self.controller enterInteractiveSticky];
		return;
	}
	[super mouseDown:event];
}

- (void)refreshContentSubviewsPreservingPresentation {
	[self refreshContentSubviewsPreservingPresentationWithSize:NSZeroSize];
}

- (void)refreshContentSubviewsPreservingPresentationWithSize:(NSSize)layoutSize {
	self.controller.contentRefreshCount++;
	// Content-only path: update labels/text without touching shape path, morph
	// animation, transitionInFlight, or container alpha/hidden (those belong to geometry).
	// When layoutSize is set, lay into the *target* geometry so expansion never paints
	// into a still-collapsed bounds (blank black slab mid-morph).
	NSRect bounds = self.bounds;
	if (layoutSize.width > 1 && layoutSize.height > 1) {
		bounds.size = layoutSize;
	}
	CGFloat bandH = MAX(self.safeAreaTop, kCollapsedHeight);
	BOOL isExpanded = self.targetExpanded;
	CGFloat totalW = NSWidth(bounds);
	CGFloat currentH = NSHeight(bounds);
	CGFloat leftW = self.leftWingWidth > 0 ? self.leftWingWidth : kWingWidthMin;
	CGFloat rightW = self.rightWingWidth > 0 ? self.rightWingWidth : kWingWidthMin;
	CGFloat housing = self.housingWidth > 0 ? self.housingWidth : kCameraHousingMin;

	self.compactContainer.frame = NSMakeRect(0, 0, totalW, bandH);
	self.expandedContainer.frame = NSMakeRect(0, bandH, totalW, MAX(0, currentH - bandH));

	// Compact state: only collapsed wing chrome
	if (!isExpanded) {
		self.contentScrollView.hidden = YES;
		[self layoutCompactWingChrome:bandH totalW:totalW leftW:leftW rightW:rightW housing:housing];
		return;
	}

	// Attention Peek / Peek: keeps compact wings and shows one glanceable activity/pending line
	if (self.peekOnly) {
		self.contentScrollView.hidden = YES;
		[self layoutCompactWingChrome:bandH totalW:totalW leftW:leftW rightW:rightW housing:housing];
		self.headerTitle.hidden = YES;
		self.statusBadge.hidden = YES;
		for (NSInteger i = 0; i < 3; i++) {
			self.actionLabels[i].hidden = YES;
		}
		self.pendingInteractionTitle.hidden = YES;
		self.pendingInteractionMessage.hidden = YES;
		self.expandedMetricsLabel.hidden = YES;
		self.latestMessageLabel.hidden = YES;
		NSString *peekBody = nil;
		if (self.pendingTitle.length) {
			// Peek is glanceable — prefer a short intentional line when the title is long.
			peekBody = self.pendingTitle.length > 42
				? ([self.controller.pendingKind isEqualToString:@"question"]
					? @"Magnus needs an answer"
					: @"Magnus needs approval")
				: self.pendingTitle;
		} else if (self.pendingMessage.length) {
			peekBody = self.pendingMessage.length > 42 ? @"Magnus needs your input" : self.pendingMessage;
		} else if (self.activityLabel.length) {
			peekBody = self.activityLabel;
		} else if (self.latestMessage.length) {
			peekBody = self.latestMessage;
		}
		if (peekBody.length) {
			[self configureLabel:self.activityDescription lines:2 truncating:NO];
			self.activityDescription.stringValue = peekBody;
			self.activityDescription.hidden = NO;
			CGFloat peekInset = ContentSafeInsetX(self.notched);
			CGFloat peekW = MAX(40, totalW - peekInset * 2);
			CGFloat peekH = MeasureTextHeight(peekBody, self.activityDescription.font, peekW, 2);
			CGFloat bodyH = MAX(0, currentH - bandH);
			CGFloat textY = MAX(kContentInsetTop, floor((bodyH - peekH) / 2.0));
			self.activityDescription.frame = NSMakeRect(peekInset, textY, peekW, MIN(peekH, MAX(14, bodyH - textY - 2)));
			// Peek body lives on expandedContainer (not scroll) for density.
			if (self.activityDescription.superview != self.expandedContainer) {
				[self.expandedContainer addSubview:self.activityDescription];
			}
		} else {
			self.activityDescription.hidden = YES;
		}
		return;
	}

	// Interactive: HEADER → scrollable CONTENT → (controls laid out separately in footer)
	self.headerTitle.hidden = NO;
	self.statusBadge.hidden = NO;
	self.contentScrollView.hidden = NO;
	if (self.activityDescription.superview != self.contentDocumentView) {
		[self.contentDocumentView addSubview:self.activityDescription];
	}

	CGFloat bodyHeight = MAX(0, currentH - bandH);
	// Always trust the live control-stack measurement so the scroll viewport
	// never paints under Deny/Approve/composer (sibling overlap clips glyphs).
	CGFloat measuredFooter = self.controller
		? [self.controller computeControlsStackHeight] + kContentFooterGutter
		: kFooterReserved + kContentFooterGutter;
	CGFloat footerReserve = MAX(self.reservedFooterHeight, measuredFooter);
	if (footerReserve > bodyHeight - 28) {
		footerReserve = MAX(measuredFooter, MIN(footerReserve, MAX(0, bodyHeight - 28)));
	}
	CGFloat y = kContentInsetTop;

	// Header: leading identity + trailing short status
	NSString *statusText = self.statusLabel.length
		? self.statusLabel
		: (self.attention ? @"Attention" : (self.status.length ? [self.status capitalizedString] : @"Working"));
	if (self.attention) {
		// Avoid duplicating Approve/Deny verbs already shown on the action row.
		statusText = [self.controller.pendingKind isEqualToString:@"question"] ? @"Question" : @"Needs you";
	} else if (statusText.length > 14) {
		statusText = CompactWingLabelFromSnapshot(self.status, self.controller.pendingKind, statusText, nil);
	}
	self.statusBadge.stringValue = statusText;
	self.statusBadge.textColor = self.attention
		? [NSColor colorWithCalibratedRed:0.98 green:0.72 blue:0.28 alpha:0.95]
		: [NSColor colorWithCalibratedWhite:0.58 alpha:1.0];
	self.statusBadge.alignment = NSTextAlignmentRight;
	CGFloat headerInset = ContentSafeInsetX(self.notched);
	CGFloat headerW = MAX(40, totalW - headerInset * 2);
	CGFloat statusW = MIN(headerW * 0.40, MAX(44, [statusText sizeWithAttributes:@{ NSFontAttributeName: self.statusBadge.font }].width + 4));
	CGFloat titleW = MAX(48, headerW - statusW - 8);
	self.headerTitle.stringValue = @"Magnus";
	self.headerTitle.frame = NSMakeRect(headerInset, y, titleW, kHeaderRowHeight);
	self.statusBadge.frame = NSMakeRect(headerInset + titleW + 4, y, statusW, kHeaderRowHeight);
	y += kHeaderRowHeight + kContentGap;

	CGFloat scrollTop = y;
	// Never force a minimum scroll height that invades the footer/option stack.
	CGFloat availableScroll = bodyHeight - footerReserve - scrollTop;
	CGFloat scrollHeight = MAX(0, availableScroll);
	self.contentScrollView.frame = NSMakeRect(0, scrollTop, totalW, scrollHeight);

	self.activityDescription.hidden = YES;
	self.latestMessageLabel.hidden = YES;
	self.pendingInteractionTitle.hidden = YES;
	self.pendingInteractionMessage.hidden = YES;
	self.expandedMetricsLabel.hidden = YES;
	// Hide labels only — keep actionRowIds so reconcile can preserve slot identity.
	for (NSInteger i = 0; i < (NSInteger)self.actionLabels.count; i++) {
		self.actionLabels[i].hidden = YES;
	}

	// Document-local stacking with overflow allowed (scroll handles excess).
	CGFloat docY = 2;
	CGFloat docMax = 10000; // unbounded for measurement; scroll clips
	CGFloat docContentW = MAX(40, totalW - (kContentInsetX + kContentSafeExtraX) * 2);
	BOOL hasPending = self.pendingTitle.length > 0 || self.pendingMessage.length > 0;
	BOOL ok = YES;
	if (ok && self.pendingTitle.length) {
		ok = [self placeContentBlock:self.pendingInteractionTitle text:self.pendingTitle lines:2 indent:0 contentW:docContentW y:&docY contentMaxY:docMax allowOverflow:YES];
	}
	if (ok && self.pendingMessage.length) {
		ok = [self placeContentBlock:self.pendingInteractionMessage text:self.pendingMessage lines:3 indent:0 contentW:docContentW y:&docY contentMaxY:docMax allowOverflow:YES];
	}
	// Approval/question: pending is primary — do not fight with activity/action log.
	if (!hasPending) {
		if (ok && self.activityLabel.length) {
			ok = [self placeContentBlock:self.activityDescription text:self.activityLabel lines:2 indent:0 contentW:docContentW y:&docY contentMaxY:docMax allowOverflow:YES];
		}
		// Notch summarizes — only show latestShortMessage when there is no current activity.
		if (ok && self.latestMessage.length && self.activityLabel.length == 0) {
			ok = [self placeContentBlock:self.latestMessageLabel text:self.latestMessage lines:2 indent:0 contentW:docContentW y:&docY contentMaxY:docMax allowOverflow:YES];
		}
		[self reconcileActionRowsIntoDocument:&docY contentW:docContentW ok:&ok];
		if (ok && self.metricsLabel.length) {
			[self placeContentBlock:self.expandedMetricsLabel text:self.metricsLabel lines:1 indent:0 contentW:docContentW y:&docY contentMaxY:docMax allowOverflow:YES];
		}
	} else {
		// Pending owns the scroll document — clear action identity so diagnostics stay truthful.
		for (NSInteger i = 0; i < (NSInteger)self.actionRowIds.count; i++) {
			self.actionRowIds[i] = @"";
		}
	}

	CGFloat docH = MAX(scrollHeight, docY + 4);
	self.contentDocumentView.frame = NSMakeRect(0, 0, totalW, docH);
	// Keep content clipped to document; footer remains outside the scroll view.
}

- (void)updateShapeAndContentAnimated:(BOOL)animated duration:(NSTimeInterval)duration useTargetState:(BOOL)useTargetState {
	[self updateShapeAndContentAnimated:animated duration:duration useTargetState:useTargetState targetSize:NSZeroSize];
}

- (void)updateShapeAndContentAnimated:(BOOL)animated duration:(NSTimeInterval)duration useTargetState:(BOOL)useTargetState targetSize:(NSSize)targetSize {
	self.controller.redrawCount++;
	NSRect bounds = self.bounds;
	CGFloat bandH = MAX(self.safeAreaTop, kCollapsedHeight);
	CGFloat totalW = (targetSize.width > 0) ? targetSize.width : NSWidth(bounds);
	CGFloat currentH = (targetSize.height > 0) ? targetSize.height : NSHeight(bounds);
	// Use explicit semantic target state when available, otherwise infer from bounds for compatibility
	BOOL isExpanded = useTargetState ? self.targetExpanded : (currentH > bandH + 2.0);

	CGFloat leftW = self.leftWingWidth > 0 ? self.leftWingWidth : kWingWidthMin;
	CGFloat rightW = self.rightWingWidth > 0 ? self.rightWingWidth : kWingWidthMin;
	CGFloat housing = self.housingWidth > 0 ? self.housingWidth : kCameraHousingMin;

	CGColorRef fill = [NSColor colorWithCalibratedWhite:0.0 alpha:1.0].CGColor;
	self.shapeLayer.fillColor = fill;

	if (!self.notched) {
		self.shapeLayer.strokeColor = [NSColor colorWithCalibratedWhite:1.0 alpha:0.14].CGColor;
		self.shapeLayer.lineWidth = 1.0;
	} else {
		self.shapeLayer.strokeColor = nil;
		self.shapeLayer.lineWidth = 0.0;
	}

	// Stage content into the *target* silhouette before morphing so expansion never
	// reveals an empty black panel while bounds are still collapsed.
	self.compactContainer.frame = NSMakeRect(0, 0, totalW, bandH);
	self.expandedContainer.frame = NSMakeRect(0, bandH, totalW, MAX(0, currentH - bandH));
	if (self.controller) {
		self.reservedFooterHeight = [self.controller computeControlsStackHeight] + kContentFooterGutter;
	}
	if (isExpanded) {
		self.expandedContainer.hidden = NO;
		self.expandedContainer.alphaValue = 1.0; // populated first paint — no blank fade-in
	}
	[self refreshContentSubviewsPreservingPresentationWithSize:NSMakeSize(totalW, currentH)];

	CGPathRef targetPath = CreateNotchedIslandPath(totalW, currentH, leftW, rightW, housing, bandH, isExpanded, self.notched);
	CGRect targetFrame = CGRectMake(0, 0, totalW, currentH);

	if (animated && !self.reducedMotion) {
		self.controller.animationCount++;
		self.controller.transitionInFlight = YES;
		self.controller.transitionEndTime = [NSDate timeIntervalSinceReferenceDate] + duration;
		const NSUInteger currentGeneration = self.controller.transitionGeneration;

		// Presentation-layer aware retargeting: sample current in-flight path & frame to avoid jumps
		CAShapeLayer *presentation = (CAShapeLayer *)[self.shapeLayer presentationLayer];
		CGPathRef fromPath = presentation && presentation.path ? presentation.path : self.shapeLayer.path;
		if (!fromPath) {
			fromPath = targetPath;
		}
		CGRect fromFrame = presentation ? presentation.frame : self.shapeLayer.frame;

		[CATransaction begin];
		[CATransaction setAnimationDuration:duration];
		[CATransaction setAnimationTimingFunction:[CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseInEaseOut]];
		[CATransaction setCompletionBlock:^{
			// Only mark transition complete if this completion block matches the current generation
			// This prevents stale animation completions from incorrectly marking newer transitions as finished
			if (currentGeneration == self.controller.transitionGeneration) {
				self.shapeLayer.frame = targetFrame;
				self.shapeMaskLayer.frame = targetFrame;
				if (self.controller.panel && !NSEqualRects(self.controller.lastRequestedFrame, NSZeroRect)) {
					[self.controller.panel setFrame:self.controller.lastRequestedFrame display:YES];
					if ([self.controller framesEffectivelyEqual:self.controller.panel.frame to:self.controller.lastRequestedFrame]) {
						self.controller.transitionInFlight = NO;
					}
				} else {
					self.controller.transitionInFlight = NO;
				}
			}
		}];

		CABasicAnimation *pathAnimation = [CABasicAnimation animationWithKeyPath:@"path"];
		pathAnimation.fromValue = (__bridge id)fromPath;
		pathAnimation.toValue = (__bridge id)targetPath;
		pathAnimation.duration = duration;
		pathAnimation.timingFunction = [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseInEaseOut];
		pathAnimation.removedOnCompletion = YES;
		[self.shapeLayer addAnimation:pathAnimation forKey:@"morphPath"];

		CABasicAnimation *frameAnimation = [CABasicAnimation animationWithKeyPath:@"frame"];
		frameAnimation.fromValue = [NSValue valueWithRect:NSRectFromCGRect(fromFrame)];
		frameAnimation.toValue = [NSValue valueWithRect:NSRectFromCGRect(targetFrame)];
		frameAnimation.duration = duration;
		frameAnimation.timingFunction = [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseInEaseOut];
		frameAnimation.removedOnCompletion = YES;
		[self.shapeLayer addAnimation:frameAnimation forKey:@"morphFrame"];

		// Keep the clipping mask in the exact same transaction/timeline as the
		// visible silhouette. A separate transaction can begin a frame later,
		// exposing or clipping content while the shape is still mid-morph.
		CABasicAnimation *maskPathAnimation = [CABasicAnimation animationWithKeyPath:@"path"];
		maskPathAnimation.fromValue = (__bridge id)fromPath;
		maskPathAnimation.toValue = (__bridge id)targetPath;
		maskPathAnimation.duration = duration;
		maskPathAnimation.timingFunction = pathAnimation.timingFunction;
		maskPathAnimation.removedOnCompletion = YES;
		[self.shapeMaskLayer addAnimation:maskPathAnimation forKey:@"morphPath"];

		CABasicAnimation *maskFrameAnimation = [CABasicAnimation animationWithKeyPath:@"frame"];
		maskFrameAnimation.fromValue = [NSValue valueWithRect:NSRectFromCGRect(fromFrame)];
		maskFrameAnimation.toValue = [NSValue valueWithRect:NSRectFromCGRect(targetFrame)];
		maskFrameAnimation.duration = duration;
		maskFrameAnimation.timingFunction = frameAnimation.timingFunction;
		maskFrameAnimation.removedOnCompletion = YES;
		[self.shapeMaskLayer addAnimation:maskFrameAnimation forKey:@"morphFrame"];

		self.shapeLayer.path = targetPath;
		self.shapeLayer.frame = targetFrame;
		self.shapeMaskLayer.path = targetPath;
		self.shapeMaskLayer.frame = targetFrame;
		[CATransaction commit];
	} else {
		self.shapeLayer.path = targetPath;
		self.shapeLayer.frame = targetFrame;
		self.shapeMaskLayer.path = targetPath;
		self.shapeMaskLayer.frame = targetFrame;
		[self.shapeLayer removeAnimationForKey:@"morphPath"];
		[self.shapeLayer removeAnimationForKey:@"morphFrame"];
		[self.shapeMaskLayer removeAnimationForKey:@"morphPath"];
		[self.shapeMaskLayer removeAnimationForKey:@"morphFrame"];
		self.controller.transitionInFlight = NO;
	}
	CGPathRelease(targetPath);

	if (!isExpanded) {
		if (animated && !self.reducedMotion) {
			[NSAnimationContext runAnimationGroup:^(NSAnimationContext *ctx) {
				ctx.duration = duration * 0.55;
				self.expandedContainer.animator.alphaValue = 0.0;
				self.compactContainer.animator.alphaValue = 1.0;
			} completionHandler:^{
				self.expandedContainer.hidden = YES;
			}];
		} else {
			self.expandedContainer.alphaValue = 0.0;
			self.expandedContainer.hidden = YES;
			self.compactContainer.alphaValue = 1.0;
			self.compactContainer.hidden = NO;
		}
	} else {
		BOOL keepCompactWings = self.peekOnly;
		self.compactContainer.hidden = NO;
		if (animated && !self.reducedMotion) {
			[NSAnimationContext runAnimationGroup:^(NSAnimationContext *ctx) {
				ctx.duration = duration * 0.45;
				self.compactContainer.animator.alphaValue = keepCompactWings ? 1.0 : 0.0;
			}];
		} else {
			self.compactContainer.alphaValue = keepCompactWings ? 1.0 : 0.0;
		}
	}
}

- (NSString *)accessibilityLabel {
	return self.statusLabel.length ? self.statusLabel : @"Magnus live activity";
}

- (NSString *)accessibilityRoleDescription {
	return @"Magnus live activity";
}

- (void)mouseUp:(NSEvent *)event {
	[self.controller mouseUp:event];
}

@end

@implementation PrebaseLiveActivityController

- (instancetype)init {
	self = [super init];
	if (self) {
		self.ignoresMouse = YES;
		self.displayMode = @"builtin";
		self.didHoverHaptic = NO;
		self.hapticCount = 0;
		self.hoverHapticCount = 0;
		self.lastHapticReason = @"none";
		self.redrawCount = 0;
		self.animationCount = 0;
		self.geometryTransitionCount = 0;
		self.contentOnlyUpdateCount = 0;
		self.orderFrontCount = 0;
		self.lastRenderedRevision = 0;
		self.lastTransitionReason = @"";
		self.transitionInFlight = NO;
		self.transitionGeneration = 0;
		self.layoutCompletionGeneration = 0;
		[self buildPanel];
		[[NSNotificationCenter defaultCenter] addObserver:self
		                                         selector:@selector(screenParametersChanged:)
		                                             name:NSApplicationDidChangeScreenParametersNotification
		                                           object:nil];
		[[NSNotificationCenter defaultCenter] addObserver:self
		                                         selector:@selector(windowDidBecomeKey:)
		                                             name:NSWindowDidBecomeKeyNotification
		                                           object:nil];
		[[NSNotificationCenter defaultCenter] addObserver:self
		                                         selector:@selector(windowDidEnterFullScreen:)
		                                             name:NSWindowDidEnterFullScreenNotification
		                                           object:nil];
		[[NSNotificationCenter defaultCenter] addObserver:self
		                                         selector:@selector(windowDidExitFullScreen:)
		                                             name:NSWindowDidExitFullScreenNotification
		                                           object:nil];
	}
	return self;
}

- (void)windowDidBecomeKey:(NSNotification *)notification {
	NSWindow *window = notification.object;
	if (![window isKindOfClass:[NSWindow class]] || window == self.panel) {
		return;
	}
	if (window.screen) {
		self.lastFocusedWorkScreen = window.screen;
	}
}

- (void)windowDidEnterFullScreen:(NSNotification *)notification {
	NSWindow *window = notification.object;
	if (window == self.panel) {
		return;
	}
	self.prebaseFullscreen = YES;
	// Fullscreen policy: do not auto-expand Peek while immersed; Compact/attention only.
	if (!self.pinned && self.content.peekOnly && !self.attentionPeek && !self.content.attention) {
		[self collapse];
	}
}

- (void)windowDidExitFullScreen:(NSNotification *)notification {
	NSWindow *window = notification.object;
	if (window == self.panel) {
		return;
	}
	BOOL anyFullscreen = NO;
	for (NSWindow *w in [NSApp windows]) {
		if (w != self.panel && (w.styleMask & NSWindowStyleMaskFullScreen)) {
			anyFullscreen = YES;
			break;
		}
	}
	self.prebaseFullscreen = anyFullscreen;
}

- (void)screenParametersChanged:(NSNotification *)notification {
	if (self.visible && !gDisposed) {
		[self layoutForScreen];
	}
}

- (void)buildPanel {
	NSRect frame = NSMakeRect(0, 0, kBootstrapPanelWidth, kBootstrapPanelHeight);
	self.panel = [[NSPanel alloc] initWithContentRect:frame
		styleMask:(NSWindowStyleMaskNonactivatingPanel | NSWindowStyleMaskBorderless | NSWindowStyleMaskFullSizeContentView)
		backing:NSBackingStoreBuffered
		defer:NO];
	self.panel.opaque = NO;
	self.panel.backgroundColor = NSColor.clearColor;
	self.panel.hasShadow = YES;
	self.panel.level = LiveActivityWindowLevel();
	self.panel.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces
		| NSWindowCollectionBehaviorFullScreenAuxiliary
		| NSWindowCollectionBehaviorTransient
		| NSWindowCollectionBehaviorIgnoresCycle;
	self.panel.hidesOnDeactivate = NO;
	self.panel.becomesKeyOnlyIfNeeded = YES;
	self.panel.floatingPanel = YES;
	self.panel.worksWhenModal = YES;
	self.panel.ignoresMouseEvents = YES;
	self.panel.movableByWindowBackground = NO;
	self.panel.titleVisibility = NSWindowTitleHidden;
	self.panel.titlebarAppearsTransparent = YES;
	self.panel.animationBehavior = NSWindowAnimationBehaviorNone;

	self.content = [[PrebaseLiveActivityView alloc] initWithFrame:frame];
	self.content.controller = self;
	self.panel.contentView = self.content;
	self.content.accessibilityElement = YES;
	self.content.accessibilityRole = NSAccessibilityGroupRole;

	self.input = [[NSTextField alloc] initWithFrame:NSMakeRect(14, 0, 200, kControlHeight)];
	self.input.placeholderString = @"Message Magnus…";
	self.input.font = [NSFont systemFontOfSize:11.5 weight:NSFontWeightRegular];
	self.input.focusRingType = NSFocusRingTypeExterior;
	self.input.bordered = NO;
	self.input.wantsLayer = YES;
	self.input.layer.cornerRadius = kComposerCornerRadius;
	self.input.layer.masksToBounds = YES;
	self.input.layer.backgroundColor = [NSColor colorWithCalibratedWhite:0.10 alpha:0.98].CGColor;
	self.input.layer.borderWidth = 0.5;
	self.input.layer.borderColor = [NSColor colorWithCalibratedWhite:0.32 alpha:0.40].CGColor;
	self.input.textColor = [NSColor colorWithCalibratedWhite:0.94 alpha:1.0];
	self.input.hidden = YES;
	self.input.target = self;
	self.input.action = @selector(submitFollowUp:);
	self.input.accessibilityLabel = @"Message Magnus";
	[self.content.expandedContainer addSubview:self.input];

	self.openButton = [self makeIconButton:@"arrow.up.right.square" accessibilityLabel:@"Open in PreBase" action:@selector(openInPrebase:)];
	self.pinButton = [self makeIconButton:@"pin" accessibilityLabel:@"Pin panel" action:@selector(togglePin:)];
	self.approveButton = [self makeButton:@"Approve" action:@selector(approve:)];
	self.approveButton.layer.backgroundColor = [NSColor colorWithCalibratedRed:0.16 green:0.52 blue:0.32 alpha:0.92].CGColor;
	self.approveButton.layer.borderColor = [NSColor colorWithCalibratedRed:0.28 green:0.68 blue:0.42 alpha:0.45].CGColor;
	self.approveButton.contentTintColor = [NSColor whiteColor];
	self.approveButton.font = [NSFont systemFontOfSize:11.5 weight:NSFontWeightSemibold];

	self.denyButton = [self makeButton:@"Deny" action:@selector(deny:)];
	self.denyButton.layer.backgroundColor = [NSColor colorWithCalibratedWhite:0.16 alpha:0.9].CGColor;
	self.denyButton.layer.borderColor = [NSColor colorWithCalibratedWhite:0.32 alpha:0.45].CGColor;
	self.denyButton.contentTintColor = [NSColor colorWithCalibratedWhite:0.92 alpha:1.0];
	self.denyButton.font = [NSFont systemFontOfSize:11.5 weight:NSFontWeightMedium];

	self.approveButton.hidden = YES;
	self.denyButton.hidden = YES;
	self.pinButton.hidden = YES;
	self.optionButtons = [NSMutableArray array];
	for (NSInteger i = 0; i < 4; i++) {
		NSButton *button = [self makeButton:[NSString stringWithFormat:@"Option %ld", (long)(i + 1)] action:@selector(answerOption:)];
		button.tag = i;
		button.hidden = YES;
		[self.optionButtons addObject:button];
	}
}

- (NSButton *)makeIconButton:(NSString *)symbolName accessibilityLabel:(NSString *)label action:(SEL)action {
	NSButton *button = [[NSButton alloc] initWithFrame:NSMakeRect(0, 0, kIconControlSize, kIconControlSize)];
	button.bezelStyle = NSBezelStyleInline;
	button.bordered = NO;
	button.wantsLayer = YES;
	button.layer.cornerRadius = 6.0;
	button.layer.masksToBounds = YES;
	button.layer.backgroundColor = [NSColor colorWithCalibratedWhite:0.14 alpha:0.80].CGColor;
	button.layer.borderWidth = 0.5;
	button.layer.borderColor = [NSColor colorWithCalibratedWhite:0.32 alpha:0.35].CGColor;
	button.target = self;
	button.action = action;
	button.hidden = YES;
	button.accessibilityRole = NSAccessibilityButtonRole;
	button.imageScaling = NSImageScaleProportionallyDown;
	ApplySystemSymbol(button, symbolName, label);
	[self.content.expandedContainer addSubview:button];
	return button;
}

- (NSButton *)makeButton:(NSString *)title action:(SEL)action {
	NSButton *button = [[NSButton alloc] initWithFrame:NSMakeRect(0, 0, 88, 22)];
	button.title = title;
	button.bezelStyle = NSBezelStyleInline;
	button.bordered = NO;
	button.wantsLayer = YES;
	button.layer.cornerRadius = 8.0;
	button.layer.masksToBounds = YES;
	button.layer.backgroundColor = [NSColor colorWithCalibratedWhite:0.16 alpha:0.88].CGColor;
	button.layer.borderWidth = 0.5;
	button.layer.borderColor = [NSColor colorWithCalibratedWhite:0.32 alpha:0.40].CGColor;
	button.font = [NSFont systemFontOfSize:11 weight:NSFontWeightMedium];
	button.contentTintColor = [NSColor colorWithCalibratedWhite:0.92 alpha:1.0];
	NSDictionary *attrs = @{
		NSFontAttributeName: [NSFont systemFontOfSize:11 weight:NSFontWeightMedium],
		NSForegroundColorAttributeName: [NSColor colorWithCalibratedWhite:0.92 alpha:1.0],
	};
	button.attributedTitle = [[NSAttributedString alloc] initWithString:title attributes:attrs];
	button.target = self;
	button.action = action;
	button.hidden = YES;
	button.accessibilityLabel = title;
	button.accessibilityRole = NSAccessibilityButtonRole;
	[self.content.expandedContainer addSubview:button];
	return button;
}

- (NSScreen *)targetScreen {
	if ([self.displayMode isEqualToString:@"active"]) {
		// Follow focused work context — never retarget mid-morph, never follow bare cursor.
		if (self.transitionInFlight && self.layoutScreen) {
			return self.layoutScreen;
		}
		NSWindow *keyWin = [NSApp keyWindow];
		NSWindow *mainWin = [NSApp mainWindow];
		NSScreen *workScreen = nil;
		if (keyWin && keyWin != self.panel) {
			workScreen = keyWin.screen;
		}
		if (!workScreen && mainWin && mainWin != self.panel) {
			workScreen = mainWin.screen;
		}
		if (workScreen) {
			self.lastFocusedWorkScreen = workScreen;
			return workScreen;
		}
		if (self.lastFocusedWorkScreen) {
			for (NSScreen *screen in [NSScreen screens]) {
				if (screen == self.lastFocusedWorkScreen) {
					return screen;
				}
			}
		}
		NSScreen *frontScreen = [NSScreen mainScreen];
		if (frontScreen) {
			return frontScreen;
		}
		// Deterministic fallback to built-in physical notch screen
		for (NSScreen *screen in [NSScreen screens]) {
			if (IsBuiltinScreen(screen) && ScreenHasPhysicalNotch(screen)) {
				return screen;
			}
		}
		return [NSScreen screens].firstObject;
	}
	NSScreen *builtin = nil;
	for (NSScreen *screen in [NSScreen screens]) {
		if (IsBuiltinScreen(screen) && ScreenHasPhysicalNotch(screen)) {
			builtin = screen;
			break;
		}
	}
	if (!builtin) {
		for (NSScreen *screen in [NSScreen screens]) {
			if (ScreenHasPhysicalNotch(screen)) {
				builtin = screen;
				break;
			}
		}
	}
	return builtin ?: [NSScreen mainScreen] ?: [NSScreen screens].firstObject;
}

- (CGFloat)measureStringWidth:(NSString *)str font:(NSFont *)font {
	if (!str.length) {
		return 0;
	}
	NSDictionary *attrs = @{ NSFontAttributeName: font };
	return [str sizeWithAttributes:attrs].width;
}

- (BOOL)isGlanceableSurface {
	return self.content.peekOnly || self.attentionPeek || !(self.content.expanded || self.pinned);
}

- (BOOL)framesEffectivelyEqual:(NSRect)a to:(NSRect)b {
	const CGFloat tol = 0.5;
	return fabs(a.origin.x - b.origin.x) <= tol
		&& fabs(a.origin.y - b.origin.y) <= tol
		&& fabs(a.size.width - b.size.width) <= tol
		&& fabs(a.size.height - b.size.height) <= tol;
}

- (void)refreshContentOnly {
	self.contentOnlyUpdateCount++;
	self.lastTransitionReason = @"content";
	// Never snap shape/alpha or cancel morphPath — content updates must not interrupt geometry.
	self.content.reservedFooterHeight = [self computeControlsStackHeight] + kContentFooterGutter;
	// Always refresh control chrome. Mid-morph, target lastRequestedFrame so pending
	// options/approvals are not deferred until a stale completion handler runs.
	if (self.panel) {
		NSRect layoutWin = self.panel.frame;
		if (self.transitionInFlight && !NSEqualRects(self.lastRequestedFrame, NSZeroRect)) {
			layoutWin = self.lastRequestedFrame;
		} else if (!NSEqualRects(self.lastRequestedFrame, NSZeroRect)
			&& NSHeight(self.lastRequestedFrame) >= NSHeight(layoutWin)) {
			layoutWin = self.lastRequestedFrame;
		}
		// Size the content view to the target geometry BEFORE measuring text, otherwise
		// interactive content is laid out against a stale compact bounds and disappears.
		if (NSHeight(layoutWin) > 0 && NSWidth(layoutWin) > 0) {
			[self.content setFrameSize:layoutWin.size];
		}
		[self layoutControls:layoutWin];
		[self.content refreshContentSubviewsPreservingPresentation];
		[self layoutControls:layoutWin];
		// If the panel has reached the requested frame (or the morph budget elapsed),
		// clear transitionInFlight so content-only settle diagnostics stay truthful.
		NSTimeInterval now = [NSDate timeIntervalSinceReferenceDate];
		if (self.transitionInFlight
			&& (now >= self.transitionEndTime
				|| [self framesEffectivelyEqual:self.panel.frame to:self.lastRequestedFrame])) {
			if (![self framesEffectivelyEqual:self.panel.frame to:self.lastRequestedFrame]) {
				[self.panel setFrame:self.lastRequestedFrame display:YES];
				self.content.shapeLayer.frame = CGRectMake(0, 0, self.lastRequestedFrame.size.width, self.lastRequestedFrame.size.height);
				self.content.shapeMaskLayer.frame = CGRectMake(0, 0, self.lastRequestedFrame.size.width, self.lastRequestedFrame.size.height);
			}
			self.transitionInFlight = NO;
		}
	} else {
		[self.content refreshContentSubviewsPreservingPresentation];
	}
}

- (CGFloat)computeLeftWingWidth {
	return kStableCompactLeftWing;
}

- (CGFloat)computeRightWingWidth {
	return kStableCompactRightWing;
}

/** Prefer the natural notch span; widen only when option chips need horizontal room. */
- (CGFloat)computeExpandedWidth:(CGFloat)naturalW {
	if ([self.pendingKind isEqualToString:@"question"] && self.pendingOptions.count > 2) {
		return naturalW + kExpandedWidthPad;
	}
	return naturalW;
}

/** Footer control stack height inside expandedContainer (options / approval / composer). */
- (CGFloat)computeControlsStackHeight {
	BOOL expanded = self.content.expanded || self.pinned;
	if (!expanded || self.content.peekOnly) {
		return 0;
	}
	BOOL hasOptions = ([self.pendingKind isEqualToString:@"question"] && self.pendingOptions.count > 0);
	BOOL hasApproval = [self.pendingKind isEqualToString:@"approval"];
	// Must match layoutControls bottom-up stack (composer + approval + option rows + pads).
	CGFloat h = 7; // bottom safe pad under composer
	h += hasOptions ? 0 : (kControlHeight + 7); // composer row
	if (hasApproval) {
		h += kControlHeight; // approval buttons row
	}
	if (hasOptions) {
		NSInteger totalOpts = (NSInteger)self.pendingOptions.count;
		NSInteger maxDirect = totalOpts > 4 ? 3 : totalOpts;
		NSInteger perRow = (maxDirect >= 3) ? 2 : MAX(1, maxDirect);
		NSInteger rows = MAX(1, (NSInteger)ceil((double)maxDirect / (double)perRow));
		if (totalOpts > 4) {
			rows = MAX(rows, (NSInteger)ceil((double)(maxDirect + 1) / (double)perRow));
		}
		CGFloat optionsH = rows * kControlHeight + MAX(0, rows - 1) * 4;
		h += optionsH;
	}
	return h;
}

/** Geometry signature — excludes activity/message/action label text. */
- (NSString *)geometrySignatureForBandH:(CGFloat)bandH {
	BOOL expanded = self.content.expanded || self.pinned;
	BOOL peek = self.content.peekOnly || self.attentionPeek;
	NSInteger optionCount = [self.pendingKind isEqualToString:@"question"] ? (NSInteger)self.pendingOptions.count : 0;
	BOOL hasApproval = [self.pendingKind isEqualToString:@"approval"];
	NSString *base = [NSString stringWithFormat:@"e=%d;p=%d;pin=%d;att=%d;kind=%@;opts=%ld;appr=%d;band=%.1f;notch=%d;h=%.1f;lw=%.1f;rw=%.1f",
		expanded ? 1 : 0,
		peek ? 1 : 0,
		self.pinned ? 1 : 0,
		self.content.attention ? 1 : 0,
		self.pendingKind ?: @"",
		(long)optionCount,
		hasApproval ? 1 : 0,
		bandH,
		self.content.notched ? 1 : 0,
		self.content.housingWidth,
		self.content.leftWingWidth,
		self.content.rightWingWidth];
	BOOL hasPending = self.content.pendingTitle.length > 0 || self.content.pendingMessage.length > 0;
	if (hasPending) {
		return [NSString stringWithFormat:@"%@;pt=%lu;pm=%lu", base, (unsigned long)self.content.pendingTitle.length, (unsigned long)self.content.pendingMessage.length];
	}
	return base;
}

- (CGFloat)computeTargetContentHeight:(CGFloat)bandH {
	BOOL expanded = self.content.expanded || self.pinned;
	if (!expanded) {
		self.pinnedInteractiveHeight = 0;
		self.lastGeometrySignature = [self geometrySignatureForBandH:bandH];
		return bandH;
	}
	// Peek / attentionPeek: fixed body height — message length must not reflow geometry.
	if ((self.content.peekOnly || self.attentionPeek) && !self.pinned) {
		self.pinnedInteractiveHeight = 0;
		self.lastGeometrySignature = [self geometrySignatureForBandH:bandH];
		return bandH + kPeekBodyHeight;
	}

	NSString *signature = [self geometrySignatureForBandH:bandH];
	// Same semantic layout: reuse pinned height so text/elapsed/action labels cannot morph geometry.
	if (self.pinnedInteractiveHeight >= kExpandedHeightMin
		&& self.lastGeometrySignature.length
		&& [self.lastGeometrySignature isEqualToString:signature]) {
		return self.pinnedInteractiveHeight;
	}

	// Measured natural height for a NEW geometry signature only.
	CGFloat naturalW = MAX(kStableCompactLeftWing + kCameraHousingMin + kStableCompactRightWing,
		self.content.leftWingWidth + self.content.housingWidth + self.content.rightWingWidth);
	CGFloat totalW = [self computeExpandedWidth:naturalW];
	CGFloat contentW = MAX(40, totalW - (kContentInsetX + kContentSafeExtraX) * 2);
	CGFloat h = bandH + kContentInsetTop;
	h += kHeaderRowHeight + kContentGap;

	NSFont *pendingTitleFont = self.content.pendingInteractionTitle.font ?: [NSFont systemFontOfSize:12 weight:NSFontWeightSemibold];
	NSFont *pendingMsgFont = self.content.pendingInteractionMessage.font ?: [NSFont systemFontOfSize:11 weight:NSFontWeightRegular];
	NSFont *activityFont = self.content.activityDescription.font ?: [NSFont systemFontOfSize:11.5 weight:NSFontWeightMedium];
	NSFont *messageFont = self.content.latestMessageLabel.font ?: [NSFont systemFontOfSize:11 weight:NSFontWeightRegular];

	BOOL hasPending = self.content.pendingTitle.length > 0 || self.content.pendingMessage.length > 0;
	if (self.content.pendingTitle.length) {
		h += MeasureTextHeight(self.content.pendingTitle, pendingTitleFont, contentW, 2) + kContentGap;
	}
	if (self.content.pendingMessage.length) {
		h += MeasureTextHeight(self.content.pendingMessage, pendingMsgFont, contentW, 3) + kContentGap;
	}
	if (!hasPending) {
		// Working surface: activity OR latest message (not both) + fixed action-row budget.
		if (self.content.activityLabel.length) {
			h += MeasureTextHeight(self.content.activityLabel, activityFont, contentW, 2) + kContentGap;
		} else if (self.content.latestMessage.length) {
			h += MeasureTextHeight(self.content.latestMessage, messageFont, contentW, 2) + kContentGap;
		}
		NSInteger actionCount = MIN((NSInteger)self.content.actions.count, 3);
		h += actionCount * (kActionRowHeight + kContentGap);
		if (self.content.metricsLabel.length) {
			h += 14 + kContentGap;
		}
	}
	h += [self computeControlsStackHeight];
	h += kContentFooterGutter;
	h += 8; // Bottom corner inset
	CGFloat target = MIN(kExpandedHeightMax, MAX(kExpandedHeightMin, h));
	self.pinnedInteractiveHeight = target;
	self.lastGeometrySignature = signature;
	return target;
}

- (void)layoutForScreen {
	BOOL forceMorph = self.pendingPresentationMorph;
	self.pendingPresentationMorph = NO;

	NSScreen *screen = [self targetScreen];
	BOOL expanded = self.content.expanded || self.pinned;
	self.content.targetExpanded = expanded;

	if (!screen) {
		// Headless / no NSScreen: size a synthetic panel so interactive/pending chrome
		// and layout diagnostics remain meaningful in Node smoke harnesses.
		if (self.content.safeAreaTop <= 0) {
			self.content.safeAreaTop = kCollapsedHeight;
		}
		if (self.content.leftWingWidth <= 0) {
			self.content.leftWingWidth = kStableCompactLeftWing;
		}
		if (self.content.rightWingWidth <= 0) {
			self.content.rightWingWidth = kStableCompactRightWing;
		}
		if (self.content.housingWidth <= 0) {
			self.content.housingWidth = kCameraHousingMin;
		}
		CGFloat bandH = MAX(self.content.safeAreaTop, kCollapsedHeight);
		CGFloat height = expanded ? [self computeTargetContentHeight:bandH] : bandH;
		CGFloat naturalW = self.content.leftWingWidth + self.content.housingWidth + self.content.rightWingWidth;
		CGFloat width = expanded ? [self computeExpandedWidth:naturalW] : naturalW;
		NSRect win = self.panel ? self.panel.frame : NSMakeRect(0, 0, width, height);
		win.size.width = width;
		win.size.height = height;
		BOOL isFirstLayout = !self.hasLaidOutOnce;
		BOOL frameUnchanged = !isFirstLayout && [self framesEffectivelyEqual:win to:self.lastRequestedFrame];
		self.lastRequestedFrame = win;
		self.hasLaidOutOnce = YES;
		if (frameUnchanged && !forceMorph) {
			if (self.panel) {
				[self refreshContentOnly];
			}
			// Target geometry unchanged — drop stale morph flag so content settles are observable.
			self.transitionInFlight = NO;
			return;
		}
		if (forceMorph || !frameUnchanged) {
			self.geometryTransitionCount++;
			self.lastTransitionReason = isFirstLayout ? @"firstLayout" : @"geometry";
		}
		if (self.panel) {
			[self.panel setFrame:win display:YES];
			[self.panel.contentView setFrameSize:win.size];
			[self layoutControls:win];
			[self.content updateShapeAndContentAnimated:(forceMorph && !self.reducedMotion)
											  duration:(forceMorph && !self.reducedMotion) ? 0.18 : 0
										useTargetState:YES
											targetSize:win.size];
		}
		return;
	}
	NSRect frame = screen.frame;
	NSEdgeInsets insets = screen.safeAreaInsets;
	NSRect auxLeft = screen.auxiliaryTopLeftArea;
	NSRect auxRight = screen.auxiliaryTopRightArea;
	BOOL notched = ScreenHasPhysicalNotch(screen);
	self.content.notched = notched;
	self.content.safeAreaTop = insets.top;
	self.panel.hasShadow = !notched;
	CGFloat topY = NSMaxY(frame);
	CGFloat bandH = MAX(insets.top, kCollapsedHeight);

	NSRect win;
	if (notched) {
		CGFloat housing = MAX(kCameraHousingMin, NSMinX(auxRight) - NSMaxX(auxLeft));
		self.content.housingWidth = housing;
		CGFloat leftW = [self computeLeftWingWidth];
		CGFloat rightW = [self computeRightWingWidth];
		self.content.leftWingWidth = leftW;
		self.content.rightWingWidth = rightW;

		CGFloat totalW = leftW + housing + rightW;
		CGFloat height = [self computeTargetContentHeight:bandH];

		if (expanded) {
			CGFloat expandedW = [self computeExpandedWidth:totalW];
			if (expandedW > totalW + 0.5) {
				totalW = expandedW;
				CGFloat notchCenterX = NSMaxX(auxLeft) + housing / 2.0;
				CGFloat winX = notchCenterX - totalW / 2.0;
				win = NSMakeRect(winX, topY - height, totalW, height);
				self.collapsedHit = NSMakeRect(winX, topY - bandH, totalW, bandH);
			} else {
				CGFloat winX = NSMaxX(auxLeft) - leftW;
				win = NSMakeRect(winX, topY - height, totalW, height);
				self.collapsedHit = NSMakeRect(winX, topY - bandH, totalW, bandH);
			}
		} else {
			CGFloat winX = NSMaxX(auxLeft) - leftW;
			win = NSMakeRect(winX, topY - bandH, totalW, bandH);
			self.collapsedHit = win;
		}
	} else {
		self.content.housingWidth = 0;
		CGFloat height = [self computeTargetContentHeight:kPillHeight];
		CGFloat w = expanded ? [self computeExpandedWidth:kPillWidth] : kPillWidth;
		CGFloat h = expanded ? height : kPillHeight;
		win = NSMakeRect(NSMidX(frame) - w / 2.0, topY - h, w, h);
		self.collapsedHit = NSMakeRect(NSMidX(frame) - kPillWidth / 2.0, topY - kPillHeight, kPillWidth, kPillHeight);
	}
	BOOL isFirstLayout = !self.hasLaidOutOnce;
	BOOL frameUnchanged = !isFirstLayout && [self framesEffectivelyEqual:win to:self.lastRequestedFrame];
	self.lastRequestedFrame = win;
	self.hasLaidOutOnce = YES;
	self.layoutScreen = screen;
	self.panel.level = LiveActivityWindowLevel();

	NSTimeInterval animDuration = (win.size.height > self.panel.frame.size.height) ? 0.24 : 0.18;

	// Identical geometry: content refresh only.
	if (frameUnchanged && !forceMorph) {
		[self refreshContentOnly];
		// Target geometry unchanged — drop stale morph flag so content settles are observable.
		self.transitionInFlight = NO;
		return;
	}

	self.geometryTransitionCount++;
	self.layoutCompletionGeneration++;
	self.lastTransitionReason = isFirstLayout ? @"firstLayout" : @"geometry";

	// Pre-position controls before/during the frame morph so the expanding
	// surface is never an empty black rectangle.
	[self layoutControls:win];

	if (self.reducedMotion) {
		[self.panel setFrame:win display:YES animate:NO];
		[self.content updateShapeAndContentAnimated:NO duration:0 useTargetState:YES targetSize:win.size];
	} else if (isFirstLayout || (frameUnchanged && forceMorph)) {
		// First layout / same-frame morph: snap the window, animate shape only when forced.
		if (!frameUnchanged || isFirstLayout) {
			[self.panel setFrame:win display:YES animate:NO];
		}
		[self.content updateShapeAndContentAnimated:forceMorph duration:forceMorph ? animDuration : 0 useTargetState:YES targetSize:win.size];
	} else {
		// Shape morph uses transitionGeneration; frame completion uses
		// layoutCompletionGeneration (bumped only on genuine geometry changes)
		// so content-only updates do not cancel control finalization.
		const NSUInteger generation = ++self.transitionGeneration;
		self.layoutCompletionGeneration = generation;
		self.transitionInFlight = YES;
		self.transitionEndTime = [NSDate timeIntervalSinceReferenceDate] + animDuration;
		[self.content updateShapeAndContentAnimated:YES duration:animDuration useTargetState:YES targetSize:win.size];
		[NSAnimationContext runAnimationGroup:^(NSAnimationContext *context) {
			context.duration = animDuration;
			context.timingFunction = [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseInEaseOut];
			context.allowsImplicitAnimation = YES;
			[[self.panel animator] setFrame:win display:YES];
		} completionHandler:^{
			// Delay control layout until frame animation completes to prevent visible popping
			if (generation == self.transitionGeneration) {
				if (self.panel) {
					[self.panel setFrame:win display:YES];
				}
				self.transitionInFlight = NO;
				self.content.shapeLayer.frame = CGRectMake(0, 0, win.size.width, win.size.height);
				self.content.shapeMaskLayer.frame = CGRectMake(0, 0, win.size.width, win.size.height);
				NSRect settled = self.panel ? self.panel.frame : win;
				[self layoutControls:settled];
				[self.content refreshContentSubviewsPreservingPresentation];
				[self layoutControls:settled];
			}
		}];
	}
}

- (void)layoutControls:(NSRect)win {
	BOOL showInput = (self.content.expanded || self.pinned) && !self.content.peekOnly;
	BOOL approval = [self.pendingKind isEqualToString:@"approval"];
	BOOL question = [self.pendingKind isEqualToString:@"question"];
	BOOL showAttention = (self.content.expanded || self.pinned) && !self.content.peekOnly;
	BOOL hasOptions = (question && self.pendingOptions.count > 0);
	if (hasOptions) {
		showInput = NO;
	}
	self.approveButton.hidden = !(approval && showAttention);
	self.denyButton.hidden = self.approveButton.hidden;
	for (NSButton *button in self.optionButtons) {
		button.hidden = YES;
	}

	if (!showAttention) {
		self.input.hidden = YES;
		self.openButton.hidden = YES;
		self.pinButton.hidden = YES;
		self.approveButton.hidden = YES;
		self.denyButton.hidden = YES;
		return;
	}

	CGFloat bandH = MAX(self.content.safeAreaTop, kCollapsedHeight);
	CGFloat effectiveH = win.size.height;
	CGFloat bodyHeight = effectiveH - bandH;
	// Keep the expanded container synchronized with the geometry we lay into so
	// diagnostics and hit-testing match control frames (avoids panel/path desync).
	if (self.content.expandedContainer) {
		self.content.expandedContainer.frame = NSMakeRect(0, bandH, NSWidth(win), MAX(0, bodyHeight));
		self.content.compactContainer.frame = NSMakeRect(0, 0, NSWidth(win), bandH);
	}
	if (bodyHeight < 36.0) {
		self.input.hidden = YES;
		self.openButton.hidden = YES;
		self.pinButton.hidden = YES;
		self.approveButton.hidden = YES;
		self.denyButton.hidden = YES;
		return;
	}

	const CGFloat gap = 6;
	// Path-aware footer inset: bottom corners eat horizontal space.
	CGFloat footerInset = ContentSafeInsetX(self.content.notched);
	CGFloat bottomY = bodyHeight - kControlHeight - 7;
	CGFloat usableW = NSWidth(win) - footerInset * 2;

	[self updatePinButtonState];
	self.pinButton.hidden = NO;
	self.openButton.hidden = NO;

	// Footer composer row: [ composer ........ ] [pin] [open]
	if (hasOptions) {
		self.input.hidden = YES;
		// Options own the footer; place pin/open in header row next to statusBadge
		CGFloat headerInset = ContentSafeInsetX(self.content.notched);
		CGFloat topY = kContentInsetTop + (kHeaderRowHeight - kIconControlSize) * 0.5;
		CGFloat statusW = NSWidth(self.content.statusBadge.frame);
		CGFloat rightEdge = NSWidth(win) - headerInset - statusW - 8;
		self.openButton.frame = NSMakeRect(rightEdge - kIconControlSize, topY, kIconControlSize, kIconControlSize);
		self.pinButton.frame = NSMakeRect(rightEdge - kIconControlSize * 2 - gap, topY, kIconControlSize, kIconControlSize);
	} else if (showInput) {
		self.input.hidden = NO;
		CGFloat trailing = kIconControlSize * 2 + gap * 2;
		CGFloat composerW = MAX(72, usableW - trailing);
		self.input.frame = NSMakeRect(footerInset, bottomY, composerW, kControlHeight);
		self.pinButton.frame = NSMakeRect(footerInset + composerW + gap, bottomY + (kControlHeight - kIconControlSize) * 0.5, kIconControlSize, kIconControlSize);
		self.openButton.frame = NSMakeRect(footerInset + composerW + gap + kIconControlSize + gap, bottomY + (kControlHeight - kIconControlSize) * 0.5, kIconControlSize, kIconControlSize);
		bottomY -= (kControlHeight + 7);
	} else {
		self.input.hidden = YES;
		self.pinButton.frame = NSMakeRect(NSWidth(win) - footerInset - kIconControlSize * 2 - gap, bottomY + (kControlHeight - kIconControlSize) * 0.5, kIconControlSize, kIconControlSize);
		self.openButton.frame = NSMakeRect(NSWidth(win) - footerInset - kIconControlSize, bottomY + (kControlHeight - kIconControlSize) * 0.5, kIconControlSize, kIconControlSize);
		bottomY -= (kControlHeight + 6);
	}

	BOOL controlsEnabled = !self.actionInFlight;
	self.approveButton.enabled = controlsEnabled;
	self.denyButton.enabled = controlsEnabled;
	for (NSButton *btn in self.optionButtons) {
		btn.enabled = controlsEnabled;
	}
	// In-flight: keep truthful action titles; communicate busy via opacity (not verb morphing).
	CGFloat actionAlpha = self.actionInFlight ? 0.55 : 1.0;
	self.approveButton.alphaValue = actionAlpha;
	self.denyButton.alphaValue = actionAlpha;

	if (!self.approveButton.hidden) {
		NSString *approveTitle = self.pendingDestructive ? @"Approve (destructive)" : @"Approve";
		self.approveButton.title = approveTitle;
		NSDictionary *apprAttrs = @{
			NSFontAttributeName: self.approveButton.font ?: [NSFont systemFontOfSize:11.5 weight:NSFontWeightSemibold],
			NSForegroundColorAttributeName: [NSColor whiteColor],
		};
		self.approveButton.attributedTitle = [[NSAttributedString alloc] initWithString:approveTitle attributes:apprAttrs];
		self.approveButton.accessibilityLabel = self.actionInFlight ? @"Approve (in progress)" : approveTitle;

		if (self.pendingDestructive) {
			self.approveButton.layer.backgroundColor = [NSColor colorWithCalibratedRed:0.72 green:0.20 blue:0.20 alpha:0.95].CGColor;
			self.approveButton.layer.borderColor = [NSColor colorWithCalibratedRed:0.88 green:0.35 blue:0.35 alpha:0.55].CGColor;
		} else {
			self.approveButton.layer.backgroundColor = [NSColor colorWithCalibratedRed:0.16 green:0.54 blue:0.32 alpha:0.95].CGColor;
			self.approveButton.layer.borderColor = [NSColor colorWithCalibratedRed:0.30 green:0.72 blue:0.46 alpha:0.55].CGColor;
		}

		self.denyButton.title = @"Deny";
		NSDictionary *denyAttrs = @{
			NSFontAttributeName: self.denyButton.font ?: [NSFont systemFontOfSize:11.5 weight:NSFontWeightMedium],
			NSForegroundColorAttributeName: [NSColor colorWithCalibratedWhite:0.92 alpha:1.0],
		};
		self.denyButton.attributedTitle = [[NSAttributedString alloc] initWithString:@"Deny" attributes:denyAttrs];
		self.denyButton.accessibilityLabel = self.actionInFlight ? @"Deny (in progress)" : @"Deny";
		self.denyButton.layer.backgroundColor = [NSColor colorWithCalibratedWhite:0.18 alpha:0.90].CGColor;
		self.denyButton.layer.borderColor = [NSColor colorWithCalibratedWhite:0.36 alpha:0.45].CGColor;

		CGFloat denyW = 64;
		CGFloat approveW = self.pendingDestructive ? 168 : 86;
		// Keep Deny/Approve inside the safe footer width (natural notch span can be < 156pt).
		approveW = MIN(approveW, MAX(48, usableW - denyW - gap));
		if (denyW + gap + approveW > usableW + 0.5) {
			denyW = MAX(40, usableW - gap - approveW);
		}
		self.denyButton.frame = NSMakeRect(footerInset, bottomY, denyW, kControlHeight);
		self.approveButton.frame = NSMakeRect(footerInset + denyW + gap, bottomY, approveW, kControlHeight);
		bottomY -= (kControlHeight + kContentFooterGutter);
	}

	if (question && showAttention) {
		NSInteger totalOpts = (NSInteger)self.pendingOptions.count;
		NSInteger maxDirect = totalOpts > 4 ? 3 : totalOpts;
		// Prefer 2-column grids for 3–4 options (avoids a lonely third/fourth chip row).
		NSInteger perRow = (maxDirect >= 3) ? 2 : MAX(1, maxDirect);
		CGFloat colW = floor((usableW - gap) / 2.0);
		CGFloat slotW = (perRow == 2) ? colW : MIN(140, MAX(56, usableW));
		NSInteger rows = MAX(1, (NSInteger)ceil((double)maxDirect / (double)perRow));
		if (totalOpts > 4) {
			rows = MAX(rows, (NSInteger)ceil((double)(maxDirect + 1) / (double)perRow));
		}
		// Layout top→bottom so wrapped chips do not appear orphaned above the first row.
		CGFloat optionsTop = MAX(0, bottomY - (rows - 1) * (kControlHeight + 4));
		CGFloat x = footerInset;
		CGFloat rowY = optionsTop;
		NSInteger col = 0;
		for (NSInteger i = 0; i < maxDirect && i < (NSInteger)self.optionButtons.count; i++) {
			NSDictionary *option = self.pendingOptions[i];
			NSButton *button = self.optionButtons[i];
			NSString *label = option[@"label"] ?: option[@"id"] ?: @"Option";
			button.title = label;
			NSDictionary *titleAttrs = @{
				NSFontAttributeName: button.font ?: [NSFont systemFontOfSize:11 weight:NSFontWeightMedium],
				NSForegroundColorAttributeName: [NSColor colorWithCalibratedWhite:0.92 alpha:1.0],
			};
			button.attributedTitle = [[NSAttributedString alloc] initWithString:label attributes:titleAttrs];
			button.accessibilityLabel = self.actionInFlight ? [NSString stringWithFormat:@"%@ (in progress)", label] : label;
			button.alphaValue = actionAlpha;
			CGFloat width = (perRow == 2) ? colW : MIN(slotW, MAX(56, [label sizeWithAttributes:@{ NSFontAttributeName: button.font }].width + 20));
			if (col >= perRow) {
				col = 0;
				x = footerInset;
				rowY += (kControlHeight + 4);
			}
			button.hidden = NO;
			button.frame = NSMakeRect(x, rowY, width, kControlHeight);
			x += width + gap;
			col++;
		}
		if (totalOpts > 4 && self.optionButtons.count >= 4) {
			NSButton *moreButton = self.optionButtons[3];
			moreButton.title = @"More…";
			NSDictionary *moreAttrs = @{
				NSFontAttributeName: moreButton.font ?: [NSFont systemFontOfSize:11 weight:NSFontWeightMedium],
				NSForegroundColorAttributeName: [NSColor colorWithCalibratedWhite:0.92 alpha:1.0],
			};
			moreButton.attributedTitle = [[NSAttributedString alloc] initWithString:@"More…" attributes:moreAttrs];
			moreButton.accessibilityLabel = @"More options in PreBase";
			moreButton.alphaValue = 1.0;
			CGFloat moreW = (perRow == 2) ? colW : MIN(72, slotW);
			if (col >= perRow) {
				col = 0;
				x = footerInset;
				rowY += (kControlHeight + 4);
			}
			moreButton.hidden = NO;
			moreButton.frame = NSMakeRect(x, rowY, moreW, kControlHeight);
		}
	}
}

- (void)performUserHaptic {
	[self performUserHapticWithReason:@"hover"];
}

- (void)performUserHapticWithReason:(NSString *)reason {
	self.hapticCount++;
	if ([reason isEqualToString:@"hover"]) {
		self.hoverHapticCount++;
	}
	self.lastHapticReason = reason ?: @"unknown";
	id<NSHapticFeedbackPerformer> performer = [NSHapticFeedbackManager defaultPerformer];
	if (performer) {
		[performer performFeedbackPattern:NSHapticFeedbackPatternGeneric performanceTime:NSHapticFeedbackPerformanceTimeNow];
	}
}

- (void)installMonitor {
	if (self.globalMonitor) {
		return;
	}
	__weak PrebaseLiveActivityController *weakSelf = self;
	self.globalMonitor = [NSEvent addGlobalMonitorForEventsMatchingMask:NSEventMaskMouseMoved handler:^(NSEvent *event) {
		PrebaseLiveActivityController *strong = weakSelf;
		if (!strong || gDisposed || !strong.visible) {
			return;
		}
		if ([strong.displayMode isEqualToString:@"active"]) {
			NSScreen *activeScreen = [strong targetScreen];
			if (activeScreen && activeScreen != strong.layoutScreen) {
				[strong layoutForScreen];
			}
		}
		if (strong.pinned || strong.attentionPeek || strong.content.peekOnly || (strong.content.expanded && !strong.attentionPeek)) {
			return;
		}
		NSPoint p = [NSEvent mouseLocation];
		BOOL inside = NSPointInRect(p, strong.collapsedHit);
		if (inside != strong.lastInside) {
			strong.lastInside = inside;
			[strong pointerInside:inside];
		}
	}];
}

- (void)installLocalKeyMonitor {
	if (self.localMonitor) {
		return;
	}
	__weak PrebaseLiveActivityController *weakSelf = self;
	self.localMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskKeyDown handler:^NSEvent *(NSEvent *event) {
		PrebaseLiveActivityController *strong = weakSelf;
		if (!strong || gDisposed || event.keyCode != 53) {
			return event;
		}
		if (strong.pinned || strong.content.expanded || strong.content.peekOnly) {
			// Emit dismissAttention before unpin so renderer sticky Escape wins the race.
			const BOOL attentionDismiss = strong.content.attention;
			if (attentionDismiss) {
				strong.userDismissedAttention = YES;
				[strong emit:@"dismissAttention" extras:nil];
			}
			const BOOL wasPinned = strong.pinned;
			strong.pinned = NO;
			[strong updatePinButtonState];
			// Only emit unpin when sticky Interactive was actually pinned (avoid spurious commands).
			if (wasPinned) {
				[strong emit:@"unpin" extras:nil];
			}
			[strong collapseEmittingDismiss:!attentionDismiss];
			return nil;
		}
		return event;
	}];
}

- (void)removeLocalKeyMonitor {
	if (self.localMonitor) {
		[NSEvent removeMonitor:self.localMonitor];
		self.localMonitor = nil;
	}
}

- (void)removeGlobalMonitorOnly {
	if (self.globalMonitor) {
		[NSEvent removeMonitor:self.globalMonitor];
		self.globalMonitor = nil;
	}
}

- (void)removeMonitors {
	[self removeGlobalMonitorOnly];
	[self removeLocalKeyMonitor];
}

- (void)mouseEnteredInView:(NSEvent *)event {
	[self.exitTimer invalidate];
	self.exitTimer = nil;
	self.hovering = YES;
}

- (void)mouseExitedFromView:(NSEvent *)event {
	self.hovering = NO;
	// Attention peek is not hover-owned — only Escape/resolve/sticky Interactive dismisses it.
	if (self.pinned || !self.content.expanded || self.attentionPeek || self.content.attention) {
		return;
	}
	// Active input interaction keeps interactive panel alive even if cursor leaves bounds
	if (self.panel.firstResponder == self.input.currentEditor || self.input.stringValue.length > 0) {
		return;
	}
	[self.exitTimer invalidate];
	__weak PrebaseLiveActivityController *weakSelf = self;
	self.exitTimer = [NSTimer scheduledTimerWithTimeInterval:kExitGraceInterval repeats:NO block:^(NSTimer *timer) {
		[weakSelf collapse];
	}];
}

- (void)pointerInside:(BOOL)inside {
	self.lastInside = inside;
	if (inside) {
		if (self.screenLocked || self.pinned || self.attentionPeek || self.content.peekOnly) {
			return;
		}
		// Sticky Escape: attention stays compact until click; hover must not reopen peek.
		if (self.content.attention && self.userDismissedAttention) {
			return;
		}
		[self.exitTimer invalidate];
		self.exitTimer = nil;
		if (!self.hovering) {
			self.hovering = YES;
			const NSUInteger sessionToken = ++self.hoverSessionToken;
			[self.hoverTimer invalidate];
			__weak PrebaseLiveActivityController *weakSelf = self;
			self.hoverTimer = [NSTimer scheduledTimerWithTimeInterval:kHoverDwellInterval repeats:NO block:^(NSTimer *timer) {
				PrebaseLiveActivityController *strong = weakSelf;
				if (!strong || gDisposed || strong.screenLocked || !strong.visible || !strong.hovering || !strong.lastInside) {
					return;
				}
				if (strong.hoverSessionToken != sessionToken) {
					return;
				}
				if (!strong.didHoverHaptic) {
					strong.didHoverHaptic = YES;
					[strong performUserHapticWithReason:@"hover"];
				}
				[strong expandPeek];
			}];
		}
	} else {
		self.hoverSessionToken++;
		[self.hoverTimer invalidate];
		self.hoverTimer = nil;
		self.hovering = NO;
		self.didHoverHaptic = NO;
		if (self.content.expanded) {
			if (self.panel.firstResponder == self.input.currentEditor || self.input.stringValue.length > 0) {
				return;
			}
			__weak PrebaseLiveActivityController *weakSelf = self;
			[self.exitTimer invalidate];
			self.exitTimer = [NSTimer scheduledTimerWithTimeInterval:kExitGraceInterval repeats:NO block:^(NSTimer *timer) {
				[weakSelf collapse];
			}];
		}
	}
}

- (void)expandPeek {
	if (!self.visible || self.screenLocked) {
		return;
	}
	// Sticky Escape: do not reopen peek while attention remains dismissed.
	if (self.content.attention && self.userDismissedAttention) {
		return;
	}
	// Fullscreen policy: suppress hover Peek while PreBase is immersed (attention still allowed).
	if (self.prebaseFullscreen && !self.content.attention) {
		return;
	}
	self.attentionPeek = NO;
	self.content.peekOnly = YES;
	self.content.expanded = YES;
	self.content.targetExpanded = YES;
	self.panel.ignoresMouseEvents = NO;
	self.ignoresMouse = NO;
	[self removeLocalKeyMonitor];
	[self removeGlobalMonitorOnly];
	self.pendingPresentationMorph = YES;
	[self layoutForScreen];
}

- (void)expandInteractive {
	if (!self.visible || self.screenLocked) {
		return;
	}
	self.attentionPeek = NO;
	self.content.peekOnly = NO;
	self.content.expanded = YES;
	self.content.targetExpanded = YES;
	self.hovering = YES;
	self.lastInside = YES;
	[self.exitTimer invalidate];
	self.exitTimer = nil;
	self.panel.ignoresMouseEvents = NO;
	self.ignoresMouse = NO;
	[self installLocalKeyMonitor];
	[self removeGlobalMonitorOnly];
	self.pinButton.hidden = NO;
	self.openButton.hidden = NO;
	self.input.hidden = NO;
	self.pendingPresentationMorph = YES;
	[self layoutForScreen];
}

/** Peek/Attention click → sticky Interactive (same path for physical + simulated click). */
- (void)enterInteractiveSticky {
	if (!self.visible || self.screenLocked) {
		return;
	}
	self.userDismissedAttention = NO;
	[self expandInteractive];
}

- (void)expandPreview {
	self.panel.ignoresMouseEvents = NO;
	[self expandInteractive];
}

- (void)collapse {
	[self collapseEmittingDismiss:YES];
}

- (void)collapseEmittingDismiss:(BOOL)emitDismiss {
	if (self.pinned) {
		return;
	}
	if (self.content.attention) {
		self.userDismissedAttention = YES;
		if (emitDismiss) {
			[self emit:@"dismissAttention" extras:nil];
		}
	}
	self.hoverSessionToken++;
	self.attentionPeek = NO;
	self.content.peekOnly = NO;
	self.content.expanded = NO;
	self.content.targetExpanded = NO;
	self.panel.ignoresMouseEvents = YES;
	self.ignoresMouse = YES;
	self.didHoverHaptic = NO;
	self.hovering = NO;
	self.lastInside = NO;
	[self.hoverTimer invalidate];
	self.hoverTimer = nil;
	[self.exitTimer invalidate];
	self.exitTimer = nil;
	self.input.hidden = YES;
	[self removeLocalKeyMonitor];
	[self.panel makeFirstResponder:nil];
	self.pendingPresentationMorph = YES;
	[self layoutForScreen];
	// Restore global acquisition monitor for collapsed mode
	if (self.visible) {
		[self installMonitor];
	}
}

- (void)emit:(NSString *)kind extras:(NSDictionary *)extras {
	self.lastNativeCommand = kind;
	if (!gCommandTsfn || gDisposed) {
		return;
	}
	NSMutableDictionary *payload = [@{
		@"kind": kind,
		@"sessionId": self.sessionId ?: @"",
		@"sessionResource": self.sessionResource ?: @"",
		@"revision": @(self.revision)
	} mutableCopy];
	if (extras) {
		[payload addEntriesFromDictionary:extras];
	}
	gCommandTsfn.NonBlockingCall([payload](Napi::Env env, Napi::Function jsCallback) {
		Napi::Object obj = Napi::Object::New(env);
		for (NSString *key in payload) {
			id value = payload[key];
			if ([value isKindOfClass:[NSNumber class]]) {
				obj.Set(key.UTF8String, Napi::Number::New(env, [value doubleValue]));
			} else {
				obj.Set(key.UTF8String, Napi::String::New(env, [value UTF8String] ?: ""));
			}
		}
		jsCallback.Call({ obj });
	});
}

- (void)submitFollowUp:(id)sender {
	NSString *text = self.input.stringValue;
	if (text.length == 0) {
		return;
	}
	[self emit:@"followUp" extras:@{ @"text": text }];
	self.input.stringValue = @"";
}

- (void)openInPrebase:(id)sender {
	self.pinned = NO;
	[self emit:@"openInPrebase" extras:nil];
	[self collapse];
}

- (void)approve:(id)sender {
	if (self.actionInFlight) {
		return;
	}
	[self beginActionInFlight];
	[self layoutControls:self.panel ? self.panel.frame : self.lastRequestedFrame];
	[self emit:@"approve" extras:@{ @"interactionId": self.interactionId ?: @"" }];
}

- (void)deny:(id)sender {
	if (self.actionInFlight) {
		return;
	}
	[self beginActionInFlight];
	[self layoutControls:self.panel ? self.panel.frame : self.lastRequestedFrame];
	[self emit:@"deny" extras:@{ @"interactionId": self.interactionId ?: @"" }];
}

- (void)answerOption:(id)sender {
	NSButton *button = (NSButton *)sender;
	if (button.tag == 3 && self.pendingOptions.count > 4) {
		// Tertiary "More…" delegates to Open in PreBase
		[self openInPrebase:sender];
		return;
	}
	if (self.actionInFlight) {
		return;
	}
	if (button.tag < 0 || button.tag >= (NSInteger)self.pendingOptions.count) {
		return;
	}
	NSDictionary *option = self.pendingOptions[button.tag];
	NSString *optionId = option[@"id"] ?: @"";
	if (optionId.length == 0) {
		return;
	}
	[self beginActionInFlight];
	[self layoutControls:self.panel ? self.panel.frame : self.lastRequestedFrame];
	NSString *interactionId = self.interactionId ?: @"";
	[self emit:@"answer" extras:@{
		@"interactionId": interactionId,
		@"optionId": optionId
	}];
	// Keep pending interaction visible until snapshot acknowledges resolution.
}

- (void)beginActionInFlight {
	self.actionInFlight = YES;
	self.approveButton.enabled = NO;
	self.denyButton.enabled = NO;
	for (NSButton *btn in self.optionButtons) {
		btn.enabled = NO;
	}
	[self.actionInFlightTimer invalidate];
	self.actionInFlightTimer = nil;
	__weak PrebaseLiveActivityController *weakSelf = self;
	NSTimer *timer = [NSTimer timerWithTimeInterval:kActionInFlightTimeout repeats:NO block:^(NSTimer *t) {
		PrebaseLiveActivityController *strong = weakSelf;
		if (!strong || !strong.actionInFlight) {
			return;
		}
		// Truthful failure path: restore actionable controls without claiming success.
		[strong endActionInFlightRestoring:YES];
		strong.lastNativeCommand = @"actionTimeout";
		[strong layoutControls:strong.panel ? strong.panel.frame : strong.lastRequestedFrame];
	}];
	[[NSRunLoop mainRunLoop] addTimer:timer forMode:NSRunLoopCommonModes];
	self.actionInFlightTimer = timer;
}

- (void)endActionInFlightRestoring:(BOOL)restore {
	[self.actionInFlightTimer invalidate];
	self.actionInFlightTimer = nil;
	self.actionInFlight = NO;
	if (restore) {
		self.approveButton.enabled = YES;
		self.denyButton.enabled = YES;
		for (NSButton *btn in self.optionButtons) {
			btn.enabled = YES;
		}
	}
}

- (void)clearPendingInteraction {
	[self endActionInFlightRestoring:YES];
	self.interactionId = @"";
	self.pendingKind = @"";
	self.pendingDestructive = NO;
	self.pendingOptions = @[];
	self.content.pendingTitle = @"";
	self.content.pendingMessage = @"";
	[self refreshContentOnly];
}

- (NSDictionary *)diagnosticsDict {
	NSTimeInterval now = [NSDate timeIntervalSinceReferenceDate];
	if (self.transitionInFlight && now >= self.transitionEndTime) {
		self.transitionInFlight = NO;
	}
	if (!self.transitionInFlight && self.panel && !NSEqualRects(self.lastRequestedFrame, NSZeroRect)) {
		if (![self framesEffectivelyEqual:self.panel.frame to:self.lastRequestedFrame]) {
			[self.panel setFrame:self.lastRequestedFrame display:YES];
			self.content.shapeLayer.frame = CGRectMake(0, 0, self.lastRequestedFrame.size.width, self.lastRequestedFrame.size.height);
			self.content.shapeMaskLayer.frame = CGRectMake(0, 0, self.lastRequestedFrame.size.width, self.lastRequestedFrame.size.height);
		}
	}
	NSMutableDictionary *dict = [NSMutableDictionary dictionary];
	dict[@"panelCreated"] = @(self.panel != nil);
	dict[@"panelVisible"] = @(self.panel != nil && self.panel.isVisible);
	if (self.panel) {
		NSRect rf = self.lastRequestedFrame;
		dict[@"requestedFrame"] = @{
			@"x": @(rf.origin.x),
			@"y": @(rf.origin.y),
			@"width": @(rf.size.width),
			@"height": @(rf.size.height)
		};
		NSRect f = self.panel.frame;
		dict[@"panelFrame"] = @{
			@"x": @(f.origin.x),
			@"y": @(f.origin.y),
			@"width": @(f.size.width),
			@"height": @(f.size.height)
		};
	}
	NSScreen *screen = [self targetScreen];
	if (screen) {
		NSRect sf = screen.frame;
		NSEdgeInsets insets = screen.safeAreaInsets;
		NSRect auxLeft = screen.auxiliaryTopLeftArea;
		NSRect auxRight = screen.auxiliaryTopRightArea;
		dict[@"screenFrame"] = @{
			@"x": @(sf.origin.x),
			@"y": @(sf.origin.y),
			@"width": @(sf.size.width),
			@"height": @(sf.size.height)
		};
		dict[@"safeAreaTop"] = @(insets.top);
		dict[@"screenLocalizedName"] = screen.localizedName ?: @"";
		dict[@"auxiliaryTopLeftArea"] = @{
			@"x": @(auxLeft.origin.x),
			@"y": @(auxLeft.origin.y),
			@"width": @(auxLeft.size.width),
			@"height": @(auxLeft.size.height)
		};
		dict[@"auxiliaryTopRightArea"] = @{
			@"x": @(auxRight.origin.x),
			@"y": @(auxRight.origin.y),
			@"width": @(auxRight.size.width),
			@"height": @(auxRight.size.height)
		};
		if (self.content.notched) {
			CGFloat housingW = MAX(kCameraHousingMin, NSMinX(auxRight) - NSMaxX(auxLeft));
			CGFloat notchCenterX = NSMaxX(auxLeft) + housingW / 2.0;
			dict[@"notchGeometry"] = @{
				@"leadingX": @(NSMaxX(auxLeft)),
				@"trailingX": @(NSMinX(auxRight)),
				@"width": @(housingW),
				@"centerX": @(notchCenterX),
				@"height": @(MAX(insets.top, kCollapsedHeight))
			};
		}
	}
	if (self.panel) {
		NSRect sf = screen ? screen.frame : NSZeroRect;
		NSRect pf = self.panel.frame;
		CGFloat screenTopY = NSMaxY(sf);
		CGFloat panelTopY = NSMaxY(pf);
		dict[@"panelTopY"] = @(panelTopY);
		dict[@"screenTopY"] = @(screenTopY);
		dict[@"topAnchorDelta"] = @(screenTopY - panelTopY);
	}
	dict[@"notchDetected"] = @(self.content.notched);
	dict[@"panelLevel"] = @(self.panel.level);
	dict[@"expanded"] = @(self.content.expanded);
	dict[@"hovered"] = @(self.hovering);
	dict[@"pinned"] = @(self.pinned);
	dict[@"keyWindow"] = @(self.panel != nil && self.panel.isKeyWindow);
	dict[@"activeInputControl"] = self.input.hidden ? @"none" : (self.panel.firstResponder == self.input.currentEditor ? @"input-focused" : @"input-ready");
	dict[@"statusLabel"] = self.content.statusLabel ?: @"";
	dict[@"activityLabel"] = self.content.activityLabel ?: @"";
	dict[@"metricsLabel"] = self.content.metricsLabel ?: @"";
	dict[@"pendingTitle"] = self.content.pendingTitle ?: @"";
	dict[@"pendingMessage"] = self.content.pendingMessage ?: @"";
	dict[@"pendingKind"] = self.pendingKind ?: @"";
	dict[@"interactionId"] = self.interactionId ?: @"";
	dict[@"renderedLatestMessage"] = self.content.latestMessageLabel.hidden ? @"" : (self.content.latestMessageLabel.stringValue ?: @"");
	dict[@"renderedPendingMessage"] = self.content.pendingInteractionMessage.hidden ? @"" : (self.content.pendingInteractionMessage.stringValue ?: @"");
	// Peek body is painted into activityDescription while pendingInteractionMessage stays hidden.
	dict[@"renderedPeekBody"] = (self.content.peekOnly && !self.content.activityDescription.hidden)
		? (self.content.activityDescription.stringValue ?: @"")
		: @"";
	dict[@"screenLocked"] = @(self.screenLocked);
	dict[@"approvalControlsVisible"] = @(!self.approveButton.hidden);
	dict[@"openInPreBaseVisible"] = @(!self.openButton.hidden);
	dict[@"pinButtonVisible"] = @(!self.pinButton.hidden);
	dict[@"pinButtonTitle"] = self.pinButton.accessibilityLabel ?: self.pinButton.title ?: @"";
	dict[@"openButtonTitle"] = self.openButton.accessibilityLabel ?: self.openButton.title ?: @"";
	// Action titles stay truthful while in-flight; a11y labels carry "(in progress)".
	dict[@"approveButtonTitle"] = self.approveButton.title ?: @"";
	dict[@"denyButtonTitle"] = self.denyButton.title ?: @"";
	dict[@"approveButtonAccessibilityLabel"] = self.approveButton.accessibilityLabel ?: @"";
	dict[@"denyButtonAccessibilityLabel"] = self.denyButton.accessibilityLabel ?: @"";
	dict[@"approveButtonAlpha"] = @(self.approveButton.alphaValue);
	dict[@"denyButtonAlpha"] = @(self.denyButton.alphaValue);
	dict[@"shapeAwareHitTesting"] = @YES;
	dict[@"actionInFlightTimeoutMs"] = @(kActionInFlightTimeout * 1000.0);
	dict[@"reservedFooterHeight"] = @(self.content.reservedFooterHeight);
	{
		// Populated-first-paint invariant: expanded interactive must not be an empty black slab.
		BOOL hasBodyText = (self.content.activityLabel.length > 0)
			|| (self.content.latestMessage.length > 0)
			|| (self.content.pendingTitle.length > 0)
			|| (self.content.pendingMessage.length > 0)
			|| (self.content.actions.count > 0);
		BOOL bodyVisible = !self.content.headerTitle.hidden
			|| !self.content.activityDescription.hidden
			|| !self.content.pendingInteractionTitle.hidden
			|| !self.content.latestMessageLabel.hidden;
		dict[@"contentPopulated"] = @(!(self.content.expanded && !self.content.peekOnly) || (hasBodyText && bodyVisible));
		dict[@"expandedContentAlpha"] = @(self.content.expandedContainer.alphaValue);
	}
	// Layout geometry frames for containment verification (no sensitive text).
	// Child frames are in expandedContainer local coordinates (flipped, origin top-left).
	{
		CGFloat bandH = MAX(self.content.safeAreaTop, kCollapsedHeight);
		// Prefer the authoritative panel/target size over a possibly stale container bounds
		// mid-morph or immediately after a content-only refresh.
		CGFloat bodyW = NSWidth(self.content.expandedContainer.bounds);
		CGFloat bodyH = NSHeight(self.content.expandedContainer.bounds);
		if (self.panel) {
			NSRect pf = NSEqualRects(self.lastRequestedFrame, NSZeroRect) ? self.panel.frame : self.lastRequestedFrame;
			bodyW = MAX(bodyW, NSWidth(pf));
			bodyH = MAX(bodyH, MAX(0, NSHeight(pf) - bandH));
		}
		NSRect expandedLocal = NSMakeRect(0, 0, bodyW, bodyH);
		dict[@"bodyBounds"] = RectDict(expandedLocal);
		// Authoritative viewport = actual scroll host when interactive; never a parallel heuristic.
		if (self.content.contentScrollView && !self.content.contentScrollView.hidden) {
			NSRect scrollFrame = self.content.contentScrollView.frame;
			dict[@"contentViewport"] = RectDict(scrollFrame);
			dict[@"contentScrollFrame"] = RectDict(scrollFrame);
			dict[@"contentDocumentHeight"] = @(NSHeight(self.content.contentDocumentView.frame));
			dict[@"contentScrollOffset"] = @(self.content.contentScrollView.documentVisibleRect.origin.y);
			CGFloat safeInset = kContentInsetX + kContentSafeExtraX;
			dict[@"contentSafeViewport"] = RectDict(NSMakeRect(
				safeInset,
				NSMinY(scrollFrame),
				MAX(0, bodyW - safeInset * 2),
				MAX(0, NSHeight(scrollFrame))));
			dict[@"footerTopY"] = @(NSMaxY(scrollFrame) + kContentFooterGutter);
			// Pending frames are document-local, whereas the scroll host is body-local.
			// Export comparable coordinates so diagnostics cannot label clipped question copy healthy.
			const CGFloat actualVisibleViewportTop = NSMinY(scrollFrame);
			const CGFloat actualVisibleViewportBottom = NSMaxY(scrollFrame);
			const CGFloat scrollOffsetY = self.content.contentScrollView.documentVisibleRect.origin.y;
			CGFloat pendingMessageTop = 0;
			CGFloat pendingMessageBottom = 0;
			CGFloat pendingContentTop = CGFLOAT_MAX;
			CGFloat pendingContentBottom = 0;
			BOOL hasPendingContent = NO;
			BOOL hasPendingMessage = NO;
			for (NSTextField *pendingField in @[self.content.pendingInteractionTitle, self.content.pendingInteractionMessage]) {
				if (pendingField.hidden) {
					continue;
				}
				CGFloat pendingFieldTop = actualVisibleViewportTop + NSMinY(pendingField.frame) - scrollOffsetY;
				CGFloat pendingFieldBottom = actualVisibleViewportTop + NSMaxY(pendingField.frame) - scrollOffsetY;
				pendingContentTop = MIN(pendingContentTop, pendingFieldTop);
				pendingContentBottom = MAX(pendingContentBottom, pendingFieldBottom);
				hasPendingContent = YES;
				if (pendingField == self.content.pendingInteractionMessage) {
					pendingMessageTop = pendingFieldTop;
					pendingMessageBottom = pendingFieldBottom;
					hasPendingMessage = YES;
				}
			}
			BOOL pendingContentFullyVisible = !hasPendingContent
				|| (pendingContentTop >= actualVisibleViewportTop - 0.5
					&& pendingContentBottom <= actualVisibleViewportBottom + 0.5);
			BOOL pendingMessageFullyVisible = !hasPendingMessage
				|| (pendingMessageTop >= actualVisibleViewportTop - 0.5
					&& pendingMessageBottom <= actualVisibleViewportBottom + 0.5);
			dict[@"actualVisibleViewportTop"] = @(actualVisibleViewportTop);
			dict[@"actualVisibleViewportBottom"] = @(actualVisibleViewportBottom);
			dict[@"pendingMessageBottom"] = @(pendingMessageBottom);
			dict[@"pendingMessageFullyVisible"] = @(pendingMessageFullyVisible);
			dict[@"pendingContentFullyVisible"] = @(pendingContentFullyVisible);
			dict[@"questionContentHealthy"] = @(![self.pendingKind isEqualToString:@"question"]
				|| pendingContentFullyVisible);
		} else {
			CGFloat footerReserve = MAX(0, self.content.reservedFooterHeight);
			CGFloat textHeight = MAX(0, bodyH - footerReserve);
			dict[@"contentViewport"] = RectDict(NSMakeRect(0, 0, bodyW, textHeight));
			CGFloat safeInset = kContentInsetX + kContentSafeExtraX;
			dict[@"contentSafeViewport"] = RectDict(NSMakeRect(safeInset, kContentInsetTop, MAX(0, bodyW - safeInset * 2), MAX(0, textHeight - kContentInsetTop)));
			dict[@"footerTopY"] = @(textHeight);
			dict[@"actualVisibleViewportTop"] = @(0);
			dict[@"actualVisibleViewportBottom"] = @(textHeight);
			dict[@"pendingMessageBottom"] = @(0);
			dict[@"pendingMessageFullyVisible"] = @YES;
			dict[@"pendingContentFullyVisible"] = @YES;
			dict[@"questionContentHealthy"] = @YES;
		}
		dict[@"contentScrollEnabled"] = @(self.content.contentScrollView != nil && !self.content.contentScrollView.hidden);
		dict[@"contentFooterGutter"] = @(kContentFooterGutter);
		{
			// Silhouette curvature metrics — same helper as CreateNotchedIslandPath.
			CGFloat leftW = self.content.leftWingWidth > 0 ? self.content.leftWingWidth : kWingWidthMin;
			CGFloat rightW = self.content.rightWingWidth > 0 ? self.content.rightWingWidth : kWingWidthMin;
			CGFloat housing = self.content.housingWidth > 0 ? self.content.housingWidth : kCameraHousingMin;
			CGFloat depth = MAX(0, bodyH);
			BOOL expanded = self.content.targetExpanded;
			SilhouetteShoulderMetrics shoulder = ComputeSilhouetteShoulderMetrics(bodyW, depth, leftW, rightW, housing, expanded);
			dict[@"silhouetteMetrics"] = @{
				@"opticalTopInset": @(shoulder.opticalInset),
				@"shoulderFlare": @(shoulder.flare),
				@"effShoulderR": @(shoulder.effShoulderR),
				@"topLeftX": @(shoulder.wingLeftX),
				@"topRightX": @(shoulder.wingRightX),
				@"panelWidth": @(bodyW),
				@"bodyDepth": @(depth),
				@"shoulderCurvatureContinuous": @(YES),
				@"notchCenter": @(bodyW * 0.5),
				@"tangentContinuity": @(YES),
				@"nonDegenerateShoulder": @((expanded && depth > 0.5)
					? (shoulder.flare >= kOpticalShoulderInsetMin - 0.5 && shoulder.effShoulderR >= 10.0)
					: YES)
			};
		}
		dict[@"headerFrame"] = self.content.headerTitle.hidden ? [NSNull null] : RectDict(self.content.headerTitle.frame);
		dict[@"statusBadgeFrame"] = self.content.statusBadge.hidden ? [NSNull null] : RectDict(self.content.statusBadge.frame);
		dict[@"activityFrame"] = self.content.activityDescription.hidden ? [NSNull null] : RectDict(self.content.activityDescription.frame);
		dict[@"latestMessageFrame"] = self.content.latestMessageLabel.hidden ? [NSNull null] : RectDict(self.content.latestMessageLabel.frame);
		dict[@"pendingTitleFrame"] = self.content.pendingInteractionTitle.hidden ? [NSNull null] : RectDict(self.content.pendingInteractionTitle.frame);
		dict[@"pendingMessageFrame"] = self.content.pendingInteractionMessage.hidden ? [NSNull null] : RectDict(self.content.pendingInteractionMessage.frame);
		dict[@"composerFrame"] = self.input.hidden ? [NSNull null] : RectDict(self.input.frame);
		dict[@"pinButtonFrame"] = self.pinButton.hidden ? [NSNull null] : RectDict(self.pinButton.frame);
		dict[@"openButtonFrame"] = self.openButton.hidden ? [NSNull null] : RectDict(self.openButton.frame);
		dict[@"approveButtonFrame"] = self.approveButton.hidden ? [NSNull null] : RectDict(self.approveButton.frame);
		dict[@"denyButtonFrame"] = self.denyButton.hidden ? [NSNull null] : RectDict(self.denyButton.frame);
		NSMutableArray *actionFrames = [NSMutableArray array];
		NSMutableArray *actionIds = [NSMutableArray array];
		for (NSInteger i = 0; i < (NSInteger)self.content.actionLabels.count; i++) {
			NSTextField *lbl = self.content.actionLabels[i];
			if (!lbl.hidden) {
				[actionFrames addObject:RectDict(lbl.frame)];
				NSString *aid = (i < (NSInteger)self.content.actionRowIds.count) ? self.content.actionRowIds[i] : @"";
				[actionIds addObject:aid ?: @""];
			}
		}
		dict[@"actionFrames"] = actionFrames;
		dict[@"actionRowIds"] = actionIds;
		NSMutableArray *optionFrames = [NSMutableArray array];
		for (NSButton *btn in self.optionButtons) {
			if (!btn.hidden) {
				[optionFrames addObject:RectDict(btn.frame)];
			}
		}
		dict[@"optionButtonFrames"] = optionFrames;
		dict[@"bandHeight"] = @(bandH);
		if (self.content.shapeLayer.path) {
			CGRect pb = CGPathGetPathBoundingBox(self.content.shapeLayer.path);
			dict[@"pathBounds"] = @{
				@"x": @(pb.origin.x),
				@"y": @(pb.origin.y),
				@"width": @(pb.size.width),
				@"height": @(pb.size.height)
			};
			dict[@"shapeMaskSynced"] = @(self.content.shapeMaskLayer.path != nil
				&& CGPathEqualToPath(self.content.shapeMaskLayer.path, self.content.shapeLayer.path));
		}
	}
	NSInteger visibleOptions = 0;
	NSMutableArray *optLabels = [NSMutableArray array];
	for (NSButton *btn in self.optionButtons) {
		if (!btn.hidden) {
			visibleOptions++;
			[optLabels addObject:btn.title ?: @""];
		}
	}
	dict[@"questionButtonCount"] = @(visibleOptions);
	dict[@"questionButtonLabels"] = optLabels;
	dict[@"accessibilityRole"] = self.content.accessibilityRole ?: @"";
	dict[@"accessibilityLabel"] = self.content.accessibilityLabel ?: @"";
	dict[@"lastNativeCommand"] = self.lastNativeCommand ?: @"";
	NSRect hit = self.collapsedHit;
	dict[@"collapsedHit"] = @{
		@"x": @(hit.origin.x),
		@"y": @(hit.origin.y),
		@"width": @(hit.size.width),
		@"height": @(hit.size.height)
	};
	dict[@"globalMonitorInstalled"] = @(self.globalMonitor != nil);
	dict[@"localMonitorInstalled"] = @(self.localMonitor != nil);
	dict[@"trackingAreaCount"] = @(self.content.trackingAreas.count);
	dict[@"hapticCount"] = @(self.hapticCount);
	dict[@"hoverHapticCount"] = @(self.hoverHapticCount);
	dict[@"lastHapticReason"] = self.lastHapticReason ?: @"none";
	dict[@"redrawCount"] = @(self.redrawCount);
	dict[@"animationCount"] = @(self.animationCount);
	dict[@"geometryTransitionCount"] = @(self.geometryTransitionCount);
	dict[@"contentOnlyUpdateCount"] = @(self.contentOnlyUpdateCount);
	dict[@"contentRefreshCount"] = @(self.contentRefreshCount);
	dict[@"windowNumber"] = self.panel ? @(self.panel.windowNumber) : @(-1);
	dict[@"backingScaleFactor"] = self.panel ? @(self.panel.backingScaleFactor) : @(2.0);
	dict[@"geometrySignature"] = self.lastGeometrySignature ?: @"";
	dict[@"pinnedInteractiveHeight"] = @(self.pinnedInteractiveHeight);
	dict[@"orderFrontCount"] = @(self.orderFrontCount);
	dict[@"lastRenderedRevision"] = @(self.lastRenderedRevision);
	dict[@"revision"] = @(self.revision);
	dict[@"lastTransitionReason"] = self.lastTransitionReason ?: @"";
	dict[@"peekOnly"] = @(self.content.peekOnly);

	BOOL effectivelySettled = !self.panel
		|| NSEqualRects(self.lastRequestedFrame, NSZeroRect)
		|| [self framesEffectivelyEqual:self.panel.frame to:self.lastRequestedFrame];
	dict[@"transitionInFlight"] = @(self.transitionInFlight || !effectivelySettled);
	dict[@"transitionGeneration"] = @(self.transitionGeneration);
	dict[@"actionInFlight"] = @(self.actionInFlight);
	dict[@"hoverSessionToken"] = @(self.hoverSessionToken);
	dict[@"layerBacked"] = @(self.content.wantsLayer);
	CGFloat diagBandH = MAX(self.content.safeAreaTop, kCollapsedHeight);
	CGFloat diagTotalW = NSWidth(self.content.bounds);
	CGFloat diagCurrentH = NSHeight(self.content.bounds);
	CGFloat diagLeftW = self.content.leftWingWidth > 0 ? self.content.leftWingWidth : kWingWidthMin;
	CGFloat diagRightW = self.content.rightWingWidth > 0 ? self.content.rightWingWidth : kWingWidthMin;
	CGFloat diagHousing = self.content.housingWidth > 0 ? self.content.housingWidth : kCameraHousingMin;
	if (diagTotalW <= 0) { diagTotalW = diagLeftW + diagHousing + diagRightW; }
	if (diagCurrentH <= 0) { diagCurrentH = diagBandH; }

	CGPathRef diagPathCollapsed = CreateNotchedIslandPath(diagTotalW, diagBandH, diagLeftW, diagRightW, diagHousing, diagBandH, NO, self.content.notched);
	CGPathRef diagCurrentPath = self.content.shapeLayer.path;
	BOOL isTopologyCompatible = NO;
	if (diagCurrentPath) {
		isTopologyCompatible = ValidatePathTopology(diagPathCollapsed, diagCurrentPath);
	} else {
		CGPathRef diagPathExpanded = CreateNotchedIslandPath(diagTotalW, diagCurrentH, diagLeftW, diagRightW, diagHousing, diagBandH, self.content.expanded, self.content.notched);
		isTopologyCompatible = ValidatePathTopology(diagPathCollapsed, diagPathExpanded);
		CGPathRelease(diagPathExpanded);
	}
	CGPathRelease(diagPathCollapsed);
	dict[@"pathTopologyCompatible"] = @(isTopologyCompatible);
	dict[@"latestShortMessage"] = self.content.latestMessage ?: @"";
	NSString *activePresentation;
	if (self.pinned) {
		activePresentation = self.content.attention ? @"attentionInteractive" : @"pinned";
	} else if (self.content.expanded) {
		if (self.attentionPeek) {
			activePresentation = @"attentionPeek";
		} else if (self.content.peekOnly) {
			activePresentation = @"peek";
		} else {
			activePresentation = self.content.attention ? @"attentionInteractive" : @"interactive";
		}
	} else if (self.content.attention) {
		// attentionCompact is sticky Escape only — never a synonym for collapsed attention.
		activePresentation = self.userDismissedAttention ? @"attentionCompact" : @"compact";
	} else if ([self.content.status isEqualToString:@"failed"]) {
		activePresentation = @"failedTransient";
	} else if ([self.content.status isEqualToString:@"completed"]) {
		activePresentation = @"completedTransient";
	} else {
		activePresentation = @"compact";
	}
	dict[@"activePresentationState"] = activePresentation;
	NSString *targetPresentation;
	if (self.content.targetExpanded) {
		if (self.attentionPeek) {
			targetPresentation = @"attentionPeek";
		} else if (self.content.peekOnly) {
			targetPresentation = @"peek";
		} else if (self.pinned) {
			targetPresentation = self.content.attention ? @"attentionInteractive" : @"pinned";
		} else {
			targetPresentation = self.content.attention ? @"attentionInteractive" : @"interactive";
		}
	} else if (self.content.attention) {
		targetPresentation = self.userDismissedAttention ? @"attentionCompact" : @"compact";
	} else if ([self.content.status isEqualToString:@"failed"]) {
		targetPresentation = @"failedTransient";
	} else if ([self.content.status isEqualToString:@"completed"]) {
		targetPresentation = @"completedTransient";
	} else {
		targetPresentation = @"compact";
	}
	dict[@"targetPresentationState"] = targetPresentation;
	// Factual sticky Escape/collapse dismiss — required for AppKit product-truth diagnostics.
	dict[@"userDismissedAttention"] = @(self.userDismissedAttention);
	dict[@"hoverDwellMs"] = @(180);
	dict[@"exitGraceMs"] = @(250);
	dict[@"prebaseFullscreen"] = @(self.prebaseFullscreen);
	dict[@"displayMode"] = self.displayMode ?: @"builtin";
	dict[@"retainedWorkScreen"] = @(self.lastFocusedWorkScreen != nil);
	return dict;
}

- (BOOL)simulateClickOptionIndex:(NSInteger)index {
	if (index < 0 || index >= (NSInteger)self.optionButtons.count) {
		return NO;
	}
	NSButton *button = self.optionButtons[index];
	if (button.hidden && index >= (NSInteger)self.pendingOptions.count) {
		return NO;
	}
	[self answerOption:button];
	return YES;
}

- (BOOL)simulateClickApprove {
	if (self.approveButton.hidden && (![self.pendingKind isEqualToString:@"approval"] || !self.interactionId.length)) {
		return NO;
	}
	[self approve:self.approveButton];
	return YES;
}

- (BOOL)simulateClickDeny {
	if (self.denyButton.hidden && (![self.pendingKind isEqualToString:@"approval"] || !self.interactionId.length)) {
		return NO;
	}
	[self deny:self.denyButton];
	return YES;
}

- (BOOL)simulateSubmitFollowUp:(NSString *)text {
	if (!text.length || self.screenLocked) {
		return NO;
	}
	BOOL isInteractive = (self.content.expanded || self.pinned) && !self.content.peekOnly;
	if (self.input.hidden && !isInteractive) {
		return NO;
	}
	self.input.stringValue = text;
	[self submitFollowUp:self.input];
	return YES;
}

- (BOOL)simulateClickOpenInPrebase {
	if (self.openButton.hidden) {
		return NO;
	}
	[self openInPrebase:self.openButton];
	return YES;
}
- (void)togglePin:(id)sender {
	if (self.screenLocked) {
		return;
	}
	self.pinned = !self.pinned;
	[self updatePinButtonState];
	[self emit:self.pinned ? @"pin" : @"unpin" extras:nil];
	if (self.pinned) {
		self.content.expanded = YES;
		self.content.targetExpanded = YES;
		self.panel.ignoresMouseEvents = NO;
		self.ignoresMouse = NO;
		[self removeGlobalMonitorOnly];
		[self installLocalKeyMonitor];
	}
	self.pendingPresentationMorph = YES;
	[self layoutForScreen];
}

- (void)updatePinButtonState {
	NSString *symbol = self.pinned ? @"pin.fill" : @"pin";
	NSString *label = self.pinned ? @"Unpin panel" : @"Pin panel";
	self.pinButton.state = self.pinned ? NSControlStateValueOn : NSControlStateValueOff;
	ApplySystemSymbol(self.pinButton, symbol, label);
}

- (BOOL)simulateClickPin {
	if (self.screenLocked || self.content.peekOnly || !self.content.expanded) {
		return NO;
	}
	[self togglePin:self.pinButton];
	return YES;
}

- (void)mouseUp:(NSEvent *)event {
	// Releasing the mouse on the Interactive surface should NOT pin.
	// It focuses the input field if visible and not already focused.
	if (self.content.expanded && !self.content.peekOnly) {
		if (!self.input.hidden && [self.panel firstResponder] != self.input) {
			[self.panel makeKeyAndOrderFront:nil];
			[self.panel makeFirstResponder:self.input];
		}
		return;
	}
	// Compact click (not already peek/interactive): enter sticky Interactive.
	// Peek clicks are handled in mouseDown via enterInteractiveSticky.
	if (!self.pinned && !self.content.peekOnly && !self.attentionPeek) {
		[self enterInteractiveSticky];
	}
}

- (void)applySnapshotDict:(NSDictionary *)snapshot {
	self.screenLocked = [snapshot[@"screenLocked"] boolValue];
	if (self.screenLocked) {
		self.attentionPeek = NO;
		self.content.peekOnly = NO;
		self.content.expanded = NO;
		self.content.targetExpanded = NO;
		self.pinned = NO;
		[self updatePinButtonState];
		self.ignoresMouse = YES;
		if (self.panel) {
			self.panel.ignoresMouseEvents = YES;
		}
		[self removeLocalKeyMonitor];
		self.content.status = @"idle";
		self.content.attention = NO;
		self.content.statusLabel = @"Magnus";
		self.content.activityLabel = @"";
		self.content.latestMessage = @"";
		self.content.metricsLabel = @"";
		self.content.pendingTitle = @"";
		self.content.actions = @[];
		[self.content updateShapeAndContentAnimated:NO duration:0 useTargetState:YES];
		if (self.panel) {
			[self layoutControls:self.panel.frame];
			// Snapshot lock must hide immediately even if presentation update races behind.
			[self.panel orderOut:nil];
			self.panel.ignoresMouseEvents = YES;
			self.visible = NO;
		}
		return;
	}

	const double incomingRevision = [snapshot[@"revision"] doubleValue];
	// Monotonic revision: never paint an older snapshot over a newer one.
	if (incomingRevision > 0 && self.lastRenderedRevision > 0 && incomingRevision < self.lastRenderedRevision) {
		return;
	}

	const BOOL alreadyInteractive = self.pinned
		|| (self.content.expanded && !self.content.peekOnly && !self.attentionPeek);
	const BOOL wasAttentionPeek = self.attentionPeek;
	const BOOL mayExpand = self.visible && !self.screenLocked;

	self.sessionId = snapshot[@"sessionId"] ?: @"";
	self.sessionResource = snapshot[@"sessionResource"] ?: @"";
	self.revision = incomingRevision;
	NSString *status = snapshot[@"status"] ?: @"";
	self.content.status = status;
	self.content.attention = [status isEqualToString:@"attention"];
	// Sticky Escape restore: OR with local flag while attention remains (stale republish must not clear).
	if (self.content.attention) {
		if ([snapshot[@"userDismissedAttention"] boolValue]) {
			self.userDismissedAttention = YES;
		}
	} else {
		self.userDismissedAttention = NO;
	}
	NSString *label = CompactWingLabelFromSnapshot(
		status,
		snapshot[@"pendingKind"] ?: @"",
		snapshot[@"presentationLabel"] ?: @"",
		snapshot[@"testState"] ?: @"");
	self.content.statusLabel = label;
	self.content.activityLabel = snapshot[@"currentActivity"] ?: @"";
	self.content.actions = snapshot[@"recentActions"] ?: @[];
	self.content.metricsLabel = snapshot[@"metricsLabel"] ?: @"";
	self.content.pendingTitle = snapshot[@"pendingTitle"] ?: @"";
	self.content.pendingMessage = snapshot[@"pendingMessage"] ?: @"";
	self.content.latestMessage = snapshot[@"latestShortMessage"] ?: @"";

	NSString *incomingInteractionId = snapshot[@"interactionId"] ?: @"";
	if (self.actionInFlight) {
		// Clear in-flight state when snapshot confirms interaction transitioned, resolved, or status returned to working/idle
		if (incomingInteractionId.length == 0 || ![incomingInteractionId isEqualToString:self.interactionId] || [status isEqualToString:@"idle"] || [status isEqualToString:@"working"] || [status isEqualToString:@"completed"] || [status isEqualToString:@"failed"]) {
			[self endActionInFlightRestoring:YES];
		}
	}
	NSString *incomingPendingKind = snapshot[@"pendingKind"] ?: @"";
	BOOL interactionChanged = ![incomingInteractionId isEqualToString:self.interactionId]
		|| ![incomingPendingKind isEqualToString:self.pendingKind]
		|| (![status isEqualToString:self.content.status] && ([status isEqualToString:@"attention"] || [status isEqualToString:@"working"]));
	if (interactionChanged && self.content.contentScrollView) {
		[self.content.contentScrollView.contentView scrollToPoint:NSZeroPoint];
		[self.content.contentScrollView reflectScrolledClipView:self.content.contentScrollView.contentView];
	}
	if (interactionChanged) {
		self.pinnedInteractiveHeight = 0;
		self.lastGeometrySignature = @"";
	}
	self.interactionId = incomingInteractionId;
	self.pendingKind = incomingPendingKind;
	self.pendingDestructive = [snapshot[@"destructive"] boolValue];
	self.pendingOptions = snapshot[@"pendingOptions"] ?: @[];
	self.lastNativeCommand = @"";

	BOOL needsGeometry = NO;

	if (self.content.attention) {
		if (alreadyInteractive && mayExpand) {
			// Attention while Interactive/pinned: preserve Interactive; update content only.
			self.userDismissedAttention = NO;
			const BOOL alreadyCorrect = !self.attentionPeek && !self.content.peekOnly && self.content.expanded;
			self.attentionPeek = NO;
			self.content.peekOnly = NO;
			self.content.expanded = YES;
			self.content.targetExpanded = YES;
			self.ignoresMouse = NO;
			if (self.panel) {
				self.panel.ignoresMouseEvents = NO;
			}
			needsGeometry = !alreadyCorrect;
		} else if (!self.pinned && self.userDismissedAttention) {
			// Escape/collapse while attention: lasting compact until click (do not republish into peek).
			const BOOL alreadyCompact = !self.attentionPeek && !self.content.peekOnly && !self.content.expanded;
			self.attentionPeek = NO;
			self.content.peekOnly = NO;
			self.content.expanded = NO;
			self.content.targetExpanded = NO;
			self.ignoresMouse = YES;
			if (self.panel) {
				self.panel.ignoresMouseEvents = YES;
			}
			needsGeometry = !alreadyCompact;
		} else if (!self.pinned && mayExpand) {
			// Glanceable attention peek: compact wings + short body, not full interactive panel.
			self.didAttentionHaptic = NO;
			const BOOL alreadyAttentionPeek = self.attentionPeek && self.content.peekOnly && self.content.expanded;
			self.attentionPeek = YES;
			self.content.peekOnly = YES;
			self.content.expanded = YES;
			self.content.targetExpanded = YES;
			self.ignoresMouse = NO;
			if (self.panel) {
				self.panel.ignoresMouseEvents = NO;
			}
			needsGeometry = !alreadyAttentionPeek;
		} else if (!mayExpand) {
			const BOOL alreadyCompact = !self.attentionPeek && !self.content.peekOnly && !self.content.expanded;
			self.attentionPeek = NO;
			self.content.peekOnly = NO;
			self.content.expanded = NO;
			self.content.targetExpanded = NO;
			self.ignoresMouse = YES;
			if (self.panel) {
				self.panel.ignoresMouseEvents = YES;
			}
			needsGeometry = !alreadyCompact;
		}
	} else {
		self.userDismissedAttention = NO;
		self.attentionPeek = NO;
		if (wasAttentionPeek && !self.pinned && !self.hovering && !alreadyInteractive) {
			self.content.peekOnly = NO;
			[self collapse];
			self.lastRenderedRevision = incomingRevision > 0 ? incomingRevision : self.lastRenderedRevision;
			return;
		}
		// Content must never convert Peek → Interactive or collapse Interactive.
		// Preserve peekOnly / expanded / hover ownership across content revisions.
		if (self.content.expanded || self.pinned) {
			self.content.targetExpanded = YES;
		}
	}

	self.lastRenderedRevision = incomingRevision > 0 ? incomingRevision : self.lastRenderedRevision;

	if (self.panel) {
		if (needsGeometry) {
			self.pendingPresentationMorph = YES;
		}
		[self layoutForScreen];
	} else {
		[self refreshContentOnly];
	}
}

- (void)setVisible:(BOOL)visible pinned:(BOOL)pinned reduced:(BOOL)reduced {
	// Screen lock is a hard hide — never orderFront while locked even if JS races visible:true.
	if (self.screenLocked) {
		visible = NO;
	}

	// Pending attention stored while hidden/locked must still promote on the next show,
	// even when visible/pinned/reduced look unchanged at the call site.
	const BOOL pendingAttentionPromotion = visible
		&& self.content.attention
		&& !self.userDismissedAttention
		&& !pinned
		&& !self.attentionPeek
		&& !(self.content.expanded && !self.content.peekOnly);

	// Idempotent presentation republish: content flushes must not re-layout or reorder.
	if (visible
		&& self.visible
		&& self.panel.isVisible
		&& self.pinned == pinned
		&& self.reducedMotion == reduced
		&& !self.screenLocked
		&& !pendingAttentionPromotion) {
		return;
	}

	const BOOL wasPinned = self.pinned;
	const BOOL wasVisible = self.visible && self.panel.isVisible;
	const BOOL wasExpanded = self.content.expanded;
	const BOOL wasPeekOnly = self.content.peekOnly;
	const BOOL wasAttentionPeek = self.attentionPeek;
	self.visible = visible;
	self.pinned = pinned;
	[self updatePinButtonState];
	self.reducedMotion = reduced;
	self.content.reducedMotion = reduced;
	// Unpinning must not leave a stale Interactive surface.
	if (pinned) {
		self.content.expanded = YES;
		self.content.peekOnly = NO;
		self.attentionPeek = NO;
	} else if (wasPinned && !pinned) {
		// Downgrade sticky Interactive → peek/attentionPeek/compact. Never keep expanded+!peekOnly.
		[self removeLocalKeyMonitor];
		if (self.content.attention && self.userDismissedAttention) {
			self.attentionPeek = NO;
			self.content.peekOnly = NO;
			self.content.expanded = NO;
		} else if (self.content.attention) {
			self.attentionPeek = YES;
			self.content.peekOnly = YES;
			self.content.expanded = YES;
		} else if (self.hovering) {
			self.attentionPeek = NO;
			self.content.peekOnly = YES;
			self.content.expanded = YES;
		} else {
			self.content.expanded = NO;
			self.content.peekOnly = NO;
			self.attentionPeek = NO;
		}
	} else if (!visible) {
		self.content.expanded = NO;
	} else {
		// Becoming / staying visible: promote pending attention into attentionPeek when appropriate.
		const BOOL isInteractive = self.content.expanded && !self.content.peekOnly && !self.attentionPeek;
		if (self.content.attention && !self.userDismissedAttention && !isInteractive && !self.pinned) {
			self.attentionPeek = YES;
			self.content.peekOnly = YES;
			self.content.expanded = YES;
		} else {
			// Keep legitimate peek/attention/hover expansion, and preserve active unpinned Interactive mode;
			// never invent Interactive from visibility alone.
			const BOOL peekSurface = self.hovering || self.attentionPeek || self.content.peekOnly;
			const BOOL activeInteraction = isInteractive && (self.hovering || self.panel.firstResponder == self.input.currentEditor || self.input.stringValue.length > 0 || self.exitTimer != nil);
			if (self.content.expanded && !peekSurface && !activeInteraction) {
				self.content.expanded = NO;
				self.content.peekOnly = NO;
				self.attentionPeek = NO;
				[self removeLocalKeyMonitor];
			} else {
				self.content.expanded = self.content.expanded && (peekSurface || activeInteraction);
			}
		}
	}
	self.content.targetExpanded = self.content.expanded;
	// Honor reduced motion for window animation behavior per contract
	self.panel.animationBehavior = reduced ? NSWindowAnimationBehaviorNone : NSWindowAnimationBehaviorUtilityWindow;
	if (!visible) {
		[self.panel orderOut:nil];
		self.panel.ignoresMouseEvents = YES;
		if (!pinned) {
			self.content.expanded = NO;
			self.content.targetExpanded = NO;
			self.content.peekOnly = NO;
			self.attentionPeek = NO;
			self.hovering = NO;
			self.didHoverHaptic = NO;
			self.lastInside = NO;
		}
		[self.hoverTimer invalidate];
		self.hoverTimer = nil;
		[self.exitTimer invalidate];
		self.exitTimer = nil;
		[self removeMonitors];
		return;
	}
	if (!self.content.expanded && !self.pinned) {
		[self installMonitor];
	} else {
		[self removeGlobalMonitorOnly];
	}
	// Morph only when presentation mode actually changed — not on every show/republish.
	const BOOL presentationChanged = wasPinned != self.pinned
		|| wasExpanded != self.content.expanded
		|| wasPeekOnly != self.content.peekOnly
		|| wasAttentionPeek != self.attentionPeek;
	if (presentationChanged) {
		self.pendingPresentationMorph = YES;
	}
	[self layoutForScreen];
	if (!wasVisible || !self.panel.isVisible) {
		self.orderFrontCount++;
		self.lastTransitionReason = @"orderFront";
		[self.panel orderFrontRegardless];
	}
	if (!self.pinned && !self.content.expanded) {
		self.panel.ignoresMouseEvents = YES;
	} else {
		self.panel.ignoresMouseEvents = NO;
		self.ignoresMouse = NO;
	}
}

- (void)teardown {
	[[NSNotificationCenter defaultCenter] removeObserver:self];
	[self.actionInFlightTimer invalidate];
	self.actionInFlightTimer = nil;
	self.actionInFlight = NO;
	[self.hoverTimer invalidate];
	self.hoverTimer = nil;
	[self.exitTimer invalidate];
	self.exitTimer = nil;
	[self removeMonitors];
	[self.panel orderOut:nil];
	self.panel.contentView = nil;
	[self.panel close];
	self.panel = nil;
	self.content = nil;
}

@end

static PrebaseLiveActivityController *gController;

static PrebaseLiveActivityController *EnsureController() {
	// Node/smoke harnesses may load the addon without an AppKit run loop owner.
	// Touching NSApp ensures NSScreen.screens is populated for layout diagnostics.
	if (NSApp == nil) {
		[NSApplication sharedApplication];
	}
	if (!gController) {
		gController = [PrebaseLiveActivityController new];
	}
	return gController;
}

static NSMutableDictionary *SnapshotToDict(Napi::Object snapshot) {
	NSMutableDictionary *payload = [NSMutableDictionary dictionary];
	payload[@"sessionId"] = JSString(snapshot.Get("sessionId"));
	payload[@"sessionResource"] = JSString(snapshot.Get("sessionResource"));
	payload[@"revision"] = @(snapshot.Get("revision").IsNumber() ? snapshot.Get("revision").As<Napi::Number>().DoubleValue() : 0);
	payload[@"status"] = JSString(snapshot.Get("status"));
	payload[@"currentActivity"] = JSString(snapshot.Get("currentActivity"));
	payload[@"taskTitle"] = JSString(snapshot.Get("taskTitle"));
	payload[@"presentationLabel"] = JSString(snapshot.Get("presentationLabel"));
	payload[@"latestShortMessage"] = JSString(snapshot.Get("latestShortMessage"));
	if (snapshot.Get("screenLocked").IsBoolean() && snapshot.Get("screenLocked").As<Napi::Boolean>().Value()) {
		payload[@"screenLocked"] = @YES;
	} else {
		payload[@"screenLocked"] = @NO;
	}
	if (snapshot.Get("userDismissedAttention").IsBoolean() && snapshot.Get("userDismissedAttention").As<Napi::Boolean>().Value()) {
		payload[@"userDismissedAttention"] = @YES;
	} else {
		payload[@"userDismissedAttention"] = @NO;
	}
	NSMutableArray *actions = [NSMutableArray array];
	if (snapshot.Get("recentActions").IsArray()) {
		Napi::Array arr = snapshot.Get("recentActions").As<Napi::Array>();
		for (uint32_t i = 0; i < arr.Length() && i < 4; i++) {
			Napi::Value item = arr.Get(i);
			if (item.IsObject()) {
				Napi::Object obj = item.As<Napi::Object>();
				NSString *actionId = JSString(obj.Get("id"));
				NSString *label = JSString(obj.Get("label"));
				if (label.length == 0) {
					continue;
				}
				if (actionId.length == 0) {
					actionId = [NSString stringWithFormat:@"action-%u", i];
				}
				NSMutableDictionary *entry = [NSMutableDictionary dictionaryWithDictionary:@{
					@"id": actionId,
					@"label": label
				}];
				if (obj.Get("at").IsNumber()) {
					entry[@"at"] = @(obj.Get("at").As<Napi::Number>().DoubleValue());
				}
				NSString *status = JSString(obj.Get("status"));
				if (status.length) {
					entry[@"status"] = status;
				}
				[actions addObject:entry];
			} else if (item.IsString()) {
				// Legacy string-only bridge — synthesize a stable index id.
				NSString *label = JSString(item);
				if (label.length) {
					[actions addObject:@{
						@"id": [NSString stringWithFormat:@"legacy-%u", i],
						@"label": label
					}];
				}
			}
		}
	}
	payload[@"recentActions"] = actions;

	NSMutableArray *metricParts = [NSMutableArray array];
	// Compact right-wing metric: elapsed first (glanceable), else short diff/file cue.
	if (snapshot.Get("startedAt").IsNumber()) {
		double startedAt = snapshot.Get("startedAt").As<Napi::Number>().DoubleValue();
		NSString *elapsed = FormatCompactElapsed(startedAt);
		if (elapsed.length) {
			[metricParts addObject:elapsed];
		}
	}
	if (metricParts.count == 0 && snapshot.Get("workspaceDiff").IsObject()) {
		Napi::Object diff = snapshot.Get("workspaceDiff").As<Napi::Object>();
		bool hasAdd = diff.Get("additions").IsNumber();
		if (hasAdd) {
			double additions = diff.Get("additions").As<Napi::Number>().DoubleValue();
			[metricParts addObject:[NSString stringWithFormat:@"+%.0f", additions]];
		} else if (diff.Get("files").IsNumber()) {
			double files = diff.Get("files").As<Napi::Number>().DoubleValue();
			if (files > 0) {
				[metricParts addObject:[NSString stringWithFormat:@"%.0ff", files]];
			}
		}
	}
	payload[@"metricsLabel"] = metricParts.count ? metricParts[0] : @"";
	payload[@"testState"] = JSString(snapshot.Get("testState"));
	if (snapshot.Get("startedAt").IsNumber()) {
		payload[@"startedAt"] = @(snapshot.Get("startedAt").As<Napi::Number>().DoubleValue());
	}

	if (snapshot.Get("pendingInteraction").IsObject()) {
		Napi::Object pending = snapshot.Get("pendingInteraction").As<Napi::Object>();
		payload[@"interactionId"] = JSString(pending.Get("interactionId"));
		payload[@"pendingKind"] = JSString(pending.Get("kind"));
		payload[@"pendingTitle"] = JSString(pending.Get("title"));
		payload[@"pendingMessage"] = JSString(pending.Get("message"));
		if (pending.Get("destructive").IsBoolean() && pending.Get("destructive").As<Napi::Boolean>().Value()) {
			payload[@"destructive"] = @YES;
		}
		NSMutableArray *options = [NSMutableArray array];
		if (pending.Get("options").IsArray()) {
			Napi::Array arr = pending.Get("options").As<Napi::Array>();
			for (uint32_t i = 0; i < arr.Length(); i++) {
				Napi::Value item = arr.Get(i);
				if (!item.IsObject()) {
					continue;
				}
				Napi::Object option = item.As<Napi::Object>();
				NSString *optionId = JSString(option.Get("id"));
				if (optionId.length == 0) {
					continue;
				}
				[options addObject:@{
					@"id": optionId,
					@"label": JSString(option.Get("label"))
				}];
			}
		}
		payload[@"pendingOptions"] = options;
	} else {
		payload[@"interactionId"] = JSString(snapshot.Get("interactionId"));
		payload[@"pendingKind"] = JSString(snapshot.Get("pendingKind"));
		payload[@"pendingTitle"] = JSString(snapshot.Get("pendingTitle"));
		payload[@"pendingMessage"] = JSString(snapshot.Get("pendingMessage"));
		if (snapshot.Get("destructive").IsBoolean() && snapshot.Get("destructive").As<Napi::Boolean>().Value()) {
			payload[@"destructive"] = @YES;
		}
		payload[@"pendingOptions"] = @[];
	}
	return payload;
}

static Napi::Value DictToJs(Napi::Env env, id value) {
	if ([value isKindOfClass:[NSNull class]] || value == nil) {
		return env.Null();
	}
	if ([value isKindOfClass:[NSDictionary class]]) {
		Napi::Object obj = Napi::Object::New(env);
		NSDictionary *dict = (NSDictionary *)value;
		for (NSString *key in dict) {
			obj.Set(key.UTF8String, DictToJs(env, dict[key]));
		}
		return obj;
	}
	if ([value isKindOfClass:[NSArray class]]) {
		Napi::Array arr = Napi::Array::New(env);
		NSArray *list = (NSArray *)value;
		for (NSUInteger i = 0; i < list.count; i++) {
			arr.Set(i, DictToJs(env, list[i]));
		}
		return arr;
	}
	if ([value isKindOfClass:[NSNumber class]]) {
		NSNumber *num = (NSNumber *)value;
		if (strcmp(num.objCType, @encode(BOOL)) == 0 || strcmp(num.objCType, "c") == 0) {
			return Napi::Boolean::New(env, num.boolValue);
		}
		return Napi::Number::New(env, num.doubleValue);
	}
	if ([value isKindOfClass:[NSString class]]) {
		return Napi::String::New(env, [(NSString *)value UTF8String] ?: "");
	}
	return env.Null();
}

static Napi::Value GetDiagnostics(const Napi::CallbackInfo &info) {
	Napi::Env env = info.Env();
	// Return factual "controller absent" state if no controller exists
	if (!gController) {
		Napi::Object diag = Napi::Object::New(env);
		diag.Set("panelCreated", Napi::Boolean::New(env, false));
		diag.Set("panelVisible", Napi::Boolean::New(env, false));
		diag.Set("globalMonitorInstalled", Napi::Boolean::New(env, false));
		diag.Set("layerBacked", Napi::Boolean::New(env, false));
		diag.Set("transitionInFlight", Napi::Boolean::New(env, false));
		diag.Set("transitionGeneration", Napi::Number::New(env, 0));
		diag.Set("activePresentationState", Napi::String::New(env, "none"));
		diag.Set("targetPresentationState", Napi::String::New(env, "none"));
		return diag;
	}
	if ([NSThread isMainThread]) {
		CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.001, false);
	}
	NSDictionary *nativeDiag = [gController diagnosticsDict];
	return DictToJs(env, nativeDiag);
}

static Napi::Value SimulateAction(const Napi::CallbackInfo &info) {
	Napi::Env env = info.Env();
	if (info.Length() < 1 || !info[0].IsString()) {
		return Napi::Boolean::New(env, false);
	}
	std::string action = info[0].As<Napi::String>().Utf8Value();
	PrebaseLiveActivityController *controller = EnsureController();
	if (action == "click") {
		if (controller.screenLocked) {
			return Napi::Boolean::New(env, false);
		}
		if (controller.content.peekOnly || controller.attentionPeek || (!controller.pinned && controller.visible)) {
			[controller enterInteractiveSticky];
			return Napi::Boolean::New(env, true);
		}
		return Napi::Boolean::New(env, false);
	}
	if (action == "peek" || action == "hover") {
		// Match pointerInside: sticky Escape must not reopen peek.
		if (controller.content.attention && controller.userDismissedAttention) {
			return Napi::Boolean::New(env, false);
		}
		[controller expandPeek];
		// Fail closed when expandPeek no-ops (lock / hidden / fullscreen policy).
		return Napi::Boolean::New(env, controller.content.peekOnly == YES);
	}
	if (action == "interactive") {
		// Sticky Interactive must match physical click / simulateAction("click").
		[controller enterInteractiveSticky];
		return Napi::Boolean::New(env, true);
	}
	if (action == "escape" || action == "collapse") {
		// Match local Escape monitor: dismissAttention before unpin (renderer race).
		const BOOL attentionDismiss = controller.content.attention;
		if (attentionDismiss) {
			controller.userDismissedAttention = YES;
			[controller emit:@"dismissAttention" extras:nil];
		}
		const BOOL wasPinned = controller.pinned;
		controller.pinned = NO;
		[controller updatePinButtonState];
		if (wasPinned) {
			[controller emit:@"unpin" extras:nil];
		}
		[controller collapseEmittingDismiss:!attentionDismiss];
		return Napi::Boolean::New(env, true);
	}
	if (action == "approve") {
		return Napi::Boolean::New(env, [controller simulateClickApprove]);
	}
	if (action == "deny") {
		return Napi::Boolean::New(env, [controller simulateClickDeny]);
	}
	if (action == "openInPrebase") {
		return Napi::Boolean::New(env, [controller simulateClickOpenInPrebase]);
	}
	if (action == "pin") {
		return Napi::Boolean::New(env, [controller simulateClickPin]);
	}
	if (action == "option" && info.Length() >= 2 && info[1].IsNumber()) {
		NSInteger index = info[1].As<Napi::Number>().Int64Value();
		return Napi::Boolean::New(env, [controller simulateClickOptionIndex:index]);
	}
	if (action == "followUp" && info.Length() >= 2 && info[1].IsString()) {
		NSString *text = [NSString stringWithUTF8String:info[1].As<Napi::String>().Utf8Value().c_str()];
		return Napi::Boolean::New(env, [controller simulateSubmitFollowUp:text]);
	}
	if (action == "pointerInside" && info.Length() >= 2 && info[1].IsBoolean()) {
		BOOL inside = info[1].As<Napi::Boolean>().Value();
		[controller pointerInside:inside];
		return Napi::Boolean::New(env, true);
	}
	return Napi::Boolean::New(env, false);
}

static Napi::Value SetSnapshot(const Napi::CallbackInfo &info) {
	if (gDisposed || info.Length() < 1 || !info[0].IsObject()) {
		return info.Env().Undefined();
	}
	NSDictionary *payload = [SnapshotToDict(info[0].As<Napi::Object>()) copy];
	if ([NSThread isMainThread]) {
		[EnsureController() applySnapshotDict:payload];
	} else {
		dispatch_async(dispatch_get_main_queue(), ^{
			[EnsureController() applySnapshotDict:payload];
		});
	}
	return info.Env().Undefined();
}

static Napi::Value SetPresentation(const Napi::CallbackInfo &info) {
	if (gDisposed || info.Length() < 1 || !info[0].IsObject()) {
		return info.Env().Undefined();
	}
	Napi::Object state = info[0].As<Napi::Object>();
	bool visible = state.Get("visible").ToBoolean();
	bool pinned = state.Get("pinned").ToBoolean();
	bool reduced = state.Get("reducedMotion").ToBoolean();
	NSString *display = JSString(state.Get("display"));
	if ([NSThread isMainThread]) {
		PrebaseLiveActivityController *controller = EnsureController();
		controller.displayMode = display;
		[controller setVisible:visible pinned:pinned reduced:reduced];
	} else {
		dispatch_async(dispatch_get_main_queue(), ^{
			PrebaseLiveActivityController *controller = EnsureController();
			controller.displayMode = display;
			[controller setVisible:visible pinned:pinned reduced:reduced];
		});
	}
	return info.Env().Undefined();
}

static Napi::Value SetCommandHandler(const Napi::CallbackInfo &info) {
	if (info.Length() < 1 || !info[0].IsFunction()) {
		return info.Env().Undefined();
	}
	if (gCommandTsfn) {
		gCommandTsfn.Release();
	}
	gCommandTsfn = Napi::ThreadSafeFunction::New(info.Env(), info[0].As<Napi::Function>(), "magnusLiveActivity", 0, 1);
	return info.Env().Undefined();
}

static Napi::Value DisposeNative(const Napi::CallbackInfo &info) {
	gDisposed = true;
	if (gCommandTsfn) {
		gCommandTsfn.Release();
		gCommandTsfn = {};
	}
	if ([NSThread isMainThread]) {
		[gController teardown];
		gController = nil;
	} else {
		dispatch_sync(dispatch_get_main_queue(), ^{
			[gController teardown];
			gController = nil;
		});
	}
	gDisposed = false;
	return info.Env().Undefined();
}

static Napi::Value ValidatePathTopologyApi(const Napi::CallbackInfo &info) {
	Napi::Env env = info.Env();
	CGFloat leftW = 60.0;
	CGFloat rightW = 60.0;
	CGFloat housingW = 160.0;
	CGFloat bandH = 34.0;
	CGFloat totalW = leftW + housingW + rightW;
	CGFloat expandedH = 180.0;
	BOOL isNotched = YES;

	if (info.Length() >= 1 && info[0].IsObject()) {
		Napi::Object opts = info[0].As<Napi::Object>();
		if (opts.Has("leftW")) leftW = opts.Get("leftW").ToNumber().DoubleValue();
		if (opts.Has("rightW")) rightW = opts.Get("rightW").ToNumber().DoubleValue();
		if (opts.Has("housingW")) housingW = opts.Get("housingW").ToNumber().DoubleValue();
		if (opts.Has("bandH")) bandH = opts.Get("bandH").ToNumber().DoubleValue();
		if (opts.Has("totalW")) totalW = opts.Get("totalW").ToNumber().DoubleValue();
		else totalW = leftW + housingW + rightW;
		if (opts.Has("expandedH")) expandedH = opts.Get("expandedH").ToNumber().DoubleValue();
		if (opts.Has("isNotched")) isNotched = opts.Get("isNotched").ToBoolean();
	}

	CGPathRef pathCollapsed = CreateNotchedIslandPath(totalW, bandH, leftW, rightW, housingW, bandH, NO, isNotched);
	CGPathRef pathExpanded = CreateNotchedIslandPath(totalW, expandedH, leftW, rightW, housingW, bandH, YES, isNotched);

	BOOL compatible = ValidatePathTopology(pathCollapsed, pathExpanded);
	auto el1 = ExtractPathElements(pathCollapsed);
	auto el2 = ExtractPathElements(pathExpanded);

	CGPathRelease(pathCollapsed);
	CGPathRelease(pathExpanded);

	Napi::Object result = Napi::Object::New(env);
	result.Set("compatible", Napi::Boolean::New(env, compatible));
	result.Set("collapsedElements", Napi::Number::New(env, (double)el1.size()));
	result.Set("expandedElements", Napi::Number::New(env, (double)el2.size()));
	return result;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
	exports.Set("setSnapshot", Napi::Function::New(env, SetSnapshot));
	exports.Set("setPresentation", Napi::Function::New(env, SetPresentation));
	exports.Set("setCommandHandler", Napi::Function::New(env, SetCommandHandler));
	exports.Set("getDiagnostics", Napi::Function::New(env, GetDiagnostics));
	exports.Set("simulateAction", Napi::Function::New(env, SimulateAction));
	exports.Set("validatePathTopology", Napi::Function::New(env, ValidatePathTopologyApi));
	exports.Set("dispose", Napi::Function::New(env, DisposeNative));
	return exports;
}

NODE_API_MODULE(prebase_live_activity, Init)
