# Contributing to PreBase

Thanks for helping improve PreBase. PreBase is an AI-assisted desktop IDE and
code-visualization product built on the Code - OSS workbench. Contributions
should improve PreBase without reintroducing Microsoft-only services, telemetry,
or branding.

## Questions and feedback

- Use [GitHub Discussions](https://github.com/Qtrick/prebasecode/discussions)
  for questions, ideas, and design feedback.
- Use [GitHub Issues](https://github.com/Qtrick/prebasecode/issues) for
  reproducible bugs and scoped feature requests.
- Do not use public issues for security vulnerabilities; follow
  [SECURITY.md](SECURITY.md) instead.

Before opening an issue, search existing issues and discussions. For a bug,
include the PreBase version or commit, operating system and architecture,
reproduction steps, expected and actual behavior, relevant logs, and screenshots
or recordings when the problem is visual. Do not attach credentials, tokens,
private source, or personally identifiable information.

## Development setup

1. Fork and clone this repository, then create a focused branch.
2. Install the repository's supported Node and npm versions described in
   [TECHNOLOGY_VERSIONS.md](docs/TECHNOLOGY_VERSIONS.md).
3. Install dependencies with `npm install`.
4. Build or watch the workbench with `npm run watch`, then launch with
   `./scripts/code.sh`.

PreBase-specific architecture and validation requirements are documented in
[AGENTS.md](AGENTS.md), [the project instructions](.github/copilot-instructions.md),
and [ASSURANCE.md](docs/ASSURANCE.md). In particular:

- Keep graph implementation under `graphs/`; run `npm run verify:graphs-boundary`
  for graph work.
- Do not modify application, Dock, or installer icons without explicit product
  authorization; run `npm run verify:icons`.
- Keep telemetry, crash reporting, surveys, and Microsoft Marketplace routing
  disabled. PreBase uses Open VSX for extensions.
- Preserve workspace trust, secret-storage, path-containment, confirmation, and
  cancellation boundaries when working on Agents or Runtime Preview.

## Pull requests

Keep each pull request narrowly scoped and explain the user-visible outcome.
Include:

- The problem and root cause.
- The tests and validation commands you ran, including results.
- Screenshots or manual acceptance evidence for visual work.
- Any compatibility, security, performance, or accessibility implications.

Do not commit generated `out/` artifacts, credentials, personal profiles, or
unrelated formatting changes. Do not replace PreBase configuration wholesale
with upstream Code - OSS files. Upstream-derived code should retain applicable
license and copyright notices.

## Validation expectations

Run the smallest relevant checks first. TypeScript changes under `src/` require
`npm run typecheck-client`; graph changes normally require `npm run typecheck:graphs`
and `npm run test:graphs`. Run `npm run assurance` when the changed surface is
covered by the assurance suite. See [ASSURANCE.md](docs/ASSURANCE.md) for what
each command does and does not prove.

## Product boundaries

PreBase is a distinct product, not a Microsoft distribution. Contributions must
not re-enable Microsoft telemetry, crash upload, surveys, Copilot dependencies,
Hosted Magnus, or Visual Studio Marketplace endpoints. Where PreBase retains
Code - OSS components, treat them as upstream implementation dependencies and
keep PreBase product behavior, documentation, and release infrastructure under
PreBase ownership.

## Thank you

Thoughtful reports, reviews, tests, documentation, and code all make PreBase
more reliable and safer to use.
