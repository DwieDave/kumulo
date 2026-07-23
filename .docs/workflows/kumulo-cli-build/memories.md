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

## T3.2 — ovh2openapi deterministic converter

- Converter input is typed via plain TS interfaces (`src/domain.ts`) matching
  only the OVH schema fields actually consumed — no `effect/Schema` decode of
  the input. Vendored/fixture JSON is trusted (checked into the repo, not
  user input), so the trust-boundary argument for runtime validation doesn't
  apply here; `JSON.parse` returns `any` in TS, so assigning its result to an
  `OvhSchema`-typed local needs **no** `as` cast either (avoids
  `kumulo/no-type-assertion`).
- Effect v4 beta gotchas hit during this task:
  - `Effect.reduce`'s second parameter (`zero`) is a **`LazyArg`** (a thunk
    `() => Z`), not a bare value — `Effect.reduce(xs, {} as X, fn)` fails
    typecheck two ways at once (widens to `unknown` *and* rejects the object
    literal as not matching `LazyArg`). Fix: `Effect.reduce(xs, (): X => ({}), fn)`.
  - There is **no `Either` module and no `FastCheck` export** off the bare
    `effect` barrel in this v4 beta. `Effect.either` doesn't exist either.
    Use `Effect.flip(effect)` + `Effect.runSync` to pull a known error value
    out of a pure Effect in tests instead. `FastCheck` is only reachable via
    `effect/testing/FastCheck` (confirms the T0.1 memory's import-path note).
- `kumulo/no-multiple-function-params` (oxlint custom rule) only flags
  **exported** functions — private `_`-prefixed helpers with 2+ params
  (`_toOpenApiParam(param, models)` etc.) passed lint untouched, but the
  public API (`typeToSchema`, `modelToSchema`, `operationToOpenApi`) had to
  take a single destructured object arg.
- Determinism is structural, not enforced by a stable-stringify helper:
  `Object.keys(...).toSorted()` on `models`/`properties`/`apis` before
  building output objects is sufficient for byte-identical JSON.stringify
  reruns on the same input (no `Date`/`Math.random`/nondeterministic Map
  iteration anywhere in the pipeline) — proved by an `it.prop` test generating
  random small OVH-schema-shaped models via `fast-check`.
- `responseType: "void"` is handled as a bodyless 200 response (no fixture
  exercises this yet, but OVH's real schemas have void endpoints).
- Files: `tools/ovh2openapi/src/{domain,errors,openapi,convert,index}.ts`,
  `tools/ovh2openapi/test/{convert,determinism}.test.ts` (old placeholder
  `smoke.test.ts` kept as-is — `packageName` export preserved in the barrel).
- `bun run ci` (scoped): typecheck clean, vitest 3 files/6 tests passing,
  `lint:deps` 0 violations (118 modules), oxlint clean for this package (root
  `bun run lint` still has pre-existing errors in `packages/openstack`,
  `packages/core`, `tools/codegen` — none of them mine, left untouched).

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

## T3.3 — Shared codegen pipeline stages (tools/codegen)

- `@effect/openapi-generator` (installed via bun's nested `node_modules/.bun`
  layout, confirmed at `tools/codegen/node_modules/@effect/`) exposes exactly
  the pieces this task needs, so the wrapper is thin:
  - `OpenApiPatch.applyPatches(patches, document)` — already fails loudly
    with a `JsonPatchAggregateError` listing every unapplicable operation
    (path/reason), so stage 2 is a near-direct passthrough.
  - `OpenApiGenerator.OpenApiGenerator` service (+ `layerTransformerSchema`
    for Schema-backed HttpApi/HttpClient output) — `generator.generate(spec,
    options)` returns the source string, warnings via an `onWarning`
    callback.
- **Type friction — `OpenAPISpec` vs `Schema.Json`:** `OpenAPISpec` (from
  `effect/unstable/httpapi/OpenApi`) is a plain interface with no index
  signature and inner fields typed as bare `object` (e.g.
  `OpenAPISpecParameter.schema`), so it is **not** structurally assignable to
  `Schema.Json` in either direction — not even via a type-guard predicate
  (`value is OpenAPISpec` on a `Schema.Json` parameter fails compilation:
  "type predicate's type must be assignable to its parameter's type").
  `kumulo`'s oxlint `no-type-assertion` rule (no `as`, anywhere) rules out
  the obvious fix. Resolution: type our own `applyPatches`
  wrapper's `document`/return as `unknown` (not `Schema.Json`), converting at
  the one call site into the library via
  `JSON.parse(JSON.stringify(document))` (produces a real `any`, assignable
  to `Schema.Json` without a cast) — then narrow `unknown` back to
  `OpenAPISpec` downstream with a genuine runtime type-guard function
  (`typeof value === "object" && "openapi" in value && "paths" in value`),
  which *does* type-check against an `unknown` parameter.
- `kumulo`'s `no-multiple-function-params` oxlint rule (single object param,
  named-args) applies repo-wide, including to this tool's exported stage
  functions — every stage takes one `args: { ... }` object
  (`filterAllowlist({ spec, allowlist })`,
  `applyPatches({ patches, document })`, `generateSource({ spec, options })`,
  `checkNoop({ committedPath, committed, regenerated })`). Calls into the
  *library's* own multi-arg functions (`OpenApiPatch.applyPatches(a, b)`,
  `generator.generate(a, b)`) are fine — the rule only governs functions we
  declare.
