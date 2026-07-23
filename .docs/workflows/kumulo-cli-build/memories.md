# Memories — Kumulo CLI Build

## T0.1 — Bun workspaces skeleton

**Pinned versions (all via a single Bun catalog in root `package.json` →
`workspaces.catalog`; every package references `"catalog:"`, no version
literals elsewhere):**

- `effect` `4.0.0-beta.101` (latest beta at time of writing; `@effect/platform-bun`,
  `@effect/openapi-generator`, `@effect/vitest` all publish in lockstep with the
  same beta number — confirmed all four exist at `.101`)
- `@effect/platform-bun` `4.0.0-beta.101`
- `@effect/openapi-generator` `4.0.0-beta.101`
- `@effect/vitest` `4.0.0-beta.101` — **available**, no fallback to plain vitest
  needed. Re-exports all of `vitest` plus `it.effect`, `it.live`, `it.prop`
  (property tests), `layer`, etc.
- `vitest` `4.1.10`
- `fast-check` `4.9.0` — effect v4 itself vendors fast-check as a direct dep
  and re-exports it at `effect/testing/FastCheck`; added explicitly to core's
  devDependencies anyway so it's a first-class, visible project dependency.
- `typescript` `7.0.2` — **TypeScript v7 is now stable** (native/Go port,
  formerly `@typescript/native-preview`). Mid-task the preview package was
  replaced with plain `typescript@7.0.2`, which ships the `tsc` binary as the
  native compiler directly — no separate `tsgo` binary needed anymore.
- `@effect/tsgo` `0.24.3` — Effect's language-service patch for the native
  TypeScript backend (`effect-tsgo patch`). This only affects editor/IDE
  diagnostics (patches `tsc` in-place to add Effect-specific hints); it is
  *not* required for `tsc --noEmit` to work and is not wired into CI. Ran
  `bunx effect-tsgo patch` once locally to verify it works against the
  installed `typescript@7.0.2` backend (`--typescript-package` only needed
  if the backend isn't named `typescript`/`@typescript/native`).

## Import paths (Effect v4 beta, single-package)

- `effect/Schema`, `effect/testing/FastCheck`, `effect/testing` (barrel with
  `FastCheck`, `TestClock`, `TestConsole`), `effect/unstable/cli`,
  `effect/unstable/httpapi` — confirmed against `.references/effect` (v4
  source tree; read-only, never modified/committed).
- `@effect/vitest` test helpers: `it.effect(name, () => Effect.gen(...))`,
  `it.live`, `it.prop(name, [arb1, arb2], predicate)` for property tests.

## Gotchas

- `bun install` on a fresh bun-init project leaves `index.ts`/`package.json`/
  `tsconfig.json`/`README.md` at root — replaced/absorbed per T0.1 (root
  `package.json` now holds workspaces+catalog+scripts, `tsconfig.json` just
  extends `tsconfig.base.json` with an empty `files` array as an IDE anchor).
- Root `typecheck` script is a plain bash loop
  (`for d in packages/* tools/*; do (cd "$d" && ../../node_modules/.bin/tsc --noEmit); done`)
  rather than TS project references/composite build — simplest thing that
  works for 10 flat packages; revisit only if compile time becomes a problem.
- vitest config (`vitest.config.ts`) globs `packages/*/test/**/*.test.ts` and
  `tools/*/test/**/*.test.ts` — running `vitest run` with zero test files
  present exits non-zero (confirmed as the T0.1 TDD red state before any
  packages existed).
- Only `packages/core` pulls in `@effect/vitest`'s `it.prop` + `fast-check`
  for a real property test; other 8 packages/tools get a plain `it()`
  import-resolves smoke test (no Effect runtime needed yet).
- `packages/cli` is the only package depending on another workspace
  package so far (`@kumulo/core` via `workspace:*`), proving Bun workspace
  linking + cross-package typecheck, per plan's "prove workspace linking
  compiles" instruction. All other cross-package deps arrive with their
  respective milestones.
- `.docs/` and `.references/` are both `.gitignore`d at the repo root by
  design; committing `.docs` changes requires `git add -f`.

## Result

`bun install` clean, `bun run ci` (typecheck × 10 packages + `vitest run`)
green: 10 test files / 11 tests passing.
