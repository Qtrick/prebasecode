# Runtime and CDP hardening — 2026-08-13

## Scope and baseline

Started on `main` at `0fd9aa5b`; the worktree was clean. Application icon
integrity was rechecked and no icon source or manifest was changed.

## Findings fixed

- **Runtime iframe message forgery:** the Runtime wrapper accepted every
  `window.message`; a preview iframe could send a matching control shape to its
  parent. A per-webview, host-only random channel now gates all controls and
  the wrapper repeats HTTP(S) validation before assigning `iframe.src`.
- **Unbounded Runtime inspection:** `asTextOrError` buffered the complete
  response before a character slice. Inspection now rejects oversized declared
  bodies and incrementally reads at most 512 KiB, cancels/destroys on overflow
  or cancellation, then supplies only a semantic outline.
- **Probe lifecycle and redirects:** reachability probes now destroy response
  streams and do not follow redirects, preventing local preview detection from
  becoming redirect-based private-network probing.
- **Hidden webview retention:** Runtime no longer retains its webview context
  while hidden. URL/viewport/session metadata remains in the Runtime service;
  the owned desktop process is not stopped by hiding the editor.
- **CDP pressure:** inbound protocol frames are capped at 1 MiB, requests are
  capped at 64 in flight, and oversized/malformed data rejects and releases all
  pending operations. Desktop evaluation input is limited to 64 KiB and IPC
  results to 1 MiB.

## Evidence and residual risk

The focused emitted suite has 22 passing tests: Runtime bounded reader (6),
webview protocol (4), URL policy (4), and CDP connection (8). The strict
privileged lint gate passes 28 files with zero diagnostics. No GUI memory/FPS
measurement is claimed: the isolated launch workflow needs a stable running
workbench session for that evidence.

VS Code documents webviews as resource-heavy and automatically restorable when
hidden; this supports releasing the Runtime context while retaining service
state. Electron security guidance also supports minimizing renderer exposure.
References: [VS Code Webviews](https://code.visualstudio.com/api/extension-guides/webview),
[Electron Security](https://www.electronjs.org/docs/latest/tutorial/security),
and [Electron Performance](https://www.electronjs.org/docs/latest/tutorial/performance).

## Deferred work

Redirect/DNS policy needs an integration-level resolver before distinguishing
private address classes safely. External-desktop screenshot/log lifecycle,
process-group termination verification, full Runtime GUI profiling, and
Magnus capability semantics remain open.
