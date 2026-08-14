# PreBase beta acceptance evidence

- Run: `2026-08-14T17-47-21Z-bd413b6-darwin-arm64`
- Branch / SHA: `main` / `bd413b673cb9b609dbb4d286a889e130e977f812`
- Platform: macOS arm64
- Started: 2026-08-14T17:47:21Z

The machine-readable scenario manifest is [`summary.json`](./summary.json). Evidence is sanitized: it must not contain credentials, cookies, prompts, provider keys, or request bodies.

| Scenario | Status | Evidence |
|---|---|---|
| Initial icon-integrity gate | PASS | `npm run verify:icons` — 101/101 hashes matched |
| Core IDE fresh profile | PASS | PreBase auth gate, offline flow, and onboarding rendered without Copilot UI; see `launch/fresh-profile.md` |
| PreBase auth card theme inheritance | PASS | Real source GUI: opaque `#1b1c1e` backdrop and `#303030` card; see `screenshots/auth-card-final.png` |
| PreBase branded auth backdrop | PASS | Real workspace GUI: GitHub/Google marks, translucent theme backdrop, `blur(6px)`, and 160 ms dismissal; see `screenshots/auth-card-branded-blur.png` |
