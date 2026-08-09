# PreBase macOS Adaptive Icon Source

Canonical artwork (byte-frozen, never redesign here):

- `resources/prebase/prebase-dock-liquid-glass-1024.png`

Adaptive packaging source (Icon Composer `.icon` package):

- `PreBase.icon/icon.json` — Liquid Glass layer metadata
- `PreBase.icon/Assets/mark.png` — deterministic derivation of the frozen PNG with near-black pixels made transparent so system fills can provide the tile

Compiled `Assets.car` is produced at build/package time by `build/lib/prebaseDarwinIcon.ts` (not committed).

Asset catalog name used by `actool --app-icon`: **`PreBase`**
(matches gulp-electron `CFBundleIconName` / `productName`)

Legacy fallback remains `resources/darwin/code.icns` → `PreBase.icns` in the bundle.