- Allowlist filter (stage 1) also fails loudly (`AllowlistOperationNotFound`)
  if an allowlist entry matches no operationId in the spec — a typo guard
  beyond what FR-4.1 strictly asks for, cheap to add, catches silently-empty
  generated clients early.
- Regen-noop check (stage 4, `checkNoop`) is a pure string-equality check
  reporting the first differing line number — deliberately not a real diff
  algorithm (`DriftDetected` conveys "look here", CI output/`git diff` on the
  committed file gives the rest). No FileSystem/Path effect layer added:
  `@effect/platform-bun` isn't installed/used anywhere in the repo yet, and
  this tool is a Bun-run script — `node:fs`'s `readFileSync` in
  `src/bin/check.ts` reads spec/allowlist/patch/committed files directly,
  keeping the stage functions themselves (`allowlist.ts`/`patch.ts`/
  `generate.ts`/`regenCheck.ts`) pure and unit-testable with in-memory
  synthetic fixtures (`test/fixtures.ts`), no I/O in the tested surface.
- `services.json` (root of `tools/codegen`) is an empty `[]` manifest for
  now — `codegen:check` (root script, wired into `bun run ci`) loops it and
  exits 0 instantly since no per-service pipeline configs exist yet; T3.4
  (OVH clients) and T5.2 (OpenStack clients) are expected to append entries
  (`{ name, specPath, allowlistPath, patchPaths, format, outputPath }`)
  rather than build their own regen-check plumbing.
- `bun run ci` full green through `lint:deps`/`lint`/`codegen:check`;
  `bun run typecheck` fails only in `packages/openstack` (missing `yaml`
  module resolution, unrelated to this task — another concurrent agent's
  in-progress package) — confirmed `tools/codegen`'s own `tsc --noEmit` is
  clean in isolation, and `bun run test` (whole repo) passes 98/98 across 36
  files, including this task's 5 files / 11 tests.

## T5.2 — Generated OpenStack clients

