# anti-slop (vendored)

- Source: https://github.com/dmmulroy/anti-slop
- Commit: 13909c9e07590f5a85d93c62712259fe14a883f7
- Upstream package version: 0.1.2

## Installed paths

- Plugin: `packages/oxlint/src/anti-slop` (copy of upstream `src/`)
- Tests: moved to `packages/oxlint/test/anti-slop` (same relative structure)

## Deviations from upstream

- Upstream `*.test.ts` files were relocated out of `src/` into `packages/oxlint/test/anti-slop`, with import paths updated.
- Tests run under vitest through `packages/oxlint/test/rule-tester.ts`, which wires `RuleTester.describe`/`it` to vitest and re-exports `RuleTester`.
- `require-readable-spacing-cli.test.ts` was rewritten as a vitest suite that spawns the workspace `oxlint` binary instead of `pnpm exec oxlint`.
- `shared/dictionary-types.ts`: `unsafeMembers[0]` became `unsafeMembers[0] ?? null` to satisfy `noUncheckedIndexedAccess`.

`vendor/eslint-stylistic` keeps its own LICENSE and UPSTREAM.md.
