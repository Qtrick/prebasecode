#import <Cocoa/Cocoa.h>

int main(int argc, const char * argv[]) {
    @autoreleasepool {
        NSRunningApplication *front = [[NSWorkspace sharedWorkspace] frontmostApplication];
        NSLog(@"Frontmost app: %@ (pid: %d, bundle: %@)", front.localizedName, front.processIdentifier, front.bundleIdentifier);
        
        NSArray *screens = [NSScreen screens];
        for (NSScreen *s in screens) {
            NSLog(@"Screen: %@, frame: %@, visibleFrame: %@, safeAreaInsets: top=%.1f, left=%.1f, bottom=%.1f, right=%.1f",
                  s.localizedName,
                  NSStringFromRect(s.frame),
                  NSStringFromRect(s.visibleFrame),
                  s.safeAreaInsets.top, s.safeAreaInsets.left, s.safeAreaInsets.bottom, s.safeAreaInsets.right);
            
            // Check menu bar height:
            // When menu bar is visible, visibleFrame.origin.y + visibleFrame.size.height < frame.origin.y + frame.size.height
            CGFloat topDelta = (s.frame.origin.y + s.frame.size.height) - (s.visibleFrame.origin.y + s.visibleFrame.size.height);
            NSLog(@"Top delta (menu bar / top inset): %.1f", topDelta);
        }
        
        CFArrayRef windowList = CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID);
        if (windowList) {
            NSArray *windows = (__bridge NSArray *)windowList;
            NSLog(@"On-screen windows count: %lu", (unsigned long)windows.count);
            for (NSDictionary *w in windows) {
                NSNumber *layer = w[(id)kCGWindowLayer];
                NSString *owner = w[(id)kCGWindowOwnerName];
                CGRect bounds;
                CGRectMakeWithDictionaryRepresentation((CFDictionaryRef)w[(id)kCGWindowBounds], &bounds);
                if (layer.intValue >= 0 && bounds.size.width > 500) {
                    NSLog(@"  Window: owner=%@, layer=%@, bounds=%@", owner, layer, NSStringFromRect(NSRectFromCGRect(bounds)));
                }
            }
            CFRelease(windowList);
        }
    }
    return 0;
}