- **`bin/check.ts` had two latent bugs** (unexercised because `services.json`
  was `[]` until now): it `JSON.parse`'d the vendored **YAML** specs directly
  (always would've thrown `ENOENT`/parse errors), and it treated an
  allowlist file's whole `{ service, spec, operationIds }` object as the bare
  operationId array. Fixed both (`YAML.parse` for specs, `.operationIds` for
  allowlists, comment-stripped `JSON.parse` for the JSON5 patches) — this is
  shared T3.3 plumbing, not T5.2-owned, but nothing downstream could have
  worked without the fix. Added `yaml` (catalog) as a `tools/codegen`
  dependency for this.
- **`services.json` paths are relative to `tools/codegen/`, not the repo
  root** (`root = join(import.meta.dirname, "..", "..")` from
  `src/bin/check.ts`, i.e. two levels up from `src/bin` = `tools/codegen`)
  — every entry uses `../../packages/openstack/...`.
- **Real correctness bug found in T3.3's `filterAllowlist`**: it only pruned
  `spec.paths`, never `spec.components.schemas`. The generator's HttpApi path
  (`generator.generateHttpApi`) walks *all* of `spec.components.schemas`
  unconditionally, so even a 1-operation allowlist (Cinder's `types:get`)
  produced a client with every one of Cinder's ~25 unrelated schemas
  (`VolumesCreate_*`, `ServersAction_*`-style variants) — bloating output and,
  worse, some of those schemas don't even compile (see next point). Fixed by
  adding a `$ref`-reachability closure in `filterAllowlist` (BFS over
  `"#/components/schemas/X"` refs starting from the surviving paths, keeping
  only schemas transitively reachable) — TDD'd against a new synthetic
  fixture (`syntheticSpecWithSchemas`) with a reachable + unreachable schema.
  Cut generated output size roughly in half (Cinder 69→27 lines, Nova
  527→369).
- **Real TS-codegen bug found**: any OpenAPI schema mixing typed optional
  properties with a **non-`false` `additionalProperties`** (`{ type:
  "string" }`, or even bare `true`) makes `@effect/openapi-generator` emit
  TypeScript that doesn't compile — `readonly "foo"?: string, readonly [x:
  string]: string` is TS2411 (`"foo"?: string` includes `undefined`, which
  isn't assignable to a plain `string` index). Hit this in Glance's image
  "extra properties" and Nova's `scheduler_hints`/`OS-SCH-HNT:scheduler_hints`
  (additionalProperties: `true`). Fixed generically in `generateSource`
  (`generate.ts`): recursively force every non-`false` `additionalProperties`
  to `false` before handing the spec to the generator — justified by FR-4.6
  (lenient decode handles unknown/extra fields at the transport layer, so the
  schema itself doesn't need to type them). TDD'd with a new
  `syntheticSpecWithFreeformAdditionalProperties` fixture. This is a
  systemic fix, not a per-service patch — kept all 6 `*.patch.json5` files
  empty (T5.1's empty overlays turned out to need no real corrections).
- **oxlint on generated code**: `no-misleading-character-class` fired on
  Nova's Unicode-range regex patterns (upstream `container_format` validation
  copies a huge Unicode character-class straight from the spec, containing
  NFC combining sequences) and the `kumulo/*` custom rules (`no-comments`,
  `no-multiple-function-params`, etc.) don't make sense for machine-generated
  code either way. Added `packages/*/src/generated/**` to `.oxlintrc.json`'s
  root `ignorePatterns` (shared config file, touched out-of-ownership like
  T0.2/T1.2's precedent — necessary, no other way to exempt generated
  output).
- **Format choice: `"httpapi"`** (not `httpclient`) per design §4.2's "HttpApi
  definitions + HttpApiClient + Schema types + per-endpoint tagged errors" —
  confirmed this emits an `HttpApi.make(...)`-based class per service
  (`Keystone`, `Nova`, ... one `HttpApiGroup` per OpenAPI tag) with exported
  `Schema.Struct` types per request/response, which is what T5.3 (already
  landed concurrently) and later provider-wiring tasks consume.
  `HttpApiClient`/middleware wiring itself is **not** built in T5.2 — that's
  transport-layer (T5.3, which landed in parallel this session).
- **Nova microversion pruning turned out to be a non-issue at the spec
  level**: the vendored `gtema/openstack-openapi` Nova spec has zero
  microversion-conditional path/parameter variants (no
  `X-OpenStack-Nova-API-Version` header parameter anywhere in the doc) — it's
  a single merged document. The 2.79 pin (recorded in `allowlists/nova.json`
  since T5.1) is purely a transport-layer concern (send the header
  explicitly on every request), which is T5.3's territory, not a patch-stage
  concern.
- **Fixture-replay tests** (`packages/openstack/test/generated/*.test.ts`,
  one per service + a shared `decode.ts` helper): deliberately schema-decode
  tests (`Schema.decodeUnknownEffect` against a hand-written fixture), not
  full `HttpApiClient` + mocked-transport tests — T5.3 hadn't landed the
  transport layer when this task started, and per-endpoint middleware wiring
  for 6 different security schemes would be substantial scope creep beyond
  "prove the generated schemas decode/reject correctly." Each service has a
  happy-path decode + an "error-mapping" case (either a real non-empty error
  schema like Keystone's 401 `AuthReceiptSchema`, or a deliberately malformed
  fixture proving the schema's `additionalProperties`/enum/type constraints
  actually reject bad data instead of silently passing).
- **Op counts per service** (unchanged from T5.1's allowlists, all still
  reachable end-to-end through filter→patch→generate): keystone 2, nova 16,
  neutron 34, glance 2, cinder 1, octavia 20 — 75 total.
- `bun run ci` (repo-wide): `typecheck` (12 packages) clean, `test` 135/135
  across 46 files, `lint:deps` 0 violations (153 modules), `codegen:check` —
  "6 service pipeline(s) clean". `lint` (oxlint) has 6 remaining errors, all
  in `packages/dns-ovh/scripts/generate.ts` and
  `packages/distro-ovh-mks/scripts/generate.ts` — other concurrent agents'
  in-progress work, not touched by this task.

## T3.4 — OVH MKS + DNS clients and OAuth2 auth layer

- **Trimming happens *before* `convert`, not after** (unlike the OpenStack
  pipeline's post-conversion operationId filter): the vendored `cloud.json` is
  2.6MB covering OVH's entire Cloud API, and running it whole through
  `tools/ovh2openapi`'s `convert` hits `ConversionUnsupported` on constructs
  used by unrelated (non-MKS) routes. Each package's `scripts/generate.ts`
  trims the raw OVH schema itself first — allowlist.json's `{path, method}`
  pairs select `apis`, then a transitive model-reference closure (regex-walk
  every property's `fullType` string) prunes `models` down to only what's
  reachable — *then* calls `convert`, then reuses `tools/codegen`'s
  `applyPatches`/`generateSource` stages unchanged. Two near-identical
  `scripts/generate.ts` (distro-ovh-mks, dns-ovh) — not shared into a tool,
  only two call sites and each needed a different patch-file name/allowlist
  shape; not worth a shared abstraction (YAGNI).
- **`allowlist.json` shape differs from the OpenStack one on purpose**: OVH's
  `cloud.json` operations carry no `operationId` field at all (only
  `domain.json` does, e.g. `getRecords`/`createRecord`) — so allowlisting by
  `operationId` isn't possible pre-conversion. Used `{ path, method }` pairs
  instead (matched against the OVH schema's own `api.path`/`op.httpMethod`),
  plus a `spec` field pointing at the vendored schema path. `@effect/openapi-generator`
  auto-derives stable operationIds from path+method when the source spec
  lacks one (`getCloudProjectServiceNameKube`, etc.) — confirmed in the
  generated output, so nothing downstream needed real OVH operationIds.
- **Converter gaps found and fixed** (extended `tools/ovh2openapi/src/convert.ts`'s
  primitive-type match, out of this task's nominal ownership but blocking —
  same precedent as T0.2/T1.2's shared-file exceptions): OVH's `uuid`,
  `duration`, `datetime`, `password`, `ipv4Block` scalar `fullType`s now map to
  `{ type: "string", format: "..." }`; OVH's `map[K]V` generic (e.g.
  `map[string]string` for pool labels/annotations) now maps to
  `{ type: "object", additionalProperties: <V schema> }` (new
  `OpenApiSchema` union member added to `openapi.ts`). All four covered by
  new cases in `tools/ovh2openapi/test/convert.test.ts` (TDD: written failing
  first, confirmed red, then implemented).
- **Op counts**: MKS 13 ops / 7 paths / 44 models (kube list/get/create/
  update/delete, kubeconfig fetch+reset, cluster force-update, nodepool
  list/get/create/update/delete); DNS 6 ops / 3 paths / 4 models (zone record
  get/list/create/update/delete, zone refresh).
- **OvhAuth placement — deviated from the task brief's preferred placement**
  (`OvhAuth` port in `packages/core/src/ports`, impl in `provider-ovh`):
  `packages/core/src/index.ts` is explicitly off-limits to this task (owned
  by the integration/barrel-wiring step per orchestration rules), and
  dependency-cruiser's `no-deep-package-imports` rule only allows
  cross-package imports through a package's root `index.ts` — so a core-side
  port would've been unreachable from `provider-ovh` without editing that
  barrel. Kept `OvhAuth` (the port, `Context.Service`) and `OvhAuthLive` (the
  impl) together in `packages/provider-ovh/src/auth/{port,live}.ts` instead;
  confirmed `bun run lint:deps` green. Documented the reasoning inline in
  `port.ts` too.
- **`ovhHttpClientLayer`** (`provider-ovh/src/auth/client.ts`) wraps a base
  `HttpClient.HttpClient` with Bearer injection (reads `OvhAuth.token` per
  request via `HttpClient.mapRequestEffect`) + `HttpClientRequest.prependUrl`
  (OVH API v1 base `https://eu.api.ovh.com/1.0`). A token-fetch
  `AuthenticationFailed` occurring mid-request has to be converted to an
  `HttpClientError` (wrapped as a `TransportError`, cause carries the
  original tagged error) — the plain `HttpClient.HttpClient` interface fixes
  its error channel to `HttpClientError` structurally, so a Layer providing
  that exact tag can't leak a different error type through `mapRequestEffect`.
- **Composition root, not consumed here**: `distro-ovh-mks`/`dns-ovh` do
  *not* import `@kumulo/provider-ovh` — dependency-cruiser's
  `no-sibling-package-imports` rule forbids non-core packages depending on
  each other. Each package's `src/client/{mks,dns}.ts` is a thin re-export of
  the generated `make`/interface types, taking a plain `HttpClient.HttpClient`
  value. Wiring `OvhAuthLive` + `ovhHttpClientLayer` (provider-ovh) together
  with `makeMksClient`/`makeDnsClient` (this task's packages) is the CLI's
  job (T4.2 composition root).
- **`OvhAuthLive` token cache**: `Ref`-backed, expiry-skew (60s) check-and-
  refetch on every `.token` access — no proactive background-refresh fiber
  (design's "refresh Schedule" language read as retry-on-failure, not
  proactive prefetch; simplest thing that satisfies FR-4.6, revisit if a
  real prefetch requirement shows up). The token-endpoint call itself is
  wrapped in `Effect.retry` with `Schedule.exponential("200 millis").pipe(
  Schedule.jittered, Schedule.upTo({ times: 3 }))` (FR-4.6's exp-backoff +
  jitter). **Gotcha**: `Schedule.min([exponential, Schedule.recurs(n)])`
  looked like the right combinator for "bounded exponential backoff" but
  hung forever under real retry — `Schedule.upTo({ times: n })` is the
  correct/simpler API for that.
- **`it.effect` vs `it.live` in tests**: the retry-schedule test (real
  `Effect.sleep` between attempts) hangs forever under `it.effect` — its
  virtual `TestClock` never advances on its own. Had to use `it.live` (real
  time) for that one test; the cache-hit tests (deterministic, all fixtures
  return `200` synchronously, no sleeps) work fine under `it.effect`.
- **Fixture-replay tests need an absolute base URL**: `HttpClient.make(f)`'s
  internal wiring parses `request.url` into a real `URL` *before* invoking
  `f` — a bare relative path like `/cloud/project/x/kube` throws
  `Invalid URL` at that parse step, never reaching the test's fixture
  handler. Fix: wrap the fixture transport with
  `HttpClient.mapRequest(HttpClientRequest.prependUrl("https://fixture.invalid"))`
  before `HttpClient.make`, mirroring what `ovhHttpClientLayer` does for real
  traffic.
- `bun run ci` full green: typecheck (12 packages), `vitest run` 156/156
  across 51 files (mine: 4 new files / 15 tests — 3 auth, 5 MKS client, 4 DNS
  client, 3 new ovh2openapi convert cases — plus untouched pre-existing
  suites), `lint:deps` 0 violations, oxlint clean (fixed the 6
  `no-type-assertion` errors T5.2's memory entry flagged in my in-progress
  `scripts/generate.ts` files — `JSON.parse` into an explicitly-typed
  `const` needs no `as`, same trick as T3.2/T3.3), `codegen:check` unaffected
  (services.json is T5.2's OpenStack manifest; these two packages regenerate
  via their own standalone `scripts/generate.ts`, not wired into
  `tools/codegen`'s regen-noop gate — could be added later if drift-on-CI
  matters for OVH too, deferred as YAGNI for now).

## T6.1 — OpenStack CloudProvider implementation

- Went with **raw REST calls** over the KeystoneAuth-authenticated
  `HttpClient` (`src/provider/rest.ts`'s `restRequest`) rather than wiring the
  full generated `HttpApi`/`HttpApiClient` typed clients (T5.2/T5.3) — lenient
  `unknown`-body decode (FR-4.6) already means the provider only ever reads a
  handful of fields per response (`id`/`name`/`status`/`vip_address`/
  `addresses`), so the generated Schema types would add real ceremony (per-op
  `HttpApiClient.make` config, security-scheme wiring for 5 services) for no
  behavioral gain here — this is a ponytail call, not a design decision;
  revisit if a later task needs strict response validation.
- **Domain types (`packages/core/src/domain/types.ts`) are single-instance,
  not per-call**: `NetworkSpec`/`SecGroupSpec`/`LbSpec` carry no cluster tag
  or name (confirmed by the existing `FakeCloudProviderLive`'s comment) — the
  cluster tag/region/capabilities are `CloudProviderOptions`, a
  layer-construction-time closure (`CloudProviderLive(options)`), not
  threaded per-call. All OpenStack resource names are deterministic:
  `kumulo-<tag>` (network/security-group/LB), `kumulo-<tag>-masters` /
  `kumulo-<tag>-workers` (server groups) — this is what makes every `ensure*`
  idempotent-by-name without a richer port.
- **FR-5.7 rules travel through `SecGroupSpec.rules: ReadonlyArray<unknown>`**
  by design (that field exists for exactly this) — decoded via a
  `SecurityGroupRuleInput` `effect/Schema` union
  (`src/provider/security-group-rules.ts`) at the `ensureSecurityGroups`
  trust boundary. The FR-5.7 rule *list itself* (ssh/api/intra-net/etcd/
  wireguard/icmp) is built by a separate pure, directly-unit-tested function
  `buildFr57Rules(...)` — callers (a later distro-k3s/CLI wiring task) call it
  to populate `SecGroupSpec.rules` before invoking the port; `ensureSecurityGroups`
  itself stays a generic decode-and-apply translator, so it doesn't need
  changes if FR-5.7's exact rule set evolves.
- **D8 anti-affinity is masters-vs-workers only, not per worker-pool**
  (`ensureServerGroups(role)` — `ServerSpec.role: "master" | "worker"` has no
  pool id) — marked with a `ponytail:` comment as the ceiling; needs
  `ServerSpec` to grow a `pool` field to go further, which is a core/domain
  change outside this task's ownership.
- **`ensureServerGroups` is not part of the `CloudProvider` port** (the
  interface has no such method, and `packages/core` is out of ownership) —
  exported as a standalone function from `@kumulo/openstack`'s provider
  module and called internally by `ensureServer` before creating an instance.
  The reconcile pipeline's `"ServerGroups"` phase name
  (`packages/core/src/reconcile/phases.ts`) has no Effect wired to it yet by
  any task so far — leaving that wiring to whichever task builds the full
  phase-Effect list is consistent with this task's scope ("CloudProvider impl"
  only).
- **`HttpClientRequest`'s `URL`-vs-`string` overload matters for tests**:
  passing a `URL` object into `HttpClientRequest.get/post/...` makes `setUrl`
  strip the query string out of `.url` into a separate `.urlParams` field
  (confirmed in `effect/unstable/http/HttpClientRequest.ts`'s `setUrl`) — a
  fixture fake that reads `request.url` as a plain string (the natural thing
  to do) then sees no query at all. Fix: build the `URL` for parsing/joining
  purposes only, then call `.toString()` before handing it to
  `HttpClientRequest.get(...)` — keeps the query string in the plain
  `request.url` string field. `src/provider/rest.ts`'s `restRequest` does
  this; `test/provider/fake-openstack.ts` is the fixture-replay harness that
  depends on it (routes on `${METHOD} ${pathname}`, one handler map, real
  `Response` objects — reused the `http-client.test.ts` `HttpClient.make`
  pattern from T5.3).
- **WHATWG `Response` rejects any body, even `""`, on null-body statuses**
  (204/304) — `fake-openstack.ts` passes `null` for those, not an empty
  string.
- Files: `packages/openstack/src/provider/{rest,security-group-rules,
  cloud-provider}.ts`, `packages/openstack/test/provider/{security-group-rules,
  cloud-provider,fake-openstack}.ts`. Not wired into `src/index.ts` (barrel
  integration is a later task's job, per the standing "don't touch
  `packages/core/src/index.ts` / package barrels outside your task" rule —
  same precedent as T6.1's sibling reconciler-fakes task).
- `bun run ci` (package-scoped): `tsc --noEmit` clean, `vitest run
  packages/openstack` 12 files / 44 tests green, `lint:deps` 0 violations (174
  modules/484 deps), oxlint clean for every file this task touched (repo-wide
  `bun run lint` still has pre-existing errors in `packages/distro-ovh-mks` —
  another concurrent agent's in-progress work, untouched).

## T4.2 — CLI skeleton (ovh-mks path)

- `effect/unstable/cli` (`Command`/`Flag`/`Argument`) has no `Command.run`
  built-in for reaching a Bun/Node process — pair it with
  `@effect/platform-bun`'s `BunRuntime.runMain` + `BunServices.layer`
  (`ChildProcessSpawner|Crypto|FileSystem|Path|Terminal|Stdio`, matches
  `Command.run`'s `Environment` requirement) and
  `@effect/platform-bun/BunHttpClient` (`export * from
  "effect/unstable/http/FetchHttpClient"`) for the base `HttpClient`.
- Effect v4 beta dropped `Effect.catchAll` — use `Effect.matchEffect({
  onFailure, onSuccess })` instead.
- `RendererRegistry`'s mapped type lets `renderError({ registry, error })`
  accept a whole `KumuloError` union (not just one narrowed tag) with zero
  cast: passing the union infers `Tag = KumuloErrorTag`, and
  `Extract<KumuloError, {_tag: KumuloErrorTag}>` collapses back to
  `KumuloError`. Useful pattern for any generic-tag-dispatch helper under the
  no-type-assertion lint rule — avoids the "narrow `unknown` then cast"
  trap entirely as long as the caller's error type is a real union, not
  `unknown`.
- `core/src/index.ts` doesn't (yet) re-export `present/{decide,render}.ts`
  or `reconcile/poll.ts` — same "barrel is the integration step's job" gap
  distro-ovh-mks hit for T6.1's pollUntil. Cli duplicates `decidePlanAction`/
  `renderPlan` locally (`src/present.ts`) rather than deep-importing.
- `MksClusterConfig`/`MksWorkerPoolConfig` (distro-ovh-mks) have no
  `serviceName` (OVH cloud-project id) source in `ClusterConfig` — it's an
  account concept, not a cluster field. CLI reads it from env
  (`OVH_SERVICE_NAME`, alongside `OVH_CLIENT_ID`/`OVH_CLIENT_SECRET`) at the
  composition root (`src/mks/env.ts`), not from the YAML.
- `MksClusterConfig.version` is `Cloud_kube_VersionEnum`, generated-client-only
  and not re-exported at distro-ovh-mks's package root — left unset from the
  CLI (OVH defaults to current stable); revisit once exported.
- Fixture-replay gotcha: the generated MKS client's delete ops
  (`deleteCloudProjectServiceNameKubeKubeId(NodePoolId)`) `matchStatus` only
  `"200"`, not `204` — a fixture returning 204 "no content" gets read as an
  unexpected-status `HttpClientError`, which `toMksError` then falls back to
  `ResourceConflict` (looks like a schema-decode failure until you check the
  status code map).
- No real Create/NoOp/Delete diff for the presented MKS plan yet (`buildMksPlan`
  in `src/mks/plan.ts` always shows "Create") — needs a read-only cluster/pool
  lookup by name that distro-ovh-mks doesn't export; `ensureCluster`/
  `ensureNodePools` themselves are the real (idempotent) convergence, so this
  only affects what `--dry-run` prints, not what apply does.
- Files: `packages/cli/src/{main,commands,config,errors,present,
  distro-not-wired}.ts`, `packages/cli/src/mks/{env,plan,reconcile}.ts`,
  `packages/cli/test/{errors,mks/plan}.test.ts`,
  `packages/cli/test/e2e/{mks-lifecycle,fake-mks-server}.ts`. Added
  `@effect/platform-bun`, `@kumulo/distro-ovh-mks`, `@kumulo/provider-ovh` as
  cli deps + a `bin` entry. `bun run ci` green (typecheck, 55 files/168 tests,
  dep-lint 0 violations, oxlint clean, codegen:check clean). `k3s` distro path
  is not wired (fails fast with a `DistroNotWired` tagged error) — M7's job.

## T4.3 — `doctor` (OVH half)

- **No live OVH capabilities/quota endpoint is vendored**: `distro-ovh-mks`'s
  allowlist only covers cluster/nodepool CRUD (T4.1/T4.2 scope), so
  region-capability and quota data can't be fetched live yet. Handled
  pragmatically: `regionVersionCapabilityCheck` validates only the k8s
  version against a hand-kept static set (mirrors the generated
  `Cloud_kube_VersionEnum` values, not re-exported through the package
  barrel so duplicated by hand — ponytail-noted with the upgrade path); the
  region half is an acknowledged gap until a `capabilities/kube` endpoint is
  added to the codegen pipeline. `planVsQuotaCheck` takes `maxClusters` as a
  caller-supplied parameter rather than a guessed OVH default — no
  fabricated "real" quota number.
- **Generic `Mks` method signatures don't fixture-test cleanly**: `Mks`'s
  methods are `<Config extends OperationConfig>(...) => Effect<
  WithOptionalResponse<A, Config>, ...>` — a conditional return type that a
  concrete literal object can't satisfy generically (TS2322 on a plain
  `Effect.succeed(x)` return). Fixed by giving the doctor package its own
  narrow, non-generic `OvhProjectClient` interface (`ovh/probe.ts`) with
  just `getCloudProjectServiceNameKube: (serviceName) => Effect<string[],
  ...>` — real wiring adapts with a one-line lambda
  (`(name) => mks.getCloudProjectServiceNameKube(name, undefined)`), test
  fixtures implement it directly with zero generics friction.
- **Effect v4 beta has no `Effect.catchAll`** (confirmed absent from the
  `effect` barrel here, unlike v3) — used `Effect.match({ onFailure,
  onSuccess })` instead everywhere a two-outcome fold was needed.
- Shared `probeStatus` (single `GET /kube` call classified into `"ok" |
  "unauthenticated" | "forbidden" | "unreachable"` by HTTP status) backs
  both `authValidityCheck` (fails only on 401) and `projectAccessCheck`
  (fails on 403, and also fails-through on 401 with a message pointing at
  the auth check) — two doctor entries, two actionable messages, one
  request shape.
- Registry (`doctor/registry.ts`'s `runChecks`) is a one-line
  `Effect.forEach` over `DoctorCheck[]` — deliberately never touched again;
  new checks (T6.3's OpenStack half) just append entries to the array built
  wherever `main.ts`'s composition root wires `doctor` (out of this task's
  scope).
- Files: `packages/cli/src/doctor/{types,registry,index}.ts`,
  `packages/cli/src/doctor/ovh/{probe,auth,project-access,capability,quota,index}.ts`,
  mirrored tests under `packages/cli/test/doctor/**` (+ `ovh/fake-mks.ts`
  fixture helper, no HTTP layer needed — fixtures implement `OvhProjectClient`
  directly). `bun run ci` full green: typecheck (13 packages), vitest 60
  files/180 tests, dep-lint 0 violations (210 modules), oxlint clean.
