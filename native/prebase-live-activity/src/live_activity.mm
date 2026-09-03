#include <napi.h>
#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>
#import <QuartzCore/QuartzCore.h>

// Dynamic geometry metrics
static const CGFloat kCollapsedHeight = 34;
static const CGFloat kPeekBodyHeight = 56;
static const CGFloat kWingWidthMin = 52;
static const CGFloat kWingWidthMax = 148;
static const CGFloat kPillWidth = 228;
static const CGFloat kPillHeight = 30;
static const CGFloat kNotchMinSafeTop = 8;
static const CGFloat kNotchMinAuxWidth = 40;
static const CGFloat kCameraHousingMin = 24;
static const CGFloat kPillCornerRadius = 16;
static const CGFloat kShoulderRadius = 12;
static const CGFloat kBottomCornerRadius = 16;

static const NSTimeInterval kHoverDwellInterval = 0.18; // 180ms intentional acquisition
static const NSTimeInterval kExitGraceInterval = 0.25;  // 250ms hysteresis for movement into body

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
	// Invariant sequence across all states (collapsed, peek, interactive, pinned)
	CGFloat effShoulderR = isExpanded ? MIN(kShoulderRadius, (currentH - bandH) * 0.5) : 0.0;
	CGFloat effBottomR = MIN(kBottomCornerRadius, currentH * 0.5);
	CGFloat kBottom = effBottomR * (1.0 - kKappa);
	CGFloat kShoulder = effShoulderR * (1.0 - kKappa);

	// 0. Move to top-left of left wing (0, 0)
	CGPathMoveToPoint(path, NULL, 0, 0);

	// 1. Line across top of left wing to notch start (leftW, 0)
	CGPathAddLineToPoint(path, NULL, leftW, 0);

	// 2. Line down into camera housing cutout (leftW, bandH)
	CGPathAddLineToPoint(path, NULL, leftW, bandH);

	// 3. Line across bottom of camera housing cutout (leftW + housingW, bandH)
	CGPathAddLineToPoint(path, NULL, leftW + housingW, bandH);

	// 4. Line up from camera housing cutout to notch end (leftW + housingW, 0)
	CGPathAddLineToPoint(path, NULL, leftW + housingW, 0);

	// 5. Line across top of right wing to top-right corner (totalW, 0)
	CGPathAddLineToPoint(path, NULL, totalW, 0);

	// 6. Right shoulder curve from (totalW, 0) down into body (totalW, bandH + effShoulderR)
	CGPathAddCurveToPoint(path, NULL,
		totalW, bandH * 0.5,
		totalW, bandH + kShoulder,
		totalW, bandH + effShoulderR);

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

	// 11. Line up left side to left shoulder start (0, bandH + effShoulderR)
	CGPathAddLineToPoint(path, NULL, 0, bandH + effShoulderR);

	// 12. Left shoulder curve from (0, bandH + effShoulderR) up to (0, 0)
	CGPathAddCurveToPoint(path, NULL,
		0, bandH + kShoulder,
		0, bandH * 0.5,
		0, 0);

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
@property (nonatomic, strong) NSView *compactContainer;
@property (nonatomic, strong) NSView *expandedContainer;

@property (nonatomic, strong) NSTextField *leftStatusLabel;
@property (nonatomic, strong) NSTextField *rightMetricsLabel;

@property (nonatomic, strong) NSTextField *headerTitle;
@property (nonatomic, strong) NSTextField *statusBadge;
@property (nonatomic, strong) NSTextField *activityDescription;
@property (nonatomic, strong) NSTextField *latestMessageLabel;
@property (nonatomic, strong) NSMutableArray<NSTextField *> *actionLabels;
@property (nonatomic, strong) NSTextField *pendingInteractionTitle;
@property (nonatomic, strong) NSTextField *pendingInteractionMessage;
@property (nonatomic, strong) NSTextField *expandedMetricsLabel;

@property (nonatomic, copy) NSString *statusLabel;
@property (nonatomic, copy) NSString *activityLabel;
@property (nonatomic, copy) NSString *latestMessage;
@property (nonatomic, copy) NSString *metricsLabel;
@property (nonatomic, copy) NSString *pendingTitle;
@property (nonatomic, copy) NSString *pendingMessage;
@property (nonatomic, copy) NSArray<NSString *> *actions;
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
@property (nonatomic, strong) NSTrackingArea *trackingArea;
@property (nonatomic, weak) PrebaseLiveActivityController *controller;

- (void)updateShapeAndContentAnimated:(BOOL)animated duration:(NSTimeInterval)duration useTargetState:(BOOL)useTargetState;
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
@property (nonatomic, assign) NSUInteger redrawCount;
@property (nonatomic, assign) NSUInteger animationCount;
@property (nonatomic, assign) BOOL transitionInFlight;
@property (nonatomic, assign) NSUInteger transitionGeneration;
@property (nonatomic, assign) NSTimeInterval transitionEndTime;

