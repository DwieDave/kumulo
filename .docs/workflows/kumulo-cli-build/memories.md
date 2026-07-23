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

## T0.2 — Dependency-direction lint (dependency-cruiser)

- `dependency-cruiser@18.1.0` added to the root catalog (exact-pinned), config
  in `.dependency-cruiser.cjs`, wired as `bun run lint:deps` and appended to
  `ci` (`typecheck && test && lint:deps`).
- **Gotcha:** dependency-cruiser 18.1's bundled TS-compat check only accepts
  `typescript >=2.0.0 <7.0.0` for its own transpiler detection; our repo pins
  `typescript@7.0.2`, so without a fallback it silently parsed **0 modules**
  when scanning directories (single-file targets still worked, which is what
  makes this easy to miss). Fix: add `@swc/core` (pinned exact in the catalog,
  `1.15.46`) as a devDependency — dependency-cruiser detects it as a
  compatible transpiler and falls back to it for `.ts` parsing. No tsConfig
  option needed/used (the root `tsconfig.json` has `files: []`, which — if
  passed as `options.tsConfig` — also silently restricts the module graph to
  zero files; left `options.tsConfig` out entirely).
- Rule set encoded (4 `forbidden` rules matching design Appendix A):
  1. `core-only-imports-effect` — `packages/core/src/**` may only import
     `effect` (or its own `src/`); scoped to `src/` only so `core`'s own test
     files can still use `@effect/vitest`/`fast-check` as devDeps.
  2. `no-sibling-package-imports` — any non-core, non-cli `@kumulo/*` package
     may import `core` but never another sibling package. Implemented with a
     regex-capture + `pathNot: "^packages/$1/"` back-reference so a package
     importing its own files isn't flagged as a "sibling" violation.
  3. `ovh2openapi-no-kumulo-imports` — `tools/ovh2openapi` may import no
     `packages/*`.
  4. `no-deep-package-imports` — forbids importing another package's
     `src/*` file directly except the package-root `index.ts` (the declared
     export). Also needed a same-package capture/back-reference
     (`^(packages|tools)/([^/]+)/` → `pathNot: "^packages/$2/"`) — otherwise
     it flagged ordinary intra-package files importing each other (caught via
     the pre-existing unrelated `packages/oxlint` tooling package, which has
     `src/oxlint/index.ts` importing sibling `src/oxlint/rules/*.ts` files).
  5. `cli` package is exempt from rules 1/2 by construction (regex excludes
     `packages/cli/` from the "from" side of the sibling-import rule).
- TDD proof: temporarily added `import "@kumulo/cli"` to
  `packages/core/src/index.ts` → `lint:deps` failed with
  `error core-only-imports-effect: packages/core/src/index.ts → @kumulo/cli`
  (1 violation). Reverted → 0 violations, 33 modules/40 deps cruised, green.
- `bun run ci` full green after the fix (typecheck × packages, vitest 10
  files/11 tests, lint:deps 0 violations).

## T1.2 — Cluster config schema

- **Bun.YAML is not usable in core's src**: `globalThis.Bun` is `undefined`
  inside vitest's test workers even when the suite is launched via
  `bun run test` — vitest's own worker pool doesn't inherit the Bun runtime.
  Confirmed with a throwaway `typeof Bun` assertion test. So a YAML helper
  that only works when directly `bun -e`'d is untestable here; had to add the
  `yaml` npm package (`2.9.0`, already present transitively so version chosen
  to match) instead, wired through the root catalog + `packages/core`
  dependencies.
