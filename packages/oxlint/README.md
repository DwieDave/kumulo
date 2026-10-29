# @kumulo/oxlint

Private workspace package holding kumulo's oxlint JS plugins. It is not published; `.oxlintrc.json` loads the plugins from source.

- `src/oxlint`: the `kumulo/*` rules (Effect and workspace conventions).
- `src/anti-slop`: the `anti-slop/*` rules, vendored from [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop). See `src/anti-slop/UPSTREAM.md` for the pinned commit and local deviations.

Tests live in `test/` (`test/kumulo`, `test/anti-slop`) and run under the root vitest config using oxlint's `RuleTester` via `test/rule-tester.ts`.

See the [root README](../../README.md) for the project overview.
