# PreBase Security Policy

## Reporting a vulnerability

Please do **not** report security vulnerabilities in public GitHub issues,
discussions, pull requests, logs, screenshots, or chat transcripts.

Use [GitHub's private vulnerability reporting flow for
PreBase](https://github.com/Qtrick/prebasecode/security/advisories/new). Include
a concise description, affected commit or release, reproduction steps or proof
of concept, impact, and any suggested mitigation. Do not include credentials,
access tokens, private keys, or unnecessary user data.

If private reporting is unavailable, do not disclose the vulnerability publicly;
contact a repository maintainer through GitHub and ask for a private reporting
channel.

## Scope

This policy covers PreBase-owned code and configuration in this repository,
including the desktop workbench, `graphs/`, `extensions/prebase-magnus/`, Runtime
Preview, Agents tool boundaries, build and release scripts, and PreBase-operated
cloud integrations.

Code inherited from Code - OSS may also be in scope when its behavior is exposed
by PreBase. Please report it to PreBase first when you can reproduce it in a
PreBase build; maintainers will coordinate any responsible upstream disclosure.

## What to expect

Maintainers will assess reports, request only the information needed to
reproduce them, and work toward a fix or mitigation. Do not assume a disclosure
timeline until one is agreed with the maintainers. Please give maintainers a
reasonable opportunity to investigate and release a fix before public
disclosure.

## Security priorities

High-priority reports include:

- Remote code execution, sandbox escape, or unsafe Electron configuration.
- Unauthorized workspace, filesystem, process, network, or credential access.
- Agents or Runtime Preview permission bypasses, including workspace-trust,
  path-containment, confirmation, or ownership failures.
- Exposure of secrets, session tokens, source code, or personal data.
- Supply-chain compromise, malicious extension routing, or update/signing flaws.

The current security and supply-chain posture, known limitations, and validation
work are documented in [docs/SECURITY_AND_SUPPLY_CHAIN.md](docs/SECURITY_AND_SUPPLY_CHAIN.md).
That document is not a substitute for private vulnerability reporting.