- That forced an out-of-ownership edit to `.dependency-cruiser.cjs`'s
  `core-only-imports-effect` rule (same precedent as T0.2's fix): widened the
  `to.pathNot` regex to also allow `yaml` — as a bare specifier, a top-level
  `node_modules/yaml/` resolution, and bun's nested
  `node_modules/.bun/yaml@<version>/node_modules/yaml/` cache path. Also had
  to explicitly allow the `effect/Schema` submodule import path (previously
  only bare `effect` and `@effect/*` were allowed) since `SchemaError` isn't
  re-exported off the `effect` barrel.
  **Gotcha:** dependency-cruiser rejects "unsafe" regexes (ReDoS guard) —
  a first attempt using `node_modules/(.*/)?(effect|@effect|yaml)/` was
  bailed out with "has an unsafe regular expression"; had to flatten to
  explicit alternatives with no nested unbounded quantifiers.
- Effect v4 Schema error channel: `Schema.decodeUnknownEffect`/`encodeEffect`
  fail with `SchemaError` (from `effect/Schema`, has `.issue: SchemaIssue.Issue`),
  not a bare `Issue` — easy to miss since the internal parser module *does*
  fail with `Issue` directly.
- Turning a `SchemaIssue.Issue` into `ConfigInvalid`'s pathed issues:
  `SchemaIssue.makeFormatterStandardSchemaV1()(issue).issues` gives
  `{ path, message }[]` matching `PathedIssue` almost exactly — only needed
  to unwrap StandardSchemaV1's optional `{ key }` path-segment objects back
  to plain `PropertyKey`s.
- `@effect/vitest`'s `it.prop(name, [arb1, arb2], (properties, ctx) => ...)`
  passes the generated values as **one array-shaped `properties` argument**
  (`[v1, v2]`), not spread positional args — destructure in the parameter
  list (`([v1, v2]) => ...`), confirmed from `@effect/vitest`'s
  `internal/internal.ts` source.
- Schema shape: full §5 YAML mirrored 1:1 (provider/distro/auth/network/
  api_server/ssh/masters/worker_pools incl. optional labels/taints/
  autoscaling/dns/volumes/addons/k3s passthrough). `masters.count` enforces
  "1 or odd" via `Schema.makeFilter`; CIDRs are format-only regex checks
  (`Schema.isPattern`), not real reachability/route validation. Autoscaling
  is schema-accepted only — no runtime enabled/distro rejection here, that's
  T1.3's cross-distro validation layer.
- `bun run ci` full green: typecheck × 11 packages, vitest 17 files/46 tests
  (7 new in `packages/core/test/config/`), lint:deps 0 violations, oxlint
  clean.

## T5.1 — Vendor OpenStack specs + allowlists

- **Source revision:** `gtema/openstack-openapi` is a live (not archived) repo
  at `github.com/gtema/openstack-openapi`, default branch `main`, OpenAPI 3.1
  specs under `/specs/<service>/`. Pinned commit
  `7bc4ee41e044e4f2f7dc09c8b1193cfc4bc8f8ad` (2025-02-20). Fetched via
  `raw.githubusercontent.com/gtema/openstack-openapi/<sha>/specs/...` — no git
  submodule, plain `curl` in `packages/openstack/scripts/update-specs.sh`
  (wired as root `specs:update:openstack`). Re-running the script re-fetches
  from the *same pinned SHA* (documented as deliberately not auto-tracking
  `main` — bump the SHA constant by hand to pick up upstream changes).
- **Vendored files** (`packages/openstack/specs/<service>/<version>.yaml`,
  picked the most detailed microversion-specific file over the generic
  `v2.yaml`/`v3.yaml` when both exist):
  - `keystone/v3.14.yaml` (492K, 121 paths)
  - `nova/v2.96.yaml` (1.5M, 131 paths)
  - `neutron/v2.yaml` (900K, 147 paths — Neutron ships one unversioned spec)
  - `glance/v2.16.yaml` (360K, 47 paths)
  - `cinder/v3.70.yaml` (688K, 199 paths)
  - `octavia/v2.yaml` (392K, 39 paths)
  All confirmed `openapi: 3.1.0`, parsed clean with PyYAML.
- **Nova microversion pin: `2.79`** — a conservative, widely-deployed
  microversion per design §4.3 ("2.79-era"); recorded in
  `allowlists/nova.json`'s `"microversion"` field as the documented decision.
  The vendored spec snapshot itself is `2.96` (latest at fetch time) — the
  pipeline's T5.2 patch/generate stage is responsible for pruning
  microversion-gated variants down to 2.79 and injecting
  `X-OpenStack-Nova-API-Version: 2.79` as a global request header; T5.1 only
  records the decision, doesn't implement the pruning.
- **Allowlists** (`packages/openstack/allowlists/<service>.json`, operationId
  arrays keyed off the actual vendored spec's `operationId` values — these
  specs use path-derived IDs like `servers/id:get`, not verb-prefixed
  `createServer`-style names):
  - keystone: 2 ops (issue token, get catalog)
  - nova: 16 ops (server CRUD+action, flavors list/detail, metadata, tags,
    server-groups CRUD for soft-anti-affinity per D8)
  - neutron: 34 ops (networks/subnets/routers/ports CRUD, router
    add/remove-interface, security-groups+rules CRUD, floating IPs)
  - glance: 2 ops (list/get images)
  - cinder: 1 op (list volume types — v1 only needs this per design)
  - octavia: 20 ops (loadbalancer/listener/pool/member CRUD + LB status)
  - **Total: 75 allowlisted operations** across 6 services.
- **Initial patches** (`packages/openstack/patches/<service>.patch.json5`):
  all 6 are empty RFC 6902 arrays (`[]`) with a `// why` comment — no upstream
  spec bugs identified yet against the allowlisted ops. Real corrections
  (type tightening, enum fixes, microversion pruning) are deferred to T5.2
  where fixture-replay tests will surface them against actual codegen
  output — writing speculative patches now would be guessing. `.json5`
  extension chosen (not `.json`) to allow the `// why` comment per design's
  "JSON5 in source, compiled to strict JSON" patch policy.
- `bun run lint:deps` confirmed green after adding these files (85 modules,
  188 deps, 0 violations) — no TS added in this task, spec/allowlist/patch
  files are pure data.
