#include <napi.h>
#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>
#import <QuartzCore/QuartzCore.h>

// Keep in sync with magnusLiveActivity.ts LIVE_ACTIVITY_* constants.
static const CGFloat kCollapsedHeight = 34;
static const CGFloat kWingWidthMin = 52;
static const CGFloat kWingWidthMax = 136;
static const CGFloat kPillWidth = 228;
static const CGFloat kPillHeight = 30;
static const CGFloat kNotchMinSafeTop = 8;
static const CGFloat kNotchMinAuxWidth = 40;
static const CGFloat kCameraHousingMin = 24;
static const CGFloat kWingCornerRadius = 10;
static const CGFloat kPillCornerRadius = 16;

static NSInteger LiveActivityWindowLevel(void) {
	// Borderless panels at normal status/menu levels are clamped below the notch band.
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
@property (nonatomic, copy) NSString *statusLabel;
@property (nonatomic, copy) NSString *activityLabel;
@property (nonatomic, copy) NSString *metricsLabel;
@property (nonatomic, copy) NSString *pendingTitle;
@property (nonatomic, copy) NSArray<NSString *> *actions;
@property (nonatomic, copy) NSString *status;
@property (nonatomic, assign) BOOL expanded;
@property (nonatomic, assign) BOOL notched;
@property (nonatomic, assign) CGFloat housingWidth;
@property (nonatomic, assign) CGFloat safeAreaTop;
@property (nonatomic, assign) CGFloat leftWingWidth;
@property (nonatomic, assign) CGFloat rightWingWidth;
@property (nonatomic, assign) BOOL reducedMotion;
@property (nonatomic, assign) BOOL attention;
@property (nonatomic, strong) NSTrackingArea *trackingArea;
@property (nonatomic, weak) PrebaseLiveActivityController *controller;
@end

@interface PrebaseLiveActivityController : NSObject
@property (nonatomic, strong) NSPanel *panel;
@property (nonatomic, strong) PrebaseLiveActivityView *content;
@property (nonatomic, strong) NSTextField *input;
@property (nonatomic, strong) NSButton *openButton;
@property (nonatomic, strong) NSButton *approveButton;
@property (nonatomic, strong) NSButton *denyButton;
@property (nonatomic, strong) NSMutableArray<NSButton *> *optionButtons;
@property (nonatomic, copy) NSArray<NSDictionary *> *pendingOptions;
@property (nonatomic, assign) BOOL visible;
@property (nonatomic, assign) BOOL pinned;
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
- (void)applySnapshotDict:(NSDictionary *)snapshot;
- (void)teardown;
- (void)mouseUp:(NSEvent *)event;
- (void)mouseEnteredInView:(NSEvent *)event;
- (void)mouseExitedFromView:(NSEvent *)event;
- (void)clearPendingInteraction;
- (NSDictionary *)diagnosticsDict;
- (void)performUserHaptic;
- (BOOL)simulateClickOptionIndex:(NSInteger)index;
- (BOOL)simulateClickApprove;
- (BOOL)simulateClickDeny;
- (BOOL)simulateSubmitFollowUp:(NSString *)text;
- (BOOL)simulateClickOpenInPrebase;
@end

@implementation PrebaseLiveActivityView

- (BOOL)isFlipped { return YES; }
- (BOOL)acceptsFirstMouse:(NSEvent *)event { return YES; }

- (void)updateTrackingAreas {
	[super updateTrackingAreas];
	if (self.trackingArea) {
		[self removeTrackingArea:self.trackingArea];
	}
	NSTrackingAreaOptions opts = NSTrackingMouseEnteredAndExited
		| NSTrackingMouseMoved
		| NSTrackingActiveAlways
		| NSTrackingInVisibleRect;
	self.trackingArea = [[NSTrackingArea alloc] initWithRect:self.bounds options:opts owner:self userInfo:nil];
	[self addTrackingArea:self.trackingArea];
}

- (void)mouseEntered:(NSEvent *)event {
	[self.controller mouseEnteredInView:event];
}

- (void)mouseMoved:(NSEvent *)event {
	[self.controller mouseEnteredInView:event];
}

- (void)mouseExited:(NSEvent *)event {
	[self.controller mouseExitedFromView:event];
}

- (NSBezierPath *)wingPathInRect:(NSRect)rect radius:(CGFloat)radius {
	CGFloat minX = NSMinX(rect);
	CGFloat maxX = NSMaxX(rect);
	CGFloat minY = NSMinY(rect);
	CGFloat maxY = NSMaxY(rect);
	NSBezierPath *path = [NSBezierPath bezierPath];
	[path moveToPoint:NSMakePoint(minX, minY)];
	[path lineToPoint:NSMakePoint(maxX, minY)];
	[path lineToPoint:NSMakePoint(maxX, maxY - radius)];
	[path appendBezierPathWithArcFromPoint:NSMakePoint(maxX, maxY)
	                               toPoint:NSMakePoint(maxX - radius, maxY)
	                                radius:radius];
	[path lineToPoint:NSMakePoint(minX + radius, maxY)];
	[path appendBezierPathWithArcFromPoint:NSMakePoint(minX, maxY)
	                               toPoint:NSMakePoint(minX, maxY - radius)
	                                radius:radius];
	[path closePath];
	return path;
}

- (void)drawRect:(NSRect)dirtyRect {
	NSRect bounds = self.bounds;
	CGFloat bandH = MAX(self.safeAreaTop, kCollapsedHeight);
	BOOL isExpanded = (bounds.size.height > bandH + 2.0);

	// Optical black fill: near-opaque to merge seamlessly with physical camera housing and prevent ghosting.
	NSColor *fill = self.attention
		? [NSColor colorWithCalibratedWhite:0.07 alpha:0.99]
		: [NSColor colorWithCalibratedWhite:0.035 alpha:0.99];

	if (self.notched) {
		CGFloat totalW = NSWidth(bounds);
		CGFloat currentH = NSHeight(bounds);
		CGFloat leftW = self.leftWingWidth > 0 ? self.leftWingWidth : kWingWidthMin;
		CGFloat rightW = self.rightWingWidth > 0 ? self.rightWingWidth : kWingWidthMin;
		CGFloat housing = self.housingWidth > 0 ? self.housingWidth : kCameraHousingMin;

		if (!isExpanded) {
			// Collapsed state: discrete left and right wings flanking the physical housing.
			NSRect leftWing = NSMakeRect(0, 0, leftW, currentH);
			NSRect rightWing = NSMakeRect(leftW + housing, 0, rightW, currentH);
			NSBezierPath *leftPath = [self wingPathInRect:leftWing radius:kWingCornerRadius];
			NSBezierPath *rightPath = [self wingPathInRect:rightWing radius:kWingCornerRadius];
			[fill setFill];
			[leftPath fill];
			[rightPath fill];
		} else {
			// Continuous unified notched Dynamic Island path: seamless shoulder connections and rounded bottom body.
			CGFloat bottomRadius = kPillCornerRadius;
			NSBezierPath *islandPath = [NSBezierPath bezierPath];
			[islandPath moveToPoint:NSMakePoint(0, 0)];
			[islandPath lineToPoint:NSMakePoint(leftW, 0)];
			[islandPath lineToPoint:NSMakePoint(leftW, bandH)];
			[islandPath lineToPoint:NSMakePoint(leftW + housing, bandH)];
			[islandPath lineToPoint:NSMakePoint(leftW + housing, 0)];
			[islandPath lineToPoint:NSMakePoint(totalW, 0)];
			[islandPath lineToPoint:NSMakePoint(totalW, currentH - bottomRadius)];
			[islandPath appendBezierPathWithArcFromPoint:NSMakePoint(totalW, currentH)
			                                     toPoint:NSMakePoint(totalW - bottomRadius, currentH)
			                                      radius:bottomRadius];
			[islandPath lineToPoint:NSMakePoint(bottomRadius, currentH)];
			[islandPath appendBezierPathWithArcFromPoint:NSMakePoint(0, currentH)
			                                     toPoint:NSMakePoint(0, currentH - bottomRadius)
			                                      radius:bottomRadius];
			[islandPath closePath];

			[fill setFill];
			[islandPath fill];
		}
	} else {
		// Pill mode (no-notch screen fallback).
		NSBezierPath *path = [NSBezierPath bezierPathWithRoundedRect:NSInsetRect(bounds, 0.5, 0.5)
		                                                     xRadius:kPillCornerRadius
		                                                     yRadius:kPillCornerRadius];
		[fill setFill];
		[path fill];
		NSColor *stroke = [NSColor colorWithCalibratedWhite:1.0 alpha:0.14];
		[stroke setStroke];
		path.lineWidth = 1.0;
		[path stroke];
	}

	if (!isExpanded) {
		// Collapsed typography: left wing label (e.g. status/elapsed), right wing metrics.
		NSMutableDictionary *attrs = [@{
			NSFontAttributeName: [NSFont systemFontOfSize:11 weight:NSFontWeightMedium],
			NSForegroundColorAttributeName: [NSColor colorWithCalibratedWhite:0.94 alpha:1.0]
		} mutableCopy];

		NSString *label = self.statusLabel.length ? self.statusLabel : @"Magnus";
		NSSize size = [label sizeWithAttributes:attrs];
		CGFloat labelX = 14;
		CGFloat maxLabelWidth = self.notched ? (self.leftWingWidth - 20) : (NSWidth(bounds) - 28);
		if (size.width > maxLabelWidth && maxLabelWidth > 20) {
			label = [[label substringToIndex:MIN(label.length, 16)] stringByAppendingString:@"…"];
			size = [label sizeWithAttributes:attrs];
		}
		NSPoint origin = NSMakePoint(labelX, MAX(6, (NSHeight(bounds) - size.height) / 2.0));
		[label drawAtPoint:origin withAttributes:attrs];

		if (self.notched && self.metricsLabel.length) {
			attrs[NSFontAttributeName] = [NSFont monospacedDigitSystemFontOfSize:10 weight:NSFontWeightRegular];
			attrs[NSForegroundColorAttributeName] = [NSColor colorWithCalibratedWhite:0.75 alpha:1.0];
			NSSize metricsSize = [self.metricsLabel sizeWithAttributes:attrs];
			CGFloat metricsX = self.leftWingWidth + self.housingWidth + MAX(10, self.rightWingWidth - metricsSize.width - 12);
			NSPoint metricsOrigin = NSMakePoint(metricsX, MAX(6, (NSHeight(bounds) - metricsSize.height) / 2.0));
			[self.metricsLabel drawAtPoint:metricsOrigin withAttributes:attrs];
		}
	} else {
		// Expanded Content Hierarchy: All interactive and readable elements start strictly BELOW the hardware band.
		CGFloat bodyY = bandH + 8;

		// 1. Header: Magnus branding + Status pill badge on trailing side.
		NSMutableDictionary *headerAttrs = [@{
			NSFontAttributeName: [NSFont systemFontOfSize:12 weight:NSFontWeightSemibold],
			NSForegroundColorAttributeName: [NSColor colorWithCalibratedWhite:0.96 alpha:1.0]
		} mutableCopy];
		[@"Magnus" drawAtPoint:NSMakePoint(16, bodyY) withAttributes:headerAttrs];

		NSString *statusText = self.attention ? @"Attention" : (self.status.length ? [self.status capitalizedString] : @"Working");
		NSColor *badgeColor = self.attention
			? [NSColor colorWithCalibratedRed:0.98 green:0.65 blue:0.18 alpha:0.9]
			: [NSColor colorWithCalibratedWhite:0.65 alpha:1.0];
		NSMutableDictionary *badgeAttrs = [@{
			NSFontAttributeName: [NSFont systemFontOfSize:10 weight:NSFontWeightMedium],
			NSForegroundColorAttributeName: badgeColor
		} mutableCopy];
		NSSize badgeSize = [statusText sizeWithAttributes:badgeAttrs];
		[statusText drawAtPoint:NSMakePoint(NSWidth(bounds) - badgeSize.width - 16, bodyY + 1) withAttributes:badgeAttrs];

		bodyY += 22;

		// 2. Current Activity description.
		if (self.activityLabel.length) {
			NSMutableDictionary *actAttrs = [@{
				NSFontAttributeName: [NSFont systemFontOfSize:11 weight:NSFontWeightMedium],
				NSForegroundColorAttributeName: [NSColor colorWithCalibratedWhite:0.88 alpha:1.0]
			} mutableCopy];
			[self.activityLabel drawAtPoint:NSMakePoint(16, bodyY) withAttributes:actAttrs];
			bodyY += 18;
		}

		// 3. Recent Observable Actions (up to 3 bullets).
		if (self.actions.count > 0) {
			NSMutableDictionary *actionAttrs = [@{
				NSFontAttributeName: [NSFont systemFontOfSize:10 weight:NSFontWeightRegular],
				NSForegroundColorAttributeName: [NSColor colorWithCalibratedWhite:0.72 alpha:1.0]
			} mutableCopy];
			NSInteger limit = MIN((NSInteger)self.actions.count, 3);
			for (NSInteger i = 0; i < limit; i++) {
				NSString *bulletAction = [NSString stringWithFormat:@"•  %@", self.actions[i]];
				[bulletAction drawAtPoint:NSMakePoint(18, bodyY) withAttributes:actionAttrs];
				bodyY += 15;
			}
		}

		// 4. Pending interaction title if present.
		if (self.pendingTitle.length) {
			bodyY += 2;
			NSMutableDictionary *pendingAttrs = [@{
				NSFontAttributeName: [NSFont systemFontOfSize:11 weight:NSFontWeightSemibold],
				NSForegroundColorAttributeName: [NSColor colorWithCalibratedWhite:0.95 alpha:1.0]
			} mutableCopy];
			[self.pendingTitle drawAtPoint:NSMakePoint(16, bodyY) withAttributes:pendingAttrs];
			bodyY += 18;
		}

		// 5. Metrics line (diff, tasks, elapsed).
		if (self.metricsLabel.length) {
			NSMutableDictionary *metricsAttrs = [@{
				NSFontAttributeName: [NSFont monospacedDigitSystemFontOfSize:10 weight:NSFontWeightRegular],
				NSForegroundColorAttributeName: [NSColor colorWithCalibratedWhite:0.62 alpha:1.0]
			} mutableCopy];
			[self.metricsLabel drawAtPoint:NSMakePoint(16, bodyY) withAttributes:metricsAttrs];
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
		[self buildPanel];
		[[NSNotificationCenter defaultCenter] addObserver:self
		                                         selector:@selector(screenParametersChanged:)
		                                             name:NSApplicationDidChangeScreenParametersNotification
		                                           object:nil];
	}
	return self;
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
	// Elevated window level to escape menu-bar clamp and connect physically to the notch.
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
	self.content.wantsLayer = YES;
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
	[self.content addSubview:self.input];

	self.openButton = [self makeButton:@"Open in PreBase" action:@selector(openInPrebase:)];
	self.approveButton = [self makeButton:@"Approve" action:@selector(approve:)];
	self.denyButton = [self makeButton:@"Deny" action:@selector(deny:)];
	self.approveButton.hidden = YES;
	self.denyButton.hidden = YES;
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
	[self.content addSubview:button];
	return button;
}

- (NSScreen *)targetScreen {
	if ([self.displayMode isEqualToString:@"active"]) {
		NSPoint p = [NSEvent mouseLocation];
		for (NSScreen *screen in [NSScreen screens]) {
			if (NSPointInRect(p, screen.frame)) {
				return screen;
			}
		}
		return [NSScreen mainScreen] ?: [NSScreen screens].firstObject;
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
	return MIN(kWingWidthMax, MAX(kWingWidthMin, textW + 28));
}

- (CGFloat)computeRightWingWidth {
	if (!self.content.metricsLabel.length) {
		return kWingWidthMin;
	}
	CGFloat textW = [self measureStringWidth:self.content.metricsLabel font:[NSFont monospacedDigitSystemFontOfSize:10 weight:NSFontWeightRegular]];
	return MIN(kWingWidthMax, MAX(kWingWidthMin, textW + 26));
}

- (CGFloat)computeTargetContentHeight:(CGFloat)bandH {
	BOOL expanded = self.content.expanded || self.pinned;
	if (!expanded) {
		return bandH;
	}
	// Content-aware expanded sizing:
	// Header (22) + Activity (18) + Actions (actions.count * 15) + Pending (18) + Metrics (16) + interactive controls padding.
	CGFloat h = bandH + 8; // Top padding below notch band
	h += 22; // Header
	if (self.content.activityLabel.length) {
		h += 18;
	}
	if (self.content.actions.count > 0) {
		h += MIN((NSInteger)self.content.actions.count, 3) * 15;
	}
	if (self.content.pendingTitle.length) {
		h += 20;
	}
	if (self.content.metricsLabel.length) {
		h += 18;
	}
	h += 10; // Spacing before controls

	BOOL hasOptions = ([self.pendingKind isEqualToString:@"question"] && self.pendingOptions.count > 0);
	BOOL hasApproval = [self.pendingKind isEqualToString:@"approval"];
	BOOL showInput = self.pinned;

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
	self.panel.level = LiveActivityWindowLevel();

	if (self.reducedMotion) {
		[self.panel setFrame:win display:YES animate:NO];
	} else {
		BOOL expanding = (win.size.height > self.panel.frame.size.height);
		[NSAnimationContext runAnimationGroup:^(NSAnimationContext *context) {
			context.duration = expanding ? 0.26 : 0.20;
			context.timingFunction = [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseInEaseOut];
			context.allowsImplicitAnimation = YES;
			[[self.panel animator] setFrame:win display:YES];
		} completionHandler:^{
			// Frame update complete
		}];
	}
	[self.content setNeedsDisplay:YES];
	[self layoutControls:win];
}

- (void)layoutControls:(NSRect)win {
	BOOL showInput = self.pinned;
	self.input.hidden = !showInput;
	self.openButton.hidden = !(self.content.expanded || self.pinned);
	BOOL approval = [self.pendingKind isEqualToString:@"approval"];
	BOOL question = [self.pendingKind isEqualToString:@"question"];
	BOOL showAttention = (self.content.expanded || self.pinned);
	self.approveButton.hidden = !(approval && showAttention);
	self.denyButton.hidden = self.approveButton.hidden;
	for (NSButton *button in self.optionButtons) {
		button.hidden = YES;
	}

	CGFloat bandH = MAX(self.content.safeAreaTop, kCollapsedHeight);
	if (win.size.height <= bandH + 2.0) {
		// Collapsed state: hide all interactive body controls.
		self.input.hidden = YES;
		self.openButton.hidden = YES;
		self.approveButton.hidden = YES;
		self.denyButton.hidden = YES;
		return;
	}

	CGFloat bottomY = win.size.height - 30;

	if (showInput) {
		self.input.frame = NSMakeRect(14, bottomY, NSWidth(win) - 146, 24);
		self.openButton.frame = NSMakeRect(NSWidth(win) - 128, bottomY, 114, 22);
		bottomY -= 30;
	} else {
		self.openButton.frame = NSMakeRect(NSWidth(win) - 128, bottomY, 114, 22);
	}

	if (!self.approveButton.hidden) {
		NSString *approveTitle = self.pendingDestructive ? @"Approve (destructive)" : @"Approve";
		self.approveButton.title = approveTitle;
		self.approveButton.accessibilityLabel = approveTitle;
		self.denyButton.frame = NSMakeRect(14, bottomY, 68, 22);
		self.approveButton.frame = NSMakeRect(86, bottomY, self.pendingDestructive ? 144 : 78, 22);
	}

	if (question && showAttention) {
		NSInteger count = MIN((NSInteger)self.pendingOptions.count, (NSInteger)self.optionButtons.count);
		CGFloat x = 14;
		for (NSInteger i = 0; i < count; i++) {
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
	}
}

- (void)performUserHaptic {
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
		NSPoint p = [NSEvent mouseLocation];
		NSScreen *screen = [strong targetScreen];
		if (screen && !NSPointInRect(p, screen.frame)) {
			// Pointer is on another display; ignore
			[strong pointerInside:NO];
			return;
		}
		BOOL inside = NSPointInRect(p, strong.collapsedHit) || (strong.content.expanded && NSPointInRect(p, strong.panel.frame));
		[strong pointerInside:inside];
	}];
	self.localMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskKeyDown handler:^NSEvent *(NSEvent *event) {
		PrebaseLiveActivityController *strong = weakSelf;
		if (!strong || gDisposed || event.keyCode != 53) {
			return event;
		}
		if (strong.pinned || strong.content.expanded) {
			strong.pinned = NO;
			[strong emit:@"unpin" extras:nil];
			[strong collapse];
			return nil;
		}
		return event;
	}];
}

- (void)removeMonitors {
	if (self.globalMonitor) {
		[NSEvent removeMonitor:self.globalMonitor];
		self.globalMonitor = nil;
	}
	if (self.localMonitor) {
		[NSEvent removeMonitor:self.localMonitor];
		self.localMonitor = nil;
	}
}

- (void)mouseEnteredInView:(NSEvent *)event {
	[self.exitTimer invalidate];
	self.exitTimer = nil;
}

- (void)mouseExitedFromView:(NSEvent *)event {
	if (self.pinned || !self.content.expanded) {
		return;
	}
	[self.exitTimer invalidate];
	__weak PrebaseLiveActivityController *weakSelf = self;
	self.exitTimer = [NSTimer scheduledTimerWithTimeInterval:0.10 repeats:NO block:^(NSTimer *timer) {
		[weakSelf collapse];
	}];
}

- (void)pointerInside:(BOOL)inside {
	if (self.pinned) {
		return;
	}
	if (inside) {
		[self.exitTimer invalidate];
		self.exitTimer = nil;
		if (!self.hovering) {
			self.hovering = YES;
			[self.hoverTimer invalidate];
			__weak PrebaseLiveActivityController *weakSelf = self;
			self.hoverTimer = [NSTimer scheduledTimerWithTimeInterval:0.15 repeats:NO block:^(NSTimer *timer) {
				[weakSelf performUserHaptic];
				[weakSelf expandPreview];
			}];
		}
	} else {
		[self.hoverTimer invalidate];
		self.hoverTimer = nil;
		self.hovering = NO;
		if (self.content.expanded) {
			__weak PrebaseLiveActivityController *weakSelf = self;
			[self.exitTimer invalidate];
			self.exitTimer = [NSTimer scheduledTimerWithTimeInterval:0.10 repeats:NO block:^(NSTimer *timer) {
				[weakSelf collapse];
			}];
		}
	}
}

- (void)expandPreview {
	if (!self.visible) {
		return;
	}
	self.content.expanded = YES;
	self.panel.ignoresMouseEvents = NO;
	self.ignoresMouse = NO;
	[self layoutForScreen];
	[self.content setNeedsDisplay:YES];
}

- (void)collapse {
	if (self.pinned) {
		return;
	}
	self.content.expanded = NO;
	self.panel.ignoresMouseEvents = YES;
	self.ignoresMouse = YES;
	self.input.hidden = YES;
	[self.panel makeFirstResponder:nil];
	[self layoutForScreen];
	[self.content setNeedsDisplay:YES];
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
	self.openButton.title = @"Open in PreBase";
	if (self.panel) {
		[self layoutControls:self.panel.frame];
	}
	[self.content setNeedsDisplay:YES];
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
	dict[@"pendingKind"] = self.pendingKind ?: @"";
	dict[@"interactionId"] = self.interactionId ?: @"";
	dict[@"approvalControlsVisible"] = @(!self.approveButton.hidden);
	dict[@"openInPreBaseVisible"] = @(!self.openButton.hidden);
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
	return dict;
}

- (BOOL)simulateClickOptionIndex:(NSInteger)index {
	if (index < 0 || index >= (NSInteger)self.optionButtons.count) {
		return NO;
	}
	NSButton *button = self.optionButtons[index];
	if (button.hidden) {
		return NO;
	}
	[self answerOption:button];
	return YES;
}

- (BOOL)simulateClickApprove {
	if (self.approveButton.hidden) {
		return NO;
	}
	[self approve:self.approveButton];
	return YES;
}

- (BOOL)simulateClickDeny {
	if (self.denyButton.hidden) {
		return NO;
	}
	[self deny:self.denyButton];
	return YES;
}

- (BOOL)simulateSubmitFollowUp:(NSString *)text {
	if (!text.length) {
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

- (void)mouseUp:(NSEvent *)event {
	if (!self.pinned) {
		[self performUserHaptic];
		self.pinned = YES;
		self.content.expanded = YES;
		self.panel.ignoresMouseEvents = NO;
		[self emit:@"pin" extras:nil];
		[self layoutForScreen];
		if (!self.input.hidden) {
			[self.panel makeKeyAndOrderFront:nil];
			[self.panel makeFirstResponder:self.input];
		}
	}
}

- (void)applySnapshotDict:(NSDictionary *)snapshot {
	self.sessionId = snapshot[@"sessionId"] ?: @"";
	self.sessionResource = snapshot[@"sessionResource"] ?: @"";
	self.revision = [snapshot[@"revision"] doubleValue];
	NSString *status = snapshot[@"status"] ?: @"";
	self.content.status = status;
	self.content.attention = [status isEqualToString:@"attention"];
	NSString *label = snapshot[@"presentationLabel"];
	if (!label.length) {
		label = snapshot[@"currentActivity"] ?: snapshot[@"taskTitle"] ?: @"Magnus";
	}
	self.content.statusLabel = label;
	self.content.activityLabel = snapshot[@"currentActivity"] ?: @"";
	self.content.actions = snapshot[@"recentActions"] ?: @[];
	self.content.metricsLabel = snapshot[@"metricsLabel"] ?: @"";
	self.content.pendingTitle = snapshot[@"pendingTitle"] ?: @"";
	self.interactionId = snapshot[@"interactionId"] ?: @"";
	self.pendingKind = snapshot[@"pendingKind"] ?: @"";
	self.pendingDestructive = [snapshot[@"destructive"] boolValue];
	self.pendingOptions = snapshot[@"pendingOptions"] ?: @[];
	self.lastNativeCommand = @"";
	if (self.content.attention && (self.pendingOptions.count > 0 || [self.pendingKind isEqualToString:@"approval"])) {
		self.content.expanded = YES;
		self.ignoresMouse = NO;
		if (self.panel) {
			self.panel.ignoresMouseEvents = NO;
			[self layoutForScreen];
		}
	}
	[self.content setNeedsDisplay:YES];
	if (self.panel) {
		[self layoutControls:self.panel.frame];
	}
}

- (void)setVisible:(BOOL)visible pinned:(BOOL)pinned reduced:(BOOL)reduced {
	self.visible = visible;
	self.pinned = pinned;
	self.reducedMotion = reduced;
	self.content.reducedMotion = reduced;
	self.content.expanded = pinned || (visible && self.content.expanded);
	self.panel.animationBehavior = reduced ? NSWindowAnimationBehaviorNone : NSWindowAnimationBehaviorUtilityWindow;
	if (!visible) {
		[self.panel orderOut:nil];
		self.panel.ignoresMouseEvents = YES;
		if (!pinned) {
			self.content.expanded = NO;
			self.hovering = NO;
		}
		[self.hoverTimer invalidate];
		self.hoverTimer = nil;
		[self.exitTimer invalidate];
		self.exitTimer = nil;
		[self removeMonitors];
		return;
	}
	[self installMonitor];
	[self layoutForScreen];
	[self.panel orderFrontRegardless];
	if (!self.pinned && !self.content.expanded) {
		self.panel.ignoresMouseEvents = YES;
	}
}

- (void)teardown {
	[[NSNotificationCenter defaultCenter] removeObserver:self
	                                                name:NSApplicationDidChangeScreenParametersNotification
	                                              object:nil];
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
		// Only surface destructive when explicitly true — never invent false.
		if (pending.Get("destructive").IsBoolean() && pending.Get("destructive").As<Napi::Boolean>().Value()) {
			payload[@"destructive"] = @YES;
		}
		NSMutableArray *options = [NSMutableArray array];
		if (pending.Get("options").IsArray()) {
			Napi::Array arr = pending.Get("options").As<Napi::Array>();
			for (uint32_t i = 0; i < arr.Length() && options.count < 4; i++) {
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
	PrebaseLiveActivityController *controller = EnsureController();
	NSDictionary *diag = [controller diagnosticsDict];
	return DictToJs(env, diag);
}

static Napi::Value SimulateAction(const Napi::CallbackInfo &info) {
	Napi::Env env = info.Env();
	if (info.Length() < 1 || !info[0].IsString()) {
		return Napi::Boolean::New(env, false);
	}
	std::string action = info[0].As<Napi::String>().Utf8Value();
	PrebaseLiveActivityController *controller = EnsureController();
	if (action == "approve") {
		return Napi::Boolean::New(env, [controller simulateClickApprove]);
	}
	if (action == "deny") {
		return Napi::Boolean::New(env, [controller simulateClickDeny]);
	}
	if (action == "openInPrebase") {
		return Napi::Boolean::New(env, [controller simulateClickOpenInPrebase]);
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
	dispatch_async(dispatch_get_main_queue(), ^{
		[EnsureController() applySnapshotDict:payload];
	});
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
	dispatch_async(dispatch_get_main_queue(), ^{
		PrebaseLiveActivityController *controller = EnsureController();
		controller.displayMode = display;
		[controller setVisible:visible pinned:pinned reduced:reduced];
	});
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

Napi::Object Init(Napi::Env env, Napi::Object exports) {
	exports.Set("setSnapshot", Napi::Function::New(env, SetSnapshot));
	exports.Set("setPresentation", Napi::Function::New(env, SetPresentation));
	exports.Set("setCommandHandler", Napi::Function::New(env, SetCommandHandler));
	exports.Set("getDiagnostics", Napi::Function::New(env, GetDiagnostics));
	exports.Set("simulateAction", Napi::Function::New(env, SimulateAction));
	exports.Set("dispose", Napi::Function::New(env, DisposeNative));
	return exports;
}

NODE_API_MODULE(prebase_live_activity, Init)
