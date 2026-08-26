# Phase 3.16 shutdown evidence

Measured 2026-08-26T18:44:35Z on darwin-arm64.

## Idle SIGTERM (this directory)

- Scenario: isolated `launch.sh` profile, Welcome page, auth overlay present, Magnus activation completed.
- Processes at request: see `idle-before.txt` (browser, GPU, network, renderer, two Node utility helpers, extension-host plugin helper).
- Action: `SIGTERM` to Electron main PID 94319.
- Quit latency: **0.536 s**.
- Remaining PreBase.app processes after deadline: **none**.
- Activity Monitor force-quit: not required.

## Not measured here

Load quit during Code Graph scan, Temporal ingestion, SQLite write, Magnus stream, Runtime Preview, or external desktop sessions. Those remain open GUI work.
