# TypeScript lanes manual verification fixture

Minimal workspace for **manual** PreBase editor / language-service checks documented in
[`docs/TYPESCRIPT_EDITOR_VERIFICATION.md`](../../../docs/TYPESCRIPT_EDITOR_VERIFICATION.md).

Open this folder as a workspace root (or add it to a multi-root workspace). Do not use it in CI as a product gate.

## Layout

| File | Purpose |
|---|---|
| `tsconfig.json` | Strict TS project for workspace version picker |
| `src/hello.ts` | Clean types, imports, go-to-definition |
| `src/errors.ts` | Intentional type error for diagnostics |
| `src/js-check.js` | Plain JS with JSDoc for checkJs behavior |

## Automated checks (repo root)

- `npm run verify:typescript` — dual compiler lanes (TS7 `tsc` + TS6 API / `tsc6`)
- `npx tsc -p test/fixtures/typescript-lanes/tsconfig.json --noEmit` — primary CLI on this fixture (from repo root; expect errors from `errors.ts`)
