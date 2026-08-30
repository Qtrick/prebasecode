#include <napi.h>
#import <AppKit/AppKit.h>

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
@property (nonatomic, copy) NSArray<NSString *> *actions;
@property (nonatomic, copy) NSString *status;
@property (nonatomic, assign) BOOL expanded;
@property (nonatomic, assign) BOOL notched;
@property (nonatomic, assign) CGFloat housingWidth;
@property (nonatomic, assign) BOOL reducedMotion;
@property (nonatomic, assign) BOOL attention;
@property (nonatomic, weak) PrebaseLiveActivityController *controller;
@end

@interface PrebaseLiveActivityController : NSObject
@property (nonatomic, strong) NSPanel *panel;
@property (nonatomic, strong) PrebaseLiveActivityView *content;
@property (nonatomic, strong) NSTextField *input;
@property (nonatomic, strong) NSButton *openButton;
@property (nonatomic, strong) NSButton *approveButton;
@property (nonatomic, strong) NSButton *denyButton;
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
@property (nonatomic, strong) id globalMonitor;
@property (nonatomic, strong) id localMonitor;
@property (nonatomic, strong) NSTimer *hoverTimer;
@property (nonatomic, strong) NSTimer *exitTimer;
@property (nonatomic, assign) NSRect collapsedHit;
@property (nonatomic, copy) NSString *displayMode;
- (void)applySnapshotDict:(NSDictionary *)snapshot;
- (void)teardown;
- (void)mouseUp:(NSEvent *)event;
@end

@implementation PrebaseLiveActivityView
- (BOOL)isFlipped { return YES; }
- (BOOL)acceptsFirstMouse:(NSEvent *)event { return YES; }

- (void)drawRect:(NSRect)dirtyRect {
	NSRect bounds = self.bounds;
	NSColor *fill = self.attention
		? [NSColor colorWithCalibratedWhite:0.11 alpha:0.96]
		: [NSColor colorWithCalibratedWhite:0.07 alpha:0.94];
	NSColor *stroke = [NSColor colorWithCalibratedWhite:1.0 alpha:0.14];
	NSBezierPath *path = [NSBezierPath bezierPathWithRoundedRect:NSInsetRect(bounds, 0.5, 0.5) xRadius:14 yRadius:14];
	[fill setFill];
	[path fill];
	[stroke setStroke];
	path.lineWidth = 1.0;
	[path stroke];

	NSMutableDictionary *attrs = [@{
		NSFontAttributeName: [NSFont systemFontOfSize:11 weight:NSFontWeightMedium],
		NSForegroundColorAttributeName: [NSColor colorWithCalibratedWhite:0.92 alpha:1.0]
	} mutableCopy];
	NSString *label = self.statusLabel.length ? self.statusLabel : @"Magnus";
	NSSize size = [label sizeWithAttributes:attrs];
	NSPoint origin = NSMakePoint(14, MAX(6, (NSHeight(bounds) - size.height) / 2.0));
	if (self.expanded) {
		origin.y = 10;
	}
	[label drawAtPoint:origin withAttributes:attrs];

	if (self.expanded && self.activityLabel.length) {
		attrs[NSFontAttributeName] = [NSFont systemFontOfSize:11 weight:NSFontWeightRegular];
		attrs[NSForegroundColorAttributeName] = [NSColor colorWithCalibratedWhite:0.78 alpha:1.0];
		[self.activityLabel drawAtPoint:NSMakePoint(14, 32) withAttributes:attrs];
		CGFloat y = 52;
		attrs[NSFontAttributeName] = [NSFont systemFontOfSize:10 weight:NSFontWeightRegular];
		for (NSString *action in self.actions) {
			[action drawAtPoint:NSMakePoint(18, y) withAttributes:attrs];
			y += 16;
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
	}
	return self;
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
	self.panel.level = NSStatusWindowLevel;
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

	self.input = [[NSTextField alloc] initWithFrame:NSMakeRect(12, 0, 200, 22)];
	self.input.placeholderString = @"Message Magnus";
	self.input.font = [NSFont systemFontOfSize:12];
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
		if (screen.safeAreaInsets.top > 8) {
			builtin = screen;
			break;
		}
	}
	return builtin ?: [NSScreen mainScreen] ?: [NSScreen screens].firstObject;
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
	BOOL notched = insets.top > 8 && auxLeft.size.width > 40 && auxRight.size.width > 40;
	self.content.notched = notched;
	CGFloat collapsedH = 34;
	NSRect win;
	if (notched) {
		CGFloat housing = MAX(24, NSWidth(frame) - auxLeft.size.width - auxRight.size.width);
		self.content.housingWidth = housing;
		CGFloat leftW = 124;
		CGFloat rightW = 124;
		CGFloat y = NSMaxY(frame) - MAX(insets.top, collapsedH) - 1;
		if (self.content.expanded || self.pinned) {
			win = NSMakeRect(auxLeft.origin.x - leftW + NSMinX(frame), y - 168, leftW + housing + rightW, 200);
		} else {
			win = NSMakeRect(auxLeft.origin.x - leftW + NSMinX(frame), y, leftW + housing + rightW, MAX(insets.top, collapsedH));
		}
		self.collapsedHit = NSMakeRect(win.origin.x, y, leftW - 8, MAX(insets.top, collapsedH));
	} else {
		self.content.housingWidth = 0;
		CGFloat w = self.content.expanded || self.pinned ? 320 : 228;
		CGFloat h = self.content.expanded || self.pinned ? 196 : 30;
		win = NSMakeRect(NSMidX(frame) - w / 2.0, NSMaxY(frame) - h - 8, w, h);
		self.collapsedHit = win;
	}
	[self.panel setFrame:win display:YES animate:!self.reducedMotion && self.panel.isVisible];
	[self layoutControls:win];
}