- (void)applySnapshotDict:(NSDictionary *)snapshot;
- (void)teardown;
- (void)mouseUp:(NSEvent *)event;
- (void)mouseEnteredInView:(NSEvent *)event;
- (void)mouseExitedFromView:(NSEvent *)event;
- (void)clearPendingInteraction;
- (void)expandPeek;
- (void)expandInteractive;
- (void)enterInteractiveSticky;
- (void)collapse;
- (void)collapseEmittingDismiss:(BOOL)emitDismiss;
- (NSDictionary *)diagnosticsDict;
- (void)performUserHaptic;
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
		_shapeLayer.fillColor = [NSColor colorWithCalibratedWhite:0.035 alpha:0.99].CGColor;
		_shapeLayer.strokeColor = nil;
		_shapeLayer.lineWidth = 0;
		// Explicitly synchronize shape layer geometry to content view bounds
		_shapeLayer.frame = self.bounds;
		[self.layer addSublayer:_shapeLayer];

		_compactContainer = [[PrebaseFlippedView alloc] initWithFrame:self.bounds];
		_compactContainer.wantsLayer = YES;
		[self addSubview:_compactContainer];

		_leftStatusLabel = [self makeLabel:11 weight:NSFontWeightMedium color:[NSColor colorWithCalibratedWhite:0.94 alpha:1.0]];
		[_compactContainer addSubview:_leftStatusLabel];

		_rightMetricsLabel = [self makeLabel:10 weight:NSFontWeightRegular color:[NSColor colorWithCalibratedWhite:0.75 alpha:1.0]];
		_rightMetricsLabel.font = [NSFont monospacedDigitSystemFontOfSize:10 weight:NSFontWeightRegular];
		[_compactContainer addSubview:_rightMetricsLabel];

		_expandedContainer = [[PrebaseFlippedView alloc] initWithFrame:self.bounds];
		_expandedContainer.wantsLayer = YES;
		_expandedContainer.alphaValue = 0.0;
		_expandedContainer.hidden = YES;
		[self addSubview:_expandedContainer];

		_headerTitle = [self makeLabel:12 weight:NSFontWeightSemibold color:[NSColor colorWithCalibratedWhite:0.96 alpha:1.0]];
		_headerTitle.stringValue = @"Magnus";
		[_expandedContainer addSubview:_headerTitle];

		_statusBadge = [self makeLabel:10 weight:NSFontWeightMedium color:[NSColor colorWithCalibratedWhite:0.65 alpha:1.0]];
		[_expandedContainer addSubview:_statusBadge];

		_activityDescription = [self makeLabel:11 weight:NSFontWeightMedium color:[NSColor colorWithCalibratedWhite:0.88 alpha:1.0]];
		[_expandedContainer addSubview:_activityDescription];

		_latestMessageLabel = [self makeLabel:11 weight:NSFontWeightRegular color:[NSColor colorWithCalibratedWhite:0.86 alpha:1.0]];
		_latestMessageLabel.hidden = YES;
		[_expandedContainer addSubview:_latestMessageLabel];

		_actionLabels = [NSMutableArray array];
		for (NSInteger i = 0; i < 3; i++) {
			NSTextField *bullet = [self makeLabel:10 weight:NSFontWeightRegular color:[NSColor colorWithCalibratedWhite:0.72 alpha:1.0]];
			[_actionLabels addObject:bullet];
			[_expandedContainer addSubview:bullet];
		}

		_pendingInteractionTitle = [self makeLabel:11 weight:NSFontWeightSemibold color:[NSColor colorWithCalibratedWhite:0.95 alpha:1.0]];
		[_expandedContainer addSubview:_pendingInteractionTitle];

		_pendingInteractionMessage = [self makeLabel:10 weight:NSFontWeightRegular color:[NSColor colorWithCalibratedWhite:0.78 alpha:1.0]];
		[_expandedContainer addSubview:_pendingInteractionMessage];

		_expandedMetricsLabel = [self makeLabel:10 weight:NSFontWeightRegular color:[NSColor colorWithCalibratedWhite:0.62 alpha:1.0]];
		_expandedMetricsLabel.font = [NSFont monospacedDigitSystemFontOfSize:10 weight:NSFontWeightRegular];
		[_expandedContainer addSubview:_expandedMetricsLabel];
	}
	return self;
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
	return tf;
}

- (BOOL)isFlipped { return YES; }
- (BOOL)acceptsFirstMouse:(NSEvent *)event { return YES; }

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

