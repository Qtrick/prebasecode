# TypeScript editor verification (Phase F)

Research date: **2026-07-20**

This checklist documents what was **automated** during the TypeScript 7 dual-lane migration versus what still **needs manual verification** in the running PreBase IDE. It does **not** claim full language-service parity with upstream VS Code until those items are checked in-product.

## Fixture workspace

Open as a folder workspace:

`test/fixtures/typescript-lanes/`

See [`test/fixtures/typescript-lanes/README.md`](../test/fixtures/typescript-lanes/README.md) for file purposes.

## Automated (CLI / build — 2026-07-20)

| Check | Command | Result |
|---|---|---|
| Dual lanes | `npm run verify:typescript` | Pass — `tsc` 7.0.2, compat API 6.0.3, `tsc6` 6.0.3 |
| Workbench typecheck | `npm run typecheck-client` | Pass |
| Graph package (core) | `npm run typecheck:graphs` | Pass |
| Fixture project (TS7 CLI) | `npx tsc -p test/fixtures/typescript-lanes/tsconfig.json --noEmit` | Expected **fail** — TS2322/TS2345 on `errors.ts` |
| Magnus extension compile | `npm run compile-magnus` | Pass (0 errors) |
| Built-in TS extension compile | `npm run gulp -- compile-extension:typescript-language-features` | Pass (0 errors) |
| TS extension web typecheck | `cd extensions/typescript-language-features && npm run typecheck-web` | Pass |
| Gulp TS7 stream wiring | `build/lib/typescriptCompiler.ts` spawns `npx tsc` | Code review + magnus/TS ext compile above |

## Needs verification (manual in PreBase)

Perform with the fixture workspace (or a real project). Record date and build ID when closing items.

| Area | Steps | Status |
|---|---|---|
| Workspace TS version | Command palette → TypeScript: Select TypeScript Version; note bundled vs workspace | Needs Verification |
| Diagnostics | Open `src/errors.ts`; confirm squiggle on `broken` assignment | Needs Verification |
| Go to definition | From `errors.ts`, jump to `greet` in `hello.ts` | Needs Verification |
| JS checkJs | Open `src/js-check.js`; confirm JS diagnostics when `checkJs` enabled | Needs Verification |
| Format / organize imports | Format document + organize imports on `hello.ts` | Needs Verification |
| Rename / refactor | Rename `greet` and confirm references update | Needs Verification |
| Native TS 7 LSP (optional) | If `typescriptteam.native-preview` / TS 7 LSP extension enabled, repeat diagnostics + navigation | Needs Verification |

## Out of scope for this doc

- Copilot `extensions/copilot/.../serverPlugin` API tests (separate subtree; uses compat `typescript` API).
- Full `compile-extensions` matrix (tracked as BETA-029).
- Claiming TS7 language service matches TS6 for every edge case without product smoke.

## References

- [`docs/TYPESCRIPT_7_MIGRATION.md`](TYPESCRIPT_7_MIGRATION.md)
- [`docs/TECHNOLOGY_VERSIONS.md`](TECHNOLOGY_VERSIONS.md)
- [`docs/BETA_READINESS.md`](BETA_READINESS.md) — BETA-008, BETA-009, BETA-029