- (void)layoutControls:(NSRect)win {
	BOOL showInput = self.pinned;
	self.input.hidden = !showInput;
	self.openButton.hidden = !(self.content.expanded || self.pinned);
	BOOL attention = [self.pendingKind isEqualToString:@"approval"];
	self.approveButton.hidden = !(attention && (self.content.expanded || self.pinned));
	self.denyButton.hidden = self.approveButton.hidden;
	CGFloat y = 12;
	if (showInput) {
		self.input.frame = NSMakeRect(12, y, NSWidth(win) - 24, 24);
		y += 30;
	}
	if (!self.openButton.hidden) {
		self.openButton.frame = NSMakeRect(NSWidth(win) - 132, y, 118, 22);
	}
	if (!self.approveButton.hidden) {
		self.denyButton.frame = NSMakeRect(12, y, 70, 22);
		self.approveButton.frame = NSMakeRect(88, y, 78, 22);
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
				[weakSelf expandPreview];
			}];
		}
	} else {
		[self.hoverTimer invalidate];
		self.hoverTimer = nil;
		self.hovering = NO;
		if (self.content.expanded) {
			__weak PrebaseLiveActivityController *weakSelf = self;
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
	[self emit:@"approve" extras:@{ @"interactionId": self.interactionId ?: @"" }];
}

- (void)deny:(id)sender {
	[self emit:@"deny" extras:@{ @"interactionId": self.interactionId ?: @"" }];
}

- (void)mouseUp:(NSEvent *)event {
	if (!self.pinned) {
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
	self.interactionId = snapshot[@"interactionId"] ?: @"";
	self.pendingKind = snapshot[@"pendingKind"] ?: @"";
	[self.content setNeedsDisplay:YES];
}

- (void)setVisible:(BOOL)visible pinned:(BOOL)pinned reduced:(BOOL)reduced {
	self.visible = visible;
	self.pinned = pinned;
	self.reducedMotion = reduced;
	self.content.reducedMotion = reduced;
	self.content.expanded = pinned || self.content.expanded;
	self.panel.animationBehavior = reduced ? NSWindowAnimationBehaviorNone : NSWindowAnimationBehaviorUtilityWindow;
	if (!visible) {
		[self.panel orderOut:nil];
		self.panel.ignoresMouseEvents = YES;
		[self.hoverTimer invalidate];
		[self.exitTimer invalidate];
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
	if (snapshot.Get("pendingInteraction").IsObject()) {
		Napi::Object pending = snapshot.Get("pendingInteraction").As<Napi::Object>();
		payload[@"interactionId"] = JSString(pending.Get("interactionId"));
		payload[@"pendingKind"] = JSString(pending.Get("kind"));
	} else {
		payload[@"interactionId"] = @"";
		payload[@"pendingKind"] = @"";
	}
	return payload;
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
	dispatch_sync(dispatch_get_main_queue(), ^{
		[gController teardown];
		gController = nil;
	});
	gDisposed = false;
	return info.Env().Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
	exports.Set("setSnapshot", Napi::Function::New(env, SetSnapshot));
	exports.Set("setPresentation", Napi::Function::New(env, SetPresentation));
	exports.Set("setCommandHandler", Napi::Function::New(env, SetCommandHandler));
	exports.Set("dispose", Napi::Function::New(env, DisposeNative));
	return exports;
}

NODE_API_MODULE(prebase_live_activity, Init)
