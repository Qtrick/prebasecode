# macOS Adaptive Icon Research (PreBase)

Date: 2026-08-09  
Host: macOS (darwin), Xcode **26.6** (17F113), `actool` short-bundle-version **26.6** (bundle 24765)

## Apple docs / tooling consulted

- [App Icons HIG](https://developer.apple.com/design/human-interface-guidelines/app-icons)
- [Icon Composer](https://developer.apple.com/icon-composer/)
- [Creating your app icon using Icon Composer](https://developer.apple.com/documentation/xcode/creating-your-app-icon-using-icon-composer)
- [Configuring app icon using an asset catalog](https://developer.apple.com/documentation/xcode/configuring-your-app-icon)
- [CFBundleIcons / CFBundleIconName](https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundleicons)
- WWDC25 sessions 361 / 220 (Liquid Glass / Icon Composer)
- Local: `man actool`, `xcrun actool --version`, Icon Composer.app under Xcode

## Installed tools

| Tool | Result |
|------|--------|
| `xcodebuild -version` | Xcode 26.6 / Build 17F113 |
| `xcrun --find actool` | `/Applications/Xcode.app/Contents/Developer/usr/bin/actool` |
| `actool` version | 26.6 |
| `assetutil` | `/usr/bin/assetutil` |
| Icon Composer | Present in Xcode Applications |

## Supported inputs (confirmed)

1. **Icon Composer `.icon` package** (preferred for Liquid Glass / Icon & Widget Style)
2. Legacy **`.xcassets` AppIcon.appiconset** (produces Assets.car bitmap icons; not true Liquid Glass stack)
3. Legacy **`.icns`** fallback for older macOS

Confirmed `actool` flags used by PreBase:

```text
xcrun actool <Name>.icon
  --compile <outDir>
  --output-format human-readable-text
  --notices --warnings --errors
  --output-partial-info-plist <partial.plist>
  --app-icon <Name>
  --include-all-app-icons
  --enable-on-demand-resources NO
  --development-region en
  --target-device mac
  --minimum-deployment-target 26.0
  --platform macosx
```

Partial Info.plist emits `CFBundleIconName` / `CFBundleIconFile` matching `--app-icon`.

## Chosen PreBase architecture

| Piece | Choice |
|-------|--------|
| Artwork | Frozen `resources/prebase/prebase-dock-liquid-glass-1024.png` (unchanged bytes) |
| Adaptive source | `resources/darwin/adaptive/PreBase.icon/` (`icon.json` + derived transparent `Assets/mark.png`) |
| Catalog name | **`PreBase`** (matches gulp-electron `CFBundleIconName` = productName) |
| Compile helper | `build/lib/prebaseDarwinIcon.ts` (argv-safe `spawn`, no shell) |
| Output | `.build/darwin/adaptive/Assets.car` (generated, not committed) |
| Packaging | `darwinAssetsCar` in `build/lib/electron.ts`; gulp task `compile-darwin-adaptive-icon` before package |
| Dev sync | `preLaunch` / `npm run electron` → fail-closed bundle identity `com.prebase.ide` + executable `PreBase` |
| Legacy | Keep `resources/darwin/code.icns` → `PreBase.icns` + `CFBundleIconFile` |
| Verifier | `npm run verify:macos-adaptive-icon` |

## Rejected alternatives

| Alternative | Reason |
|-------------|--------|
| Runtime `dock.setIcon` / AppKit override | Defeats system adaptive Icon & Widget Style; forbidden by product policy |
| xcassets-only PNG AppIcon | Compiles Assets.car but does **not** produce Liquid Glass icon stack metadata |
| Commit only Assets.car without `.icon` | Loses editable source; PreBase compiles at build time instead |
| `--app-icon Icon` while gulp-electron sets `PreBase` | Name mismatch; Dock would ignore adaptive catalog |
| Mutating icons after codesign | Invalidates signature |
| Redesigning monogram / editing frozen PNG | Explicitly out of scope |

## Minimum deployment target

Adaptive compile uses **26.0** so actool emits Liquid Glass stacks. Legacy `.icns` remains for older macOS. Windows/Linux icons untouched.
