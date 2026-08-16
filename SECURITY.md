# PreBase Security Policy & Incident Escalation

This document outlines security procedures, vulnerability handling, and internal incident response for PreBase engineers, contractors, and agents.

---

## 1. Internal Security Incident Response (Employees & Contractors)

If you discover a security vulnerability, credential leak, tool boundary bypass, or potential supply-chain compromise:

1. **Stop public disclosure:** Do not discuss the vulnerability or post reproduction steps, tokens, logs, or screenshots in public issues, pull requests, or unencrypted chat.
2. **Immediate escalation:** Immediately escalate through the team's designated private security/engineering incident channel. If no dedicated channel is configured, create a private repository security advisory or contact the engineering lead through an approved private channel.
3. **Credential containment:** If a credential (API key, Supabase service token, signing key) was exposed, immediately rotate or revoke it at the provider source.
4. **Assessment & patching:**
   - Establish affected versions, platforms, and commit ranges.
   - Develop a minimal, focused patch and add regression verification (e.g. `npm run verify:privacy`, `npm run verify:supabase-secrets`).
   - Coordinate release and disclosure strictly through authorized engineering leadership.

---

## 2. Security Priorities & Critical Boundaries

High-priority incident categories:
- **Sandbox & Electron Security:** Remote code execution, context isolation bypass, nodeIntegration misuse.
- **Agents & Tool Boundaries:** File containment escapes, path traversal outside workspace, arbitrary command execution without required user approval.
- **Credential Storage:** Secrets or session tokens leaked to disk, unencrypted storage, or transmitted to unauthorized endpoints.
- **Supply-Chain & Extension Routing:** Unverified dependencies, non-allowlisted network endpoints, or routing extensions outside Open VSX.
- **Workspace Privacy:** Telemetry/analytics leakage or automatic uploading of workspace files and secrets.

---

## 3. External Vulnerability Reporting

External researchers should report vulnerabilities via [GitHub's private vulnerability reporting flow for PreBase](https://github.com/Qtrick/prebasecode/security/advisories/new).

Include affected version/commit, minimal reproduction steps, and impact assessment. Do not include sensitive user data or live credentials.

