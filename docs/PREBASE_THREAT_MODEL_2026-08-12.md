# PreBase Threat Model — 2026-08-12

## Assets and boundaries

Protected assets include user source code, filesystem and Git credentials,
terminal/environment values, provider and Supabase tokens, runtime processes,
network access, and packaged application integrity.

The high-value trust boundaries are: workbench renderer ↔ main process;
workbench ↔ extension host; Magnus ↔ model tools; PreBase ↔ workspace process;
Runtime Preview ↔ previewed application; PreBase ↔ Supabase ↔ LinkUp; packaged
application ↔ local filesystem; and build pipeline ↔ npm dependencies.

## Threat actors and controls

| Actor | Relevant attack | Current control / status |
| --- | --- | --- |
| Malicious workspace or prompt-injected source | Cause agent edits, terminal actions, or unbounded preview output | Workspace tools require containment/trust/approval; Runtime evidence is now bounded. Remaining agent-flow GUI verification is open. |
| Malicious preview website | Escape into Electron, navigate externally, or inflate retained evidence | Runtime URL parser allows only HTTP(S); external URLs require approval unless explicitly configured; desktop automation is disabled by default; evidence bounds fixed. Iframe capability and redirect/private-network policy still need adversarial GUI tests. |
| Malicious extension/web frame | Invoke privileged Electron IPC | Electron guidance requires sender validation; this pass did not mass-rewrite upstream IPC. PreBase-specific IPC inventory and sender tests remain open. |
| Malicious model tool input | Bypass destructive confirmation | **SEC-001 fixed:** termination force input removed; confirmation-aware kill is mandatory. |
| Noisy or malicious runtime process | Memory/context denial of service | **SEC-002 fixed:** bounded evidence ring semantics with dropped-count reporting. |
| Compromised dependency/package | Known vulnerable dependency or package tampering | Existing audit history remains documented; current audit refresh is blocked by registry-metadata policy. Package/native smoke, signing, and ASAR/fuse compatibility matrix remain open. |
| Search result / LinkUp content | Prompt injection or provider-key exposure | Gateway keeps LinkUp key server-side; content is untrusted and labeled. Live deployment and signed-in tool-loop verification remain open. |

## Residual risk

This document records a current code pass, not a security certification.
Highest remaining work is Runtime/CDP adversarial lifecycle testing, Electron
packaging/fuse compatibility evidence, live privacy-network observation, RLS
two-user tests, and approved dependency-audit refresh.