- (void)updateShapeAndContentAnimated:(BOOL)animated duration:(NSTimeInterval)duration useTargetState:(BOOL)useTargetState {
	self.controller.redrawCount++;
	NSRect bounds = self.bounds;
	CGFloat bandH = MAX(self.safeAreaTop, kCollapsedHeight);
	// Use explicit semantic target state when available, otherwise infer from bounds for compatibility
	BOOL isExpanded = useTargetState ? self.targetExpanded : (bounds.size.height > bandH + 2.0);

	CGFloat totalW = NSWidth(bounds);
	CGFloat currentH = NSHeight(bounds);
	CGFloat leftW = self.leftWingWidth > 0 ? self.leftWingWidth : kWingWidthMin;
	CGFloat rightW = self.rightWingWidth > 0 ? self.rightWingWidth : kWingWidthMin;
	CGFloat housing = self.housingWidth > 0 ? self.housingWidth : kCameraHousingMin;

	// Synchronize shape layer geometry to content view bounds
	self.shapeLayer.frame = bounds;

	CGColorRef fill = self.attention
		? [NSColor colorWithCalibratedWhite:0.07 alpha:0.99].CGColor
		: [NSColor colorWithCalibratedWhite:0.035 alpha:0.99].CGColor;
	self.shapeLayer.fillColor = fill;

	if (!self.notched) {
		self.shapeLayer.strokeColor = [NSColor colorWithCalibratedWhite:1.0 alpha:0.14].CGColor;
		self.shapeLayer.lineWidth = 1.0;
	} else {
		self.shapeLayer.strokeColor = nil;
		self.shapeLayer.lineWidth = 0.0;
	}

	CGPathRef targetPath = CreateNotchedIslandPath(totalW, currentH, leftW, rightW, housing, bandH, isExpanded, self.notched);

	if (animated && !self.reducedMotion) {
		self.controller.animationCount++;
		self.controller.transitionInFlight = YES;
		self.controller.transitionEndTime = [NSDate timeIntervalSinceReferenceDate] + duration;
		const NSUInteger currentGeneration = ++self.controller.transitionGeneration;

		// Presentation-layer aware retargeting: sample current in-flight path to avoid jumps
		CAShapeLayer *presentation = (CAShapeLayer *)[self.shapeLayer presentationLayer];
		CGPathRef fromPath = presentation && presentation.path ? presentation.path : self.shapeLayer.path;
		if (!fromPath) {
			fromPath = targetPath;
		}

		[CATransaction begin];
		[CATransaction setAnimationDuration:duration];
		[CATransaction setAnimationTimingFunction:[CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseInEaseOut]];
		[CATransaction setCompletionBlock:^{
			// Only mark transition complete if this completion block matches the current generation
			// This prevents stale animation completions from incorrectly marking newer transitions as finished
			if (currentGeneration == self.controller.transitionGeneration) {
				self.controller.transitionInFlight = NO;
			}
		}];

		CABasicAnimation *pathAnimation = [CABasicAnimation animationWithKeyPath:@"path"];
		pathAnimation.fromValue = (__bridge id)fromPath;
		pathAnimation.toValue = (__bridge id)targetPath;
		pathAnimation.duration = duration;
		pathAnimation.timingFunction = [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseInEaseOut];
		pathAnimation.removedOnCompletion = YES;
		[self.shapeLayer addAnimation:pathAnimation forKey:@"morphPath"];

		self.shapeLayer.path = targetPath;
		[CATransaction commit];
	} else {
		self.shapeLayer.path = targetPath;
		[self.shapeLayer removeAnimationForKey:@"morphPath"];
		self.controller.transitionInFlight = NO;
	}
	CGPathRelease(targetPath);

	// Update Content Subviews
	self.compactContainer.frame = NSMakeRect(0, 0, totalW, bandH);
	self.expandedContainer.frame = NSMakeRect(0, bandH, totalW, MAX(0, currentH - bandH));

	if (!isExpanded) {
		// Collapsed content layout
		if (animated && !self.reducedMotion) {
			[NSAnimationContext runAnimationGroup:^(NSAnimationContext *ctx) {
				ctx.duration = duration * 0.7;
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

		NSString *label = self.statusLabel.length ? self.statusLabel : @"Magnus";
		self.leftStatusLabel.stringValue = label;
		CGFloat maxLabelWidth = self.notched ? (leftW - 20) : (totalW - 28);
		self.leftStatusLabel.frame = NSMakeRect(14, MAX(4, (bandH - 18) / 2.0), maxLabelWidth, 18);

		if (self.notched && self.metricsLabel.length) {
			self.rightMetricsLabel.stringValue = self.metricsLabel;
			self.rightMetricsLabel.hidden = NO;
			CGFloat metricsX = leftW + housing + 8;
			CGFloat metricsW = MAX(20, rightW - 16);
			self.rightMetricsLabel.frame = NSMakeRect(metricsX, MAX(4, (bandH - 18) / 2.0), metricsW, 18);
		} else {
			self.rightMetricsLabel.hidden = YES;
		}
	} else {
		// Expanded content layout
		self.expandedContainer.hidden = NO;
		BOOL keepCompactWings = self.peekOnly;
		if (animated && !self.reducedMotion) {
			[NSAnimationContext runAnimationGroup:^(NSAnimationContext *ctx) {
				ctx.duration = duration;
				// Peek keeps compact leading/trailing wings (Live Activity);
				// Interactive fades them for the detailed widget surface.
				self.compactContainer.animator.alphaValue = keepCompactWings ? 1.0 : 0.0;
				self.expandedContainer.animator.alphaValue = 1.0;
			}];
		} else {
			self.compactContainer.alphaValue = keepCompactWings ? 1.0 : 0.0;
			self.expandedContainer.alphaValue = 1.0;
			self.expandedContainer.hidden = NO;
		}

		if (self.peekOnly) {
			// Sapphire-style Live Activity peek: compact wings stay readable;
			// body is a single glance reason — not a cropped Interactive panel.
			NSString *label = self.statusLabel.length ? self.statusLabel : @"Magnus";
			self.leftStatusLabel.stringValue = label;
			CGFloat maxLabelWidth = self.notched ? (leftW - 20) : (totalW - 28);
			self.leftStatusLabel.frame = NSMakeRect(14, MAX(4, (bandH - 18) / 2.0), maxLabelWidth, 18);
			if (self.notched && self.metricsLabel.length) {
				self.rightMetricsLabel.stringValue = self.metricsLabel;
				self.rightMetricsLabel.hidden = NO;
				CGFloat metricsX = leftW + housing + 8;
				CGFloat metricsW = MAX(20, rightW - 16);
				self.rightMetricsLabel.frame = NSMakeRect(metricsX, MAX(4, (bandH - 18) / 2.0), metricsW, 18);
			} else {
				self.rightMetricsLabel.hidden = YES;
			}
			self.headerTitle.hidden = YES;
			self.statusBadge.hidden = YES;
			for (NSInteger i = 0; i < 3; i++) {
				self.actionLabels[i].hidden = YES;
			}
			self.pendingInteractionTitle.hidden = YES;
			self.pendingInteractionMessage.hidden = YES;
			self.expandedMetricsLabel.hidden = YES;
			self.latestMessageLabel.hidden = YES;
			CGFloat bodyY = 6;
			// Attention peek prefers pending body text over activity; title is last resort.
			NSString *peekBody = nil;
			if (self.pendingMessage.length) {
				peekBody = self.pendingMessage;
			} else if (self.pendingTitle.length) {
				peekBody = self.pendingTitle;
			} else if (self.activityLabel.length) {
				peekBody = self.activityLabel;
			}
			if (peekBody.length) {
				if (peekBody.length > 96) {
					peekBody = [[peekBody substringToIndex:93] stringByAppendingString:@"…"];
				}
				self.activityDescription.stringValue = peekBody;
				self.activityDescription.hidden = NO;
				self.activityDescription.frame = NSMakeRect(16, bodyY, totalW - 32, 16);
			} else {
				self.activityDescription.hidden = YES;
			}
			return;
		}

		CGFloat bodyY = 6;
		// Header row
		self.headerTitle.frame = NSMakeRect(16, bodyY, 120, 18);

		NSString *statusText = self.statusLabel.length
			? self.statusLabel
			: (self.attention ? @"Attention" : (self.status.length ? [self.status capitalizedString] : @"Working"));
		self.statusBadge.stringValue = statusText;
		self.statusBadge.textColor = self.attention
			? [NSColor colorWithCalibratedRed:0.98 green:0.65 blue:0.18 alpha:0.95]
			: [NSColor colorWithCalibratedWhite:0.65 alpha:1.0];
		self.statusBadge.frame = NSMakeRect(totalW - 116, bodyY + 1, 100, 16);
		self.statusBadge.alignment = NSTextAlignmentRight;

		bodyY += 22;

		// Current activity
		if (self.activityLabel.length) {
			self.activityDescription.stringValue = self.activityLabel;
			self.activityDescription.hidden = NO;
			self.activityDescription.frame = NSMakeRect(16, bodyY, totalW - 32, 16);
			bodyY += 18;
		} else {
			self.activityDescription.hidden = YES;
		}

		// Latest short response from Magnus (no decorative emoji — keep glanceable typography)
		if (self.latestMessage.length) {
			self.latestMessageLabel.stringValue = self.latestMessage;
			self.latestMessageLabel.hidden = NO;
			self.latestMessageLabel.frame = NSMakeRect(16, bodyY, totalW - 32, 18);
			bodyY += 20;
		} else {
			self.latestMessageLabel.hidden = YES;
		}

		// Recent actions
		for (NSInteger i = 0; i < 3; i++) {
			NSTextField *bullet = self.actionLabels[i];
			if (i < (NSInteger)self.actions.count) {
				bullet.stringValue = [NSString stringWithFormat:@"•  %@", self.actions[i]];
				bullet.hidden = NO;
				bullet.frame = NSMakeRect(18, bodyY, totalW - 36, 15);
				bodyY += 15;
			} else {
				bullet.hidden = YES;
			}
		}

		// Pending interaction title + message from canonical snapshot
		if (self.pendingTitle.length) {
			bodyY += 2;
			self.pendingInteractionTitle.stringValue = self.pendingTitle;
			self.pendingInteractionTitle.hidden = NO;
			self.pendingInteractionTitle.frame = NSMakeRect(16, bodyY, totalW - 32, 18);
			bodyY += 18;
		} else {
			self.pendingInteractionTitle.hidden = YES;
		}
		if (self.pendingMessage.length && !self.peekOnly) {
			self.pendingInteractionMessage.stringValue = self.pendingMessage;
			self.pendingInteractionMessage.hidden = NO;
			self.pendingInteractionMessage.frame = NSMakeRect(16, bodyY, totalW - 32, 16);
			bodyY += 18;
		} else {
			self.pendingInteractionMessage.hidden = YES;
		}

		// Metrics line
		if (self.metricsLabel.length) {
			self.expandedMetricsLabel.stringValue = self.metricsLabel;
			self.expandedMetricsLabel.hidden = NO;
			self.expandedMetricsLabel.frame = NSMakeRect(16, bodyY, totalW - 32, 16);
		} else {
			self.expandedMetricsLabel.hidden = YES;
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
		self.didAttentionHaptic = NO;
		self.hapticCount = 0;
		self.redrawCount = 0;
		self.animationCount = 0;
		self.transitionInFlight = NO;
		self.transitionGeneration = 0;
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
	NSRect frame = NSMakeRect(0, 0, 280, 36);
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

	self.input = [[NSTextField alloc] initWithFrame:NSMakeRect(14, 0, 200, 24)];
	self.input.placeholderString = @"Message Magnus...";
	self.input.font = [NSFont systemFontOfSize:11];
	self.input.focusRingType = NSFocusRingTypeNone;
	self.input.bordered = YES;
	self.input.backgroundColor = [NSColor colorWithCalibratedWhite:0.12 alpha:0.9];
	self.input.textColor = [NSColor colorWithCalibratedWhite:0.95 alpha:1.0];
	self.input.hidden = YES;
	self.input.target = self;
	self.input.action = @selector(submitFollowUp:);
	self.input.accessibilityLabel = @"Message Magnus";
	[self.content.expandedContainer addSubview:self.input];

	self.openButton = [self makeButton:@"Open in PreBase" action:@selector(openInPrebase:)];
	self.pinButton = [self makeButton:@"Pin" action:@selector(togglePin:)];
	self.pinButton.accessibilityLabel = @"Pin panel";
	self.approveButton = [self makeButton:@"Approve" action:@selector(approve:)];
	self.denyButton = [self makeButton:@"Deny" action:@selector(deny:)];
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

- (NSButton *)makeButton:(NSString *)title action:(SEL)action {
	NSButton *button = [[NSButton alloc] initWithFrame:NSMakeRect(0, 0, 88, 22)];
	button.title = title;
	button.bezelStyle = NSBezelStyleRounded;
	button.font = [NSFont systemFontOfSize:11];
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

- (CGFloat)computeLeftWingWidth {
	NSString *label = self.content.statusLabel.length ? self.content.statusLabel : @"Magnus";
	CGFloat textW = [self measureStringWidth:label font:[NSFont systemFontOfSize:11 weight:NSFontWeightMedium]];
	CGFloat raw = textW + 28;
	// Stable width buckets (step by 8pt) to prevent 1-second typography jitter
	CGFloat bucketed = ceil(raw / 8.0) * 8.0;
	return MIN(kWingWidthMax, MAX(kWingWidthMin, bucketed));
}

- (CGFloat)computeRightWingWidth {
	if (!self.content.metricsLabel.length) {
		return kWingWidthMin;
	}
	CGFloat textW = [self measureStringWidth:self.content.metricsLabel font:[NSFont monospacedDigitSystemFontOfSize:10 weight:NSFontWeightRegular]];
	CGFloat raw = textW + 26;
	CGFloat bucketed = ceil(raw / 8.0) * 8.0;
	return MIN(kWingWidthMax, MAX(kWingWidthMin, bucketed));
}

- (CGFloat)computeTargetContentHeight:(CGFloat)bandH {
	BOOL expanded = self.content.expanded || self.pinned;
	if (!expanded) {
		return bandH;
	}
	if ((self.content.peekOnly || self.attentionPeek) && !self.pinned) {
		CGFloat h = bandH + 8;
		if (self.content.pendingTitle.length) {
			h += 20;
		} else if (self.content.activityLabel.length) {
			h += 18;
		} else {
			h += 16;
		}
		h += 8;
		return MIN(bandH + kPeekBodyHeight, h);
	}
	// Content-aware expanded sizing
	CGFloat h = bandH + 8; // Top padding below notch band
	h += 22; // Header
	if (self.content.activityLabel.length) {
		h += 18;
	}
	if (self.content.latestMessage.length) {
		h += 20;
	}
	if (self.content.actions.count > 0) {
		h += MIN((NSInteger)self.content.actions.count, 3) * 15;
	}
	if (self.content.pendingTitle.length) {
		h += 20;
	}
	if (self.content.pendingMessage.length) {
		h += 18;
	}
	if (self.content.metricsLabel.length) {
		h += 18;
	}
	h += 10; // Spacing before controls

	BOOL hasOptions = ([self.pendingKind isEqualToString:@"question"] && self.pendingOptions.count > 0);
	BOOL hasApproval = [self.pendingKind isEqualToString:@"approval"];
	BOOL showInput = (self.content.expanded || self.pinned) && !self.content.peekOnly;

	if (hasOptions) {
		h += 30; // Options row
	}
	if (hasApproval) {
		h += 28; // Approval buttons row
	}
	if (showInput) {
		h += 32; // Follow-up message row
	} else if (!hasOptions && !hasApproval) {
		h += 24; // Open in PreBase row
	}

	h += 10; // Bottom corner inset
	return MIN(220.0, MAX(86.0, h));
}

- (void)layoutForScreen {
	NSScreen *screen = [self targetScreen];
	if (!screen) {
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
	BOOL expanded = self.content.expanded || self.pinned;
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
			CGFloat minExpandedW = MAX(totalW, 360.0);
			if (minExpandedW > totalW) {
				totalW = minExpandedW;
				CGFloat notchCenterX = NSMaxX(auxLeft) + housing / 2.0;
				CGFloat winX = notchCenterX - totalW / 2.0;
				self.content.leftWingWidth = NSMaxX(auxLeft) - winX;
				self.content.rightWingWidth = totalW - (self.content.leftWingWidth + housing);
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
		CGFloat w = expanded ? 340 : kPillWidth;
		CGFloat h = expanded ? height : kPillHeight;
		win = NSMakeRect(NSMidX(frame) - w / 2.0, topY - h, w, h);
		self.collapsedHit = NSMakeRect(NSMidX(frame) - kPillWidth / 2.0, topY - kPillHeight, kPillWidth, kPillHeight);
	}
	self.lastRequestedFrame = win;
	self.layoutScreen = screen;
	self.panel.level = LiveActivityWindowLevel();

	NSTimeInterval animDuration = (win.size.height > self.panel.frame.size.height) ? 0.24 : 0.18;
	BOOL isFirstLayout = !self.panel.isVisible || NSEqualRects(self.panel.frame, NSMakeRect(0, 0, 280, 36));

	if (self.reducedMotion) {
		[self.panel setFrame:win display:YES animate:NO];
		self.content.targetExpanded = expanded;
		[self.content updateShapeAndContentAnimated:NO duration:0 useTargetState:YES];
		[self layoutControls:win];
	} else if (isFirstLayout) {
		[self.panel setFrame:win display:YES animate:NO];
		self.content.targetExpanded = expanded;
		[self.content updateShapeAndContentAnimated:NO duration:0 useTargetState:YES];
		[self layoutControls:win];
	} else {
		// Delay control layout until frame animation completes to prevent visible popping.
		const NSUInteger generation = ++self.transitionGeneration;
		[NSAnimationContext runAnimationGroup:^(NSAnimationContext *context) {
			context.duration = animDuration;
			context.timingFunction = [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseInEaseOut];
			context.allowsImplicitAnimation = YES;
			[[self.panel animator] setFrame:win display:YES];
		} completionHandler:^{
			// Delay control layout until frame animation completes to prevent visible popping
			if (generation == self.transitionGeneration) {
				[self layoutControls:win];
			}
		}];
		self.content.targetExpanded = expanded;
		[self.content updateShapeAndContentAnimated:YES duration:animDuration useTargetState:YES];
	}
}

- (void)layoutControls:(NSRect)win {
	BOOL showInput = (self.content.expanded || self.pinned) && !self.content.peekOnly;
	BOOL approval = [self.pendingKind isEqualToString:@"approval"];
	BOOL question = [self.pendingKind isEqualToString:@"question"];
	BOOL showAttention = (self.content.expanded || self.pinned) && !self.content.peekOnly;
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
	CGFloat effectiveH = MAX(win.size.height, [self computeTargetContentHeight:bandH]);
	CGFloat bodyHeight = effectiveH - bandH;
	CGFloat bottomY = bodyHeight - 28;

	[self updatePinButtonState];
	self.pinButton.hidden = NO;

	if (showInput) {
		self.input.hidden = NO;
		self.input.frame = NSMakeRect(14, bottomY, NSWidth(win) - 206, 24);
		self.pinButton.frame = NSMakeRect(NSWidth(win) - 186, bottomY, 52, 22);
		self.openButton.frame = NSMakeRect(NSWidth(win) - 128, bottomY, 114, 22);
		self.openButton.hidden = NO;
		bottomY -= 30;
	} else {
		self.input.hidden = YES;
		self.pinButton.frame = NSMakeRect(NSWidth(win) - 186, bottomY, 52, 22);
		self.openButton.frame = NSMakeRect(NSWidth(win) - 128, bottomY, 114, 22);
		self.openButton.hidden = NO;
	}

	if (!self.approveButton.hidden) {
		NSString *approveTitle = self.pendingDestructive ? @"Approve (destructive)" : @"Approve";
		self.approveButton.title = approveTitle;
		self.approveButton.accessibilityLabel = approveTitle;
		self.denyButton.frame = NSMakeRect(14, bottomY, 68, 22);
		self.approveButton.frame = NSMakeRect(86, bottomY, self.pendingDestructive ? 144 : 78, 22);
	}

	if (question && showAttention) {
		NSInteger totalOpts = (NSInteger)self.pendingOptions.count;
		CGFloat x = 14;
		if (totalOpts <= 4) {
			for (NSInteger i = 0; i < totalOpts && i < (NSInteger)self.optionButtons.count; i++) {
				NSDictionary *option = self.pendingOptions[i];
				NSButton *button = self.optionButtons[i];
				NSString *label = option[@"label"] ?: option[@"id"] ?: @"Option";
				button.title = label;
				button.accessibilityLabel = label;
				button.hidden = NO;
				CGFloat width = MIN(130, MAX(64, label.length * 7.0 + 16.0));
				if (x + width > NSWidth(win) - 134) {
					x = 14;
					bottomY -= 26;
				}
				button.frame = NSMakeRect(x, bottomY, width, 22);
				x += width + 6;
			}
		} else {
			// >4 options: Show first 3 options directly + 4th button "More in PreBase..."
			for (NSInteger i = 0; i < 3 && i < (NSInteger)self.optionButtons.count; i++) {
				NSDictionary *option = self.pendingOptions[i];
				NSButton *button = self.optionButtons[i];
				NSString *label = option[@"label"] ?: option[@"id"] ?: @"Option";
				button.title = label;
				button.accessibilityLabel = label;
				button.hidden = NO;
				CGFloat width = MIN(100, MAX(56, label.length * 6.5 + 14.0));
				button.frame = NSMakeRect(x, bottomY, width, 22);
				x += width + 6;
			}
			if (self.optionButtons.count >= 4) {
				NSButton *moreButton = self.optionButtons[3];
				moreButton.title = @"More in PreBase…";
				moreButton.accessibilityLabel = @"More options in PreBase";
				moreButton.hidden = NO;
				moreButton.frame = NSMakeRect(x, bottomY, 118, 22);
			}
		}
	}
}

- (void)performUserHaptic {
	self.hapticCount++;
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
}

- (void)mouseExitedFromView:(NSEvent *)event {
	// Attention peek is not hover-owned — only Escape/resolve/sticky Interactive dismisses it.
	if (self.pinned || !self.content.expanded || self.attentionPeek || self.content.attention) {
		return;
	}
	[self.exitTimer invalidate];
	__weak PrebaseLiveActivityController *weakSelf = self;
	self.exitTimer = [NSTimer scheduledTimerWithTimeInterval:kExitGraceInterval repeats:NO block:^(NSTimer *timer) {
		[weakSelf collapse];
	}];
}

- (void)pointerInside:(BOOL)inside {
	if (self.screenLocked || self.pinned || self.attentionPeek || self.content.peekOnly) {
		return;
	}
	// Sticky Escape: attention stays compact until click; hover must not reopen peek.
	if (self.content.attention && self.userDismissedAttention) {
		return;
	}
	if (inside) {
		[self.exitTimer invalidate];
		self.exitTimer = nil;
		if (!self.hovering) {
			self.hovering = YES;
			[self.hoverTimer invalidate];
			__weak PrebaseLiveActivityController *weakSelf = self;
			self.hoverTimer = [NSTimer scheduledTimerWithTimeInterval:kHoverDwellInterval repeats:NO block:^(NSTimer *timer) {
				if (!weakSelf.didHoverHaptic) {
					weakSelf.didHoverHaptic = YES;
					[weakSelf performUserHaptic];
				}
				[weakSelf expandPeek];
			}];
		}
	} else {
		[self.hoverTimer invalidate];
		self.hoverTimer = nil;
		self.hovering = NO;
		if (self.content.expanded) {
			__weak PrebaseLiveActivityController *weakSelf = self;
			[self.exitTimer invalidate];
			self.exitTimer = [NSTimer scheduledTimerWithTimeInterval:kExitGraceInterval repeats:NO block:^(NSTimer *timer) {
				[weakSelf collapse];
			}];
		} else {
			self.didHoverHaptic = NO;
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
	self.panel.ignoresMouseEvents = NO;
	self.ignoresMouse = NO;
	[self installLocalKeyMonitor];
	[self removeGlobalMonitorOnly];
	self.pinButton.hidden = NO;
	self.openButton.hidden = NO;
	self.input.hidden = NO;
	[self layoutForScreen];
}

/** Peek/Attention click → sticky Interactive (same path for physical + simulated click). */
- (void)enterInteractiveSticky {
	if (!self.visible || self.screenLocked) {
		return;
	}
	self.userDismissedAttention = NO;
	[self performUserHaptic];
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
	self.attentionPeek = NO;
	self.content.peekOnly = NO;
	self.content.expanded = NO;
	self.content.targetExpanded = NO;
	self.panel.ignoresMouseEvents = YES;
	self.ignoresMouse = YES;
	self.didHoverHaptic = NO;
	self.didAttentionHaptic = NO;
	self.lastInside = NO;
	self.input.hidden = YES;
	[self removeLocalKeyMonitor];
	[self.panel makeFirstResponder:nil];
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
	[self performUserHaptic];
	[self emit:@"followUp" extras:@{ @"text": text }];
	self.input.stringValue = @"";
}

- (void)openInPrebase:(id)sender {
	[self performUserHaptic];
	self.pinned = NO;
	[self emit:@"openInPrebase" extras:nil];
	[self collapse];
}

- (void)approve:(id)sender {
	[self performUserHaptic];
	[self emit:@"approve" extras:@{ @"interactionId": self.interactionId ?: @"" }];
	[self clearPendingInteraction];
}

- (void)deny:(id)sender {
	[self performUserHaptic];
	[self emit:@"deny" extras:@{ @"interactionId": self.interactionId ?: @"" }];
	[self clearPendingInteraction];
}

- (void)answerOption:(id)sender {
	NSButton *button = (NSButton *)sender;
	if (button.tag == 3 && self.pendingOptions.count > 4) {
		// Tertiary "More in PreBase..." delegate
		[self openInPrebase:sender];
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
	[self performUserHaptic];
	NSString *interactionId = self.interactionId ?: @"";
	[self emit:@"answer" extras:@{
		@"interactionId": interactionId,
		@"optionId": optionId
	}];
	[self clearPendingInteraction];
}

- (void)clearPendingInteraction {
	self.interactionId = @"";
	self.pendingKind = @"";
	self.pendingDestructive = NO;
	self.pendingOptions = @[];
	self.content.pendingTitle = @"";
	self.content.pendingMessage = @"";
	self.openButton.title = @"Open in PreBase";
	if (self.panel) {
		[self layoutControls:self.panel.frame];
	}
	[self.content updateShapeAndContentAnimated:YES duration:0.18 useTargetState:NO];
}

- (NSDictionary *)diagnosticsDict {
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
	dict[@"pinButtonTitle"] = self.pinButton.title ?: @"";
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
	dict[@"redrawCount"] = @(self.redrawCount);
	dict[@"animationCount"] = @(self.animationCount);
	NSTimeInterval now = [NSDate timeIntervalSinceReferenceDate];
	if (self.transitionInFlight && now >= self.transitionEndTime) {
		self.transitionInFlight = NO;
	}
	dict[@"transitionInFlight"] = @(self.transitionInFlight);
	dict[@"transitionGeneration"] = @(self.transitionGeneration);
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
	[self performUserHaptic];
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
	[self layoutForScreen];
}

- (void)updatePinButtonState {
	if (self.pinned) {
		self.pinButton.title = @"Unpin";
		self.pinButton.accessibilityLabel = @"Unpin panel";
		self.pinButton.state = NSControlStateValueOn;
	} else {
		self.pinButton.title = @"Pin";
		self.pinButton.accessibilityLabel = @"Pin panel";
		self.pinButton.state = NSControlStateValueOff;
	}
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
	BOOL screenLocked = [snapshot[@"screenLocked"] boolValue];
	self.screenLocked = screenLocked;
	if (screenLocked) {
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
		}
		return;
	}

	self.sessionId = snapshot[@"sessionId"] ?: @"";
	self.sessionResource = snapshot[@"sessionResource"] ?: @"";
	self.revision = [snapshot[@"revision"] doubleValue];
	self.screenLocked = [snapshot[@"screenLocked"] boolValue];
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
	NSString *label = snapshot[@"presentationLabel"];
	if (!label.length) {
		label = snapshot[@"currentActivity"] ?: snapshot[@"taskTitle"] ?: @"Magnus";
	}
	self.content.statusLabel = label;
	self.content.activityLabel = snapshot[@"currentActivity"] ?: @"";
	self.content.actions = snapshot[@"recentActions"] ?: @[];
	self.content.metricsLabel = snapshot[@"metricsLabel"] ?: @"";
	self.content.pendingTitle = snapshot[@"pendingTitle"] ?: @"";
	self.content.pendingMessage = snapshot[@"pendingMessage"] ?: @"";
	self.content.latestMessage = snapshot[@"latestShortMessage"] ?: @"";
	self.interactionId = snapshot[@"interactionId"] ?: @"";
	self.pendingKind = snapshot[@"pendingKind"] ?: @"";
	self.pendingDestructive = [snapshot[@"destructive"] boolValue];
	self.pendingOptions = snapshot[@"pendingOptions"] ?: @[];
	self.lastNativeCommand = @"";

	const BOOL alreadyInteractive = self.pinned
		|| (self.content.expanded && !self.content.peekOnly && !self.attentionPeek);
	// Lock / hidden: never expand peek from a snapshot republish (privacy + race with presentation).
	const BOOL mayExpand = self.visible && !self.screenLocked;

	if (self.content.attention) {
		if (alreadyInteractive && mayExpand) {
			// Attention while Interactive/pinned: preserve Interactive; update content only.
			self.userDismissedAttention = NO;
			self.attentionPeek = NO;
			self.content.peekOnly = NO;
			self.content.expanded = YES;
			self.content.targetExpanded = YES;
			self.ignoresMouse = NO;
			if (self.panel) {
				self.panel.ignoresMouseEvents = NO;
				[self layoutForScreen];
			}
		} else if (!self.pinned && self.userDismissedAttention) {
			// Escape/collapse while attention: lasting compact until click (do not republish into peek).
			self.attentionPeek = NO;
			self.content.peekOnly = NO;
			self.content.expanded = NO;
			self.content.targetExpanded = NO;
			self.ignoresMouse = YES;
			if (self.panel) {
				self.panel.ignoresMouseEvents = YES;
				[self layoutForScreen];
			}
		} else if (!self.pinned && mayExpand) {
			// Glanceable attention peek: compact wings + short body, clickable to expand.
			// Attention arrival is not user-initiated; do not haptic (Apple AppKit guidance).
			self.attentionPeek = YES;
			self.content.peekOnly = YES;
			self.content.expanded = YES;
			self.content.targetExpanded = YES;
			self.ignoresMouse = NO;
			self.didAttentionHaptic = NO;
			if (self.panel) {
				self.panel.ignoresMouseEvents = NO;
				[self layoutForScreen];
			}
		} else if (!mayExpand) {
			self.attentionPeek = NO;
			self.content.peekOnly = NO;
			self.content.expanded = NO;
			self.content.targetExpanded = NO;
			self.ignoresMouse = YES;
			if (self.panel) {
				self.panel.ignoresMouseEvents = YES;
				[self layoutForScreen];
			}
		}
	} else {
		self.userDismissedAttention = NO;
		BOOL wasAttentionPeek = self.attentionPeek;
		self.attentionPeek = NO;
		if (wasAttentionPeek && !self.pinned && !self.hovering && !alreadyInteractive) {
			self.content.peekOnly = NO;
			[self collapse];
		} else if (!self.pinned && !alreadyInteractive) {
			self.content.peekOnly = NO;
			self.content.targetExpanded = self.content.expanded;
		}
	}
	[self.content updateShapeAndContentAnimated:YES duration:0.18 useTargetState:YES];
	if (self.panel) {
		[self layoutControls:self.panel.frame];
	}
	// Snapshot lock must hide immediately even if presentation update races behind.
	if (self.screenLocked && self.panel) {
		[self.panel orderOut:nil];
		self.panel.ignoresMouseEvents = YES;
		self.visible = NO;
	}
}

- (void)setVisible:(BOOL)visible pinned:(BOOL)pinned reduced:(BOOL)reduced {
	// Screen lock is a hard hide — never orderFront while locked even if JS races visible:true.
	if (self.screenLocked) {
		visible = NO;
	}
	const BOOL wasPinned = self.pinned;
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
		// Keep legitimate peek/attention/hover expansion; never invent Interactive from visibility alone.
		const BOOL peekSurface = self.hovering || self.attentionPeek || self.content.peekOnly;
		if (self.content.expanded && !peekSurface) {
			self.content.expanded = NO;
			self.content.peekOnly = NO;
			self.attentionPeek = NO;
			[self removeLocalKeyMonitor];
		} else {
			self.content.expanded = self.content.expanded && peekSurface;
		}
	}
	self.content.targetExpanded = self.content.expanded;
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
	[self layoutForScreen];
	[self.panel orderFrontRegardless];
	if (!self.pinned && !self.content.expanded) {
		self.panel.ignoresMouseEvents = YES;
	}
}

- (void)teardown {
	[[NSNotificationCenter defaultCenter] removeObserver:self];
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
				[actions addObject:JSString(item.As<Napi::Object>().Get("label"))];
			}
		}
	}
	payload[@"recentActions"] = actions;

	NSMutableArray *metricParts = [NSMutableArray array];
	if (snapshot.Get("workspaceDiff").IsObject()) {
		Napi::Object diff = snapshot.Get("workspaceDiff").As<Napi::Object>();
		bool hasAdd = diff.Get("additions").IsNumber();
		bool hasDel = diff.Get("deletions").IsNumber();
		if (hasAdd || hasDel) {
			double additions = hasAdd ? diff.Get("additions").As<Napi::Number>().DoubleValue() : 0;
			double deletions = hasDel ? diff.Get("deletions").As<Napi::Number>().DoubleValue() : 0;
			[metricParts addObject:[NSString stringWithFormat:@"+%.0f −%.0f", additions, deletions]];
		}
		if (diff.Get("files").IsNumber()) {
			double files = diff.Get("files").As<Napi::Number>().DoubleValue();
			if (files > 0) {
				[metricParts addObject:[NSString stringWithFormat:@"%.0f file%s", files, files == 1 ? "" : "s"]];
			}
		}
	}
	if (snapshot.Get("terminalCount").IsNumber()) {
		double terminals = snapshot.Get("terminalCount").As<Napi::Number>().DoubleValue();
		if (terminals > 0) {
			[metricParts addObject:[NSString stringWithFormat:@"%.0f task%s", terminals, terminals == 1 ? "" : "s"]];
		}
	}
	NSString *testState = JSString(snapshot.Get("testState"));
	if (testState.length) {
		[metricParts addObject:[NSString stringWithFormat:@"tests %@", testState]];
	}
	payload[@"metricsLabel"] = [metricParts componentsJoinedByString:@" · "];

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
		payload[@"interactionId"] = @"";
		payload[@"pendingKind"] = @"";
		payload[@"pendingTitle"] = @"";
		payload[@"pendingMessage"] = @"";
		payload[@"pendingOptions"] = @[];
	}
	return payload;
}

static Napi::Value DictToJs(Napi::Env env, id value) {
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

