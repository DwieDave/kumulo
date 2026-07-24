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

## T6.3 — doctor (OpenStack half) + k3s-config wiring

Committed as `a43913c`. Files: `packages/cli/src/doctor-openstack/{keystone-auth,nova,quota,octavia,resource-resolution,env,index}.ts`,
mirrored tests under `packages/cli/test/doctor-openstack/**` (+ `fake-openstack.ts`
fixture: a fixed-response fake `HttpClient` + a narrow `OpenStackEndpointResolver`
fake, same "narrow interface over the real Context.Service" trick as the OVH
half's `OvhProjectClient`).

- Five checks, all `DoctorCheck`s taking already-resolved effects/values as
  params (never a `Context` requirement) so they're unit-testable with plain
  fakes, same convention as `doctor/ovh/*`:
  - `keystoneAuthCheck({ token })` — reuses `KeystoneAuth.token`'s own
    `AuthenticationFailed` error for the message.
  - `microversionCheck({ probe, microversion })` + `probeMicroversion` — raw
    `GET /v2.1/` with `X-OpenStack-Nova-API-Version` header (design pins
    `NOVA_MICROVERSION = "2.96"`, matching the generated spec version, not
    the allowlist's `2.79` codegen pin — those are different concerns: codegen
    pins what shapes get generated, this pins what's sent on the wire).
    406 → rejected, else non-2xx/network failure → unreachable (both fail,
    distinct messages).
  - `quotaHeadroomCheck({ limits, plannedInstanceCount })` + `fetchNovaLimits`
    — raw `GET /v2.1/limits` (no allowlist entry exists for it, same "can't
    extend the codegen allowlist from this task" gap as the OVH capability
    check's ponytail note); non-2xx/unparseable → `{maxTotalInstances: -1,
    ...}` sentinel, read as "no limit" (pass) rather than a false failure —
    caught by a `mapError` to a literal tag *before* checking status, since
    checking `response.status` first and only calling `.json` on 2xx is
    required: a null-body 500's `.json()` can resolve successfully to `null`
    instead of throwing, which silently turned "unreachable" into "0/0 quota"
    (a real bug caught by the "unreachable → pass" test case, not the
    happy-path ones — worth keeping that test around).
  - `octaviaCapabilityCheck({ region, supported })` — pure, no network call:
    `supported` is sourced by the (future) composition root from T6.2's
    `ProviderProfile.capabilities.octavia(region)`, already pure itself.
  - `resourceResolutionCheck({ kind: "image"|"flavor", ref, resolve })` — one
    generic check backing both kinds (DRY), fed `@kumulo/openstack`'s
    existing `resolveImage`/`resolveFlavor` (T6.1) by the composition root.
- `Context.Service.Shape<typeof SomeTag>` is the v4 way to name a
  `Context.Service` class's *resolved instance* type outside the class
  itself (e.g. `OpenStackEnvShape.keystone`'s type) — the bare class name
  (`KeystoneAuth`) types the **tag**, not the shape; using it directly as a
  field type fails with "missing Service/[ServiceTypeId]/key".
- **No `Effect.either`** in this v4 beta (confirmed absent, like
  `Effect.catchAll`) — used `Effect.matchEffect({ onFailure, onSuccess })` to
  fork into two effects instead of pattern-matching an `Either` value.
- `packages/openstack/src/index.ts` was still the T0.1 placeholder — the
  `no-deep-package-imports` dep-lint rule (package-root imports only) forced
  adding real barrel exports there (`KeystoneAuth`, `KeystoneAuthLive`,
  `loadCredentials`, `CloudProviderLive`, `resolveImage`, `resolveFlavor`,
  types) before this task's checks could reach T6.1/T6.2's code at all;
  added `@kumulo/openstack` to `packages/cli/package.json` deps to match.
- `main.ts`: added `OpenStackEnv`/`OpenStackEnvLive` (never-failing — reads
  `OS_*`/`clouds.yaml`, but a missing/bad credential becomes
  `{ unavailableReason }` in the shape, not a Layer failure) merged into
  `MainLive`. Deliberately *not* wired further than that: no `doctor` CLI
  command exists yet (the OVH half didn't add one either — same precedent),
  and `distro-k3s` (M7) is still a placeholder package, so there's no
  consumer to wire beyond making `OpenStackEnv` available in the composition
  root's context for whichever task adds the `doctor` command / k3s command
  path next. A Layer that *can* fail (e.g. one that hard-requires `OS_*`)
  would have broken every `ovh-mks` command by failing `MainLive`'s shared
  context build regardless of which subcommand runs — that's why the
  never-failing shape matters here, not just for doctor's own contract.
- `bun run ci` full green: typecheck (all packages), vitest 26 files/75
  tests across `cli`+`openstack`, dep-lint 0 violations (223 modules),
  oxlint clean.

## Fix round — M2–M6 verification findings

- **`ensureCluster` create-on-lookup-miss bug (blocker, FR-2.6)**: `deleteMks`/
  `kubeconfigMks` in `packages/cli/src/mks/reconcile.ts` were both routing
  through `ensureCluster`, which creates+polls-to-READY (up to 10 min) when
  the by-name lookup misses — so `kumulo delete`/`kumulo kubeconfig` against
  a nonexistent cluster silently provisioned a real billable cluster. Fixed
  by extracting `findClusterByName` (lookup-only, no `_create` fallback)
  from `distro-ovh-mks/src/distro/ensure-cluster.ts`, exported via both the
  `distro/index.ts` and package-root barrels. `deleteMks` now no-ops when
  missing; `kubeconfigMks` now fails with `ResourceNotFound`. Test asserts
  this with a `HttpClient.tap`-based create-spy (watches for the `POST
  .../kube` call) — asserting `clusters.size === 0` alone is not enough,
  since a create-then-delete round trip leaves the same end state.
- **OVH codegen pipelines unregistered in `codegen:check` (blocker,
  FR-4.4/AC-5)**: `tools/codegen/src/bin/check.ts` only iterated
  `services.json` (6 OpenStack, httpapi-format). `distro-ovh-mks` and
  `dns-ovh` each run their own `ovh2openapi`-shaped pipeline
  (`scripts/generate.ts`: trim OVH schema -> `convert` -> patch -> generate)
  with no allowlist/services.json entry, so hand-edits to either committed
  `generated/client.ts` passed CI clean. Fixed by splitting each
  `scripts/generate.ts` into an exported pure `generate()` (the
  trim/convert/patch/generate pipeline, returns `{source, warnings}`) and an
  `if (import.meta.main)` CLI block that calls it and writes the file;
  `check.ts` now dynamically imports both packages' `generate()` and runs
  the same `checkNoop` gate against their committed output. `codegen:check`
  now reports "8 service pipeline(s) clean" (6 + 2), not 6.
- **`determinism.test.ts`'s "byte-identical" property was vacuous (minor)**:
  it converted one fixed in-memory object twice — trivially deterministic
  for any pure function, never exercising key-insertion-order risk. Fixed
  by rebuilding a structurally-equal schema with every dict's key order
  reversed (`_reorderKeys`) and comparing conversions of the original vs.
  reordered schema; this is a *stronger*, still-passing property (`convert`
  really is order-independent), not a red herring.
- **NFR-6 interruption test couldn't fail under a broken interrupt (minor)**:
  `packages/core/test/reconcile/apply.test.ts` did `forkChild` + `sleep("0
  millis")` + `interrupt`, then asserted only `<=` bounds that also hold if
  the fiber ran to completion or never started. Fixed with a test-local
  decorator layer (`_blockOnSecondServerLive`, defined in the test file, not
  the shared fake) that blocks on `Effect.never` — no `Clock` dependency,
  so it isn't affected by `it.effect`'s virtual `TestClock` (plain
  `Effect.sleep` durations don't advance without an explicit
  `TestClock.adjust`, which is *why* the original `sleep("0 millis")`
  version only "worked" by accident) — the first time a 2nd distinct server
  would be created; `Effect.yieldNow` (used as a value, not a call) lets the
  forked fiber reach that block before the test interrupts it. Assertions
  now require `0 < partial.length < specs.length` — genuinely mid-apply.
- **MKS version silently dropped (minor, FR-6.1)**: `_toMksConfig` never set
  `MksClusterConfig.version` because the generated
  `Cloud_kube_VersionEnum` type lived under `distro-ovh-mks`'s
  `generated/` internals, unreachable from `cli` under
  `no-deep-package-imports`. Fixed by adding
  `distro-ovh-mks/src/distro/parse-kube-version.ts` (`parseKubeVersion`,
  exported via both barrels): strips `ClusterConfig.version`'s plain-semver
  patch component down to OVH's major.minor enum and decodes it against the
  generated `Schema` — an unsupported minor now fails loudly with a real
  `ResourceConflict` (`MksError`) instead of the config's version being
  quietly ignored. Wired into `applyMks` only (the create/update path);
  `deleteMks`/`kubeconfigMks` don't need a version for a by-name lookup.
- `bun run ci` full green after all five fixes: typecheck (12 packages),
  vitest 68 files/200 tests, dep-lint 0 violations (227 modules), oxlint
  clean, `codegen:check` 8 pipelines clean.

## T8.1 — minimal in-house k8s client

Committed as `7ab7045`. Placement: `packages/core/src/k8s/**` (legal —
`effect/unstable/http` is a subpath of the `effect` catalog dep core already
allows, not a separate package; confirmed via `bun run lint:deps`).

- `kubeconfig.ts`: `parseKubeconfig` — single-context (`clusters[0]`/`users[0]`)
  YAML parse into `{ server, caPem?, auth }`, `auth` a `token | clientCert`
  discriminated union (base64-decoded cert/key). Client-cert *TLS wiring*
  (an `https.Agent`) is explicitly out of core's reach (dep-lint's
  `core-only-imports-effect` forbids `@effect/platform-node`) — parsing
  exposes the decoded PEM material, building the Agent is the composition
  root's job (same split as `openstack`'s `KeystoneAuthLive`/`OpenStackHttpLive`).
- `client.ts`: `K8sClient` (`Context.Service`) — `get`/`list`/`apply`/`delete`/
  `evict`, all taking a caller-supplied full REST path (`ResourceRef.path`,
  e.g. `/apis/apps/v1/namespaces/default/deployments/foo`) — no GVK→path
  mapper; every caller (distro-k3s drain, addons apply, cli status) already
  knows its own resource's path. `apply` is server-side apply per FR-9.2:
  `PATCH ...?fieldManager=kumulo&force=true`, `Content-Type:
  application/apply-patch+yaml` (body is `JSON.stringify` — YAML is a JSON
  superset, no need for the `yaml` stringifier on this path). `evict` POSTs
  the Eviction subresource (not a bare pod delete) — 409 (PDB-blocked) maps
  to `ResourceConflict`. `makeK8sClient({ client, server })` takes an
  *already-authenticated* `HttpClient.HttpClient` (bearer header set, or an
  Agent-backed client for certs) — same "wrap the standard tag" contract as
  `OpenStackHttpLive`.
- **`kumulo/no-type-assertion` forbids all `as` casts, including narrowing a
  decoded JSON body to a domain type** — `client.ts`'s `_toManifest` narrows
  via a runtime `apiVersion`/`kind` string check + object spread (returns
  `undefined` on a malformed body) instead of `as K8sManifest`.
- **`kumulo/no-multiple-function-params` applies to every *exported*
  function, not private (`_`-prefixed) ones** — `node-ops.ts`'s
  `cordonNode`/`drainNode`/`deleteNode` and `readiness.ts`'s
  `waitForDeploymentAvailable`/`waitForNodeReady` all take one options
  object each (`{ client, name }`, `{ get, ref, interval, timeout }`, etc.);
  private helpers like `_field(value, key)` are exempt.
- **`HttpClientRequest.delete` is exported under that name, not `.del`**
  (the source file itself only has a private `const del = make("DELETE")`,
  re-exported as `{ del as delete }`).
- **Passing a `URL` object (vs. a string) to `HttpClientRequest.get/patch/...`
  strips the query string into `request.urlParams`, not `request.url`** —
  `setUrl` special-cases `URL` instances this way. Fixture tests asserting
  on a PATCH's `?fieldManager=...&force=true` query must read
  `UrlParams.toString(request.urlParams)`, not `request.url`.
- Readiness waits (`waitForDeploymentAvailable`/`waitForNodeReady`) reuse
  T2's `pollUntil` as-is (generic over `Status`) — no new polling code;
  "Ready"/"Available" condition extraction is a small pure
  `_conditionStatus(manifest, type)` reader over `status.conditions[]`.
- Files: `packages/core/src/k8s/{kubeconfig,client,readiness,node-ops,index}.ts`,
  mirrored tests under `packages/core/test/k8s/**` (+ `fake-http-client.ts`,
  a local copy of `openstack/test/transport/http-client.test.ts`'s
  `_fakeBase` helper — core can't import a sibling package's test code).
  Timing-dependent readiness tests use `it.live` (real clock), same
  precedent as `reconcile/poll.test.ts` — `it.effect`'s virtual `TestClock`
  doesn't auto-advance plain `Effect.sleep`/`Schedule.spaced` durations.
- Scoped `bun run typecheck`/vitest/`lint:deps`/oxlint all green for
  `packages/core`. Full-repo `bun run typecheck`/vitest have one pre-existing
  unrelated failure in `packages/dns-ovh` (a concurrent task's in-progress
  work, not touched here).

## T7.2 — k3s bootstrap logic

- Effect v4 beta has **no `Effect.catchAll`** (confirmed absent from the
  `Effect.d.ts` surface in this beta) — use `Effect.match({ onFailure,
  onSuccess })` to turn a failed sub-effect into a plain value (e.g.
  `Option.none()`), same pattern `ssh/readiness.ts`'s `_asReady` already
  used. `Option` (module) and `Effect.forEach(..., { concurrency, discard })`
  **are** available off the bare `effect` barrel.
- `noUncheckedIndexedAccess` (root tsconfig) bites array destructuring too,
  not just bracket access: `const [first, ...rest] = someReadonlyArray` types
  `first` as `T | undefined` unless the parameter itself is a non-empty tuple
  type. Modeled masters lists needing a guaranteed head as
  `NonEmptyMasters = readonly [SshHost, ...Array<SshHost>]` (exported from
  `bootstrap/token.ts`) instead of a runtime empty-check — matches
  `masters.count >= 1` already enforced by the config schema (T1.2).
- `kumulo/no-multiple-function-params` applies to any **exported** function
  regardless of arity source — `installMasters`/`installWorkers` originally
  took `(list, callback)` / `(list, callback, concurrency)` and both tripped
  it; refactored to single named-args objects (`InstallMastersArgs`,
  `InstallWorkersArgs`).
- `it.prop(name, [oneArb], (props) => ...)` still delivers `props` as a
  **one-element array** even with a single arbitrary — destructure
  `([args]) => ...`, confirmed against `@effect/vitest` behavior already
  noted for the 2-arb case in T1.2's memory.
- `fast-check@4.9.0` (as vendored here) has no `hexaString` — used a plain
  `FastCheck.string({ minLength, maxLength })` for a random-token arbitrary
  instead.
- Token/first-master logic (`bootstrap/token.ts`) ports hetzner-k3s's
  `K3s.k3s_token` + `ControlPlane::Setup#identify_first_master`: quorum-tally
  `/var/lib/rancher/k3s/server/node-token` reads across masters (unreadable
  masters silently excluded, not failed), most-frequent token wins, ties
  broken by whichever master owns that token's oldest `stat -c %Y` mtime; no
  token anywhere on any master → fresh `crypto.randomBytes(32).hex` and
  `masters[0]` as first-master (matches the Crystal fallback).
- Install scripts (`bootstrap/install-script.ts`) are plain template-literal
  string builders, not a templating library port — hetzner-k3s's Crinja
  templates do far more (private-network detection, Hetzner metadata,
  Traefik/ServiceLB toggles) that don't apply to our OpenStack/OVH target;
  kept only what FR-5.3 actually asks for (cluster-init vs `--server` join,
  TLS SANs incl. `127.0.0.1`, `--disable-cloud-controller`,
  advertise/node-ip/node-external-ip, cilium's
  `--flannel-backend=none --disable-network-policy`, extra args
  passthrough, agent join URL + labels/taints).
- Orchestration (`bootstrap/orchestrate.ts`) mirrors hetzner-k3s's
  `ControlPlane::Setup`/`Worker::Setup` structure: `installMasters` runs
  master 1 alone first (its `--cluster-init` must be up before others'
  `--server` join works), then fans the rest out with
  `concurrency: "unbounded"`; `installWorkers` is a single bounded
  `Effect.forEach` (default concurrency 10, matching hetzner-k3s's
  semaphore(10)).
- Package-scoped `bun run typecheck`/vitest (7 files/21 tests)/`lint:deps`/
  oxlint all green for `packages/distro-k3s`. Root `bun run ci` fails only in
  `packages/addons` (another concurrent task's in-flight, untracked/modified
  files — confirmed via `git status` before staging, not touched here).

## T7.3 — kubeconfig, releases, drain, k3s distro assembly + AC-2 e2e

- `src/kubeconfig/{rewrite,fetch,write}.ts`: `resolveServerUrl` (FR-5.5
  precedence LB VIP > DNS name > master IP) + `rewriteKubeconfig` (plain
  string substitution, not a YAML round-trip — k3s's generated kubeconfig is
  a fixed single-context template with `server: https://127.0.0.1:6443` and
  cluster/context/user all literally named `default`; only those tokens
  change) + `fetchKubeconfig` (SSH-reads `/etc/rancher/k3s/k3s.yaml` off
  master 1, rewrites, maps `SshCommandError` → `BootstrapFailed`) +
  `writeKubeconfigFile` (0600 via `node:fs.writeFileSync({mode: 0o600})` —
  the only fs write in this package, matches the port's "content is a plain
  string" contract; nothing else here needs `@effect/platform`).
- `src/releases/{fixture,cache}.ts`: `K3S_RELEASE_FIXTURE` is a vendored
  static tag list (offline requirement — no live GitHub fetch in code or
  tests); `makeReleaseCache({source?, ttlMs?, now?})` wraps it in a `Ref`-
  backed TTL cache (`source`/`now` injectable so the TTL-refresh test can
  fake time without `TestClock`) and exposes `validateVersion` (`ConfigInvalid`
  on an unlisted version). `scripts/refresh-releases.ts` is the human-
  triggered live refresh (never imported by src/ or tests).
- `src/distro/drain.ts`: `drainAndRemove({client, node})` composes T8.1's
  `cordonNode`/`drainNode`/`deleteNode` against a caller-supplied
  `K8sClient["Service"]`; only does the k8s-side drain (FR-2.7) — actual
  server deletion stays the reconciler's `CloudProvider.deleteByTag` call,
  made after this succeeds (the `Distro` port has no `CloudProvider`
  reference, by design §3.3).
- `src/distro/{plan,user-data,index}.ts`: `makeSelfManagedDistro(args)`
  closes over already-resolved dependencies (`ssh`, `k8s` service instances,
  not `Context.Tag`s) and returns the full `SelfManagedDistroShape` object
  literal — required because the port's method signatures carry no `R`
  (`Effect.Effect<A, E>`), so a Layer-requested service can't leak into the
  return type; SSH is `Effect.provideService`'d inside the one method
  (`fetchKubeconfig`) that needs it.
- **`kumulo/no-multiple-function-params` fires even on a function nested
  inside another function, if that inner function is itself exported at
  top level** — false, actually the opposite bit us here: the rule exempts
  a multi-param function *nested inside another function* regardless of
  export (`_isNestedInsideFunction` short-circuits before the export
  check), so `SelfManagedDistroShape`'s 2-arg `planBootstrap`/`fetchKubeconfig`
  fields can be assigned inline as arrows inside `makeSelfManagedDistro`'s
  body without violating the rule, while a *standalone top-level* 2+-arg
  export (`drainAndRemove(client, node)`, `writeKubeconfigFile(path,
  content)`, the old curried `renderUserData(clusterName, sshPublicKey)`)
  still gets flagged and needed single-object-args. `src/distro/plan.ts`
  now only exports the single-arg `bootstrapOrder(inventory)`; the port's
  2-arg `planBootstrap` shape is built inline in `distro/index.ts`.
- AC-2 e2e (`test/e2e/lifecycle.test.ts`): HA 3-master + 2-pool (`pool-a`x2,
  `pool-b`x1) `ServerSpec[]` run twice through the *real* `runPhases`/
  `applyServers` (core) against a small local in-memory `CloudProvider` fake
  (not a cross-package import of `core/test/fakes` — no other package does
  that; dep-lint scopes `test/` per-package) — asserts idempotent
  convergence to exactly 6 servers by name. Then the real `resolveToken`/
  `installMasters`/`installWorkers`/`renderServerInstallScript`/
  `renderAgentInstallScript` run over a fake `Ssh`, asserting 3 rendered
  master scripts (master 1 gets `--cluster-init`, the rest `--server
  https://<master1>:6443`) and 2 rendered worker scripts (each carrying the
  resolved token). Finally `makeSelfManagedDistro(...).fetchKubeconfig` is
  exercised end-to-end (fake Ssh returns a k3s.yaml fixture, rewritten
  server matches the fake `CloudProvider`'s LB vip) and `.drainAndRemove`
  against a no-op fake `K8sClient`.
- Package-scoped `bun run typecheck`/vitest (14 files/36 tests)/`lint:deps`/
  oxlint all green for `packages/distro-k3s`. Root `bun run ci` not run (this
  session only touched `packages/distro-k3s`'s own files; other packages'
  in-flight concurrent work untouched, confirmed via `git status` before
  staging).

## T8.3 — upgrade flows

- `distro-k3s/src/upgrade/plan.ts`: `renderMastersPlan`/`renderWorkersPlan`/
  `renderUpgradePlan` port hetzner-k3s's `templates/upgrade_plan_for_*.yaml`
  (SUC `Plan` CRs) — masters concurrency 1 + cordon + control-plane-only
  nodeSelector; workers configurable concurrency + `prepare` waiting on the
  `k3s-server` Plan + cordon. Fixed a source bug while porting: the Crystal
  masters template has **two `matchExpressions:` keys in the same YAML
  mapping** (`node-role.kubernetes.io/master` then `.../control-plane`) —
  in YAML a duplicate key silently keeps only the last one, so the "master"
  condition never actually applied upstream either; folded to one clean
  `control-plane` (`In`/`NotIn`) selector instead of reproducing the dead
  key.
- Wired the `SelfManagedDistroShape.upgradePlan` stub in
  `distro-k3s/src/distro/index.ts` (left by T7.3 with an explicit `ponytail:
  ... T8.3's scope` marker) to call `renderUpgradePlan({ version: target })`
  — one-line change, not a new file, but the designated integration point.
- `distro-ovh-mks`'s API-driven `upgrade()` (strategy `LATEST_PATCH`/
  `NEXT_MINOR`) already existed pre-T8.3 (committed under T7.x/T8.x distro
  work) — nothing to add there, only CLI wiring was missing.
- **No k3s CLI command path exists yet** (`create`/`scale`/`kubeconfig`/
  `delete` all hard-fail on `distro: k3s` via `DistroNotWired` — only
  `ovh-mks` is composed at the root, see `main.ts`'s `MksEnvLive` +
  `OpenStackEnvLive`). Building a full client-cert `K8sClient` HTTP layer
  from a kubeconfig just for this one command would be scope creep no other
  task owns yet (and risks colliding with whatever future task does wire
  k3s's `create`/`kubeconfig` — same composition-root code would be
  needed there). Confirmed this reading is intentional, not an oversight:
  design doc §7 literally lists the command's contract as `kumulo upgrade
  --config cluster.yaml  # SUC plan for new k3s version` (render, not
  apply) — matching plan.md's own wording split ("SUC plan **rendering**"
  for k3s vs "MKS API-**driven**" for mks). So `packages/cli/src/commands/
  upgrade.ts`'s k3s branch renders + prints the Plan manifests (JSON, same
  "YAML is a JSON superset" convention as `core/src/k8s/client.ts`) with a
  `kubectl apply -f -` hint; the ovh-mks branch actually calls the API
  (resolve cluster by name, then `upgrade()`, gated on `--yes` like
  `delete`). Revisit once a k3s `K8sClient`/SSH composition root lands —
  swap the print for a real `K8sClient.apply` per manifest.
- `strategy` flag maps `latest-patch`/`next-minor` → OVH's
  `LATEST_PATCH`/`NEXT_MINOR` via `Flag.choiceWithValue` (kebab-case CLI
  input, upper-snake API enum) rather than exposing the raw enum spelling
  at the CLI surface.
- No `worker_upgrade_concurrency` config field exists in `ClusterConfig`
  schema (unlike hetzner-k3s's `k3s_upgrade_concurrency` setting) — exposed
  as a CLI-only `--worker-concurrency` flag (default 1) instead of adding a
  schema field, since `packages/core/src/config/schema.ts` is outside this
  task's ownership and no other FR calls for it to be config-persisted.
- Package-scoped `bun run typecheck`/vitest (15 files/39 tests for
  distro-k3s incl. 3 new; 15 files/33 tests for cli, unchanged count since
  no new test file was added for the CLI command — see below)/`lint:deps`/
  oxlint all green for both `packages/distro-k3s` and `packages/cli`.
  Root `bun run lint` (whole repo) also clean except one pre-existing
  unrelated warning in `packages/core/test/k8s/readiness.test.ts` (not
  touched here). `git status` confirmed clean ownership before staging (no
  other agents' in-flight files touched).
- Did not add a dedicated CLI-command test file for `upgrade` — ponytail:
  the two branches are thin wiring over already-tested pure functions
  (`renderUpgradePlan` golden-tested in distro-k3s; `findClusterByName`/
  `upgrade` golden/contract-tested in distro-ovh-mks); the golden-file
  `distro-k3s/test/upgrade/plan.test.ts` is the one runnable check that
  actually exercises new logic. Add a `cli/test/commands/upgrade.test.ts`
  (fake `MksEnv`, capturing `Console.log` output) if the CLI wiring itself
  grows real branching logic.

## T10.1 — status + volumes commands, exit codes, renderer sweep

- `status` (`cli/src/commands/status.ts`) only wires `ovh-mks` live (same
  scope limit as every other command, `distro-not-wired.ts`) — a real k3s
  status additionally needs a `K8sClient` composition root (kubeconfig →
  authenticated HTTP client), which no command builds yet (T8.3 hit the
  identical gap for `upgrade`/`kubeconfig`); k3s configs fail with
  `DistroNotWired`, not a stub. Renders `findClusterByName`'s
  `ManagedClusterInfo` (id/status/apiEndpoint) + configured worker pool
  sizes — no separate node-health probe exists at the mks layer (OVH IS the
  node health authority for a managed control plane).
- `volumes list`/`volumes adopt` (`cli/src/commands/volumes.ts`) are thin
  wiring over T9.2's already-tested pure `@kumulo/volumes-cinder` functions
  (`listVolumes`/`adoptVolume`/`readOutputs`/`writeOutputs`) — outputs file
  lives next to the config (`dirname(configPath)`). `adopt` takes only
  `--config`/`--name`/`--volume-id`; the volume's size/type/retain/pvc spec
  comes from the config's own `volumes.retained[]` entry matching `--name`
  (no duplicate CLI flags for data the config already declares). Did not add
  a dedicated command-wiring test for these two (same "thin wiring over
  tested pure functions" call T8.3 made for `upgrade` — `volumes-cinder`'s
  own test suite already covers `adoptVolume`/`listVolumes`).
- **AC-7 (`reconcileVolumesOnDelete`, same file)** is the one piece of real
  new branching logic here, so it gets its own test
  (`cli/test/commands/volumes.test.ts` + a local `fake-cinder.ts` — dep-lint
  scopes `test/` per-package, so `volumes-cinder/test/fake-cinder.ts` isn't
  importable from here; duplicated verbatim, same precedent as
  `core/k8s`'s `fake-http-client.ts`). Wired into `del` in `commands.ts`
  after `deleteMks`: for each `volumes.retained[]` entry, look up the
  matching live volume via `VolumeProvider.listClusterVolumes`, keep+print
  `retain: true` ones, delete the rest. `config.volumes.module !== "cinder"`
  or an empty `retained[]` short-circuits to `[]` with zero Cinder calls —
  this only *reconciles what the config already declares*, it never
  discovers/deletes volumes it wasn't told about.
- **`CinderAuth` composition root** (`cli/src/volumes/env.ts`,
  `CinderAuthLive`): built from `OpenStackEnv` (T6.3, already shared by the
  doctor checks) — `keystone.token`/`keystone.endpoint({service:
  "volumev3", region})`, no separate credential set (Cinder is a plain
  OpenStack service). `keystone.endpoint` can fail with `ResourceNotFound`
  (missing catalog entry) as well as `AuthenticationFailed`, but
  `CinderAuth.endpoint`'s contract is `AuthenticationFailed`-only — mapped
  with `Effect.mapError` rather than widening the port.
- **Layer wiring gotcha (main.ts)**: `VolumeProviderLive` is composed at
  *command runtime* (inside `reconcileVolumesOnDelete`, not at Layer-build
  time) via `Effect.provide(VolumeProvider, VolumeProviderLive({tag}))` —
  this captures the *ambient* `HttpClient.HttpClient` from context at that
  point, so `HttpClient` must stay in `MainLive`'s **exposed** environment,
  not just be consumed internally to build `MksEnvLive`/`CinderAuthLive`.
  Fixed by adding `BunHttpClient.layer` as its own member of
  `Layer.mergeAll(...)` (exposed) *and* keeping the outer
  `.pipe(Layer.provide(BunHttpClient.layer))` (satisfies the other two
  layers' own build-time `HttpClient` requirement) — dropping either half
  either loses `HttpClient` from the final environment or fails to build
  `MksEnvLive`/`CinderAuthLive` at all.
- `CinderAuthLive` depends on `OpenStackEnv`, which needs to stay exposed
  too (the doctor checks read it directly) — used `Layer.provideMerge`
  (`CinderAuthLive.pipe(Layer.provideMerge(OpenStackEnvLive))`), not
  `Layer.provide`, so `OpenStackEnv` survives into the merged output
  alongside the derived `CinderAuth`. `Layer.provide` alone would have
  hidden `OpenStackEnv` after this point.
- **Renderer sweep (AC-6)**: `RendererRegistry`'s mapped type already
  compile-enforced every `KumuloErrorTag` (T4.2-era `cli/src/errors.ts`) —
  only the *tests* were incomplete (2 of 12 tags). Added one assertion per
  remaining tag (`HttpTransportError`, `ResponseDecodeError`,
  `QuotaExceeded`, `ResourceConflict`, `CapabilityMissing`,
  `ProvisioningTimeout`, `ConfigInvalid`, `PlanRejected`, `BootstrapFailed`,
  `AddonInstallFailed`) to `cli/test/errors.test.ts`. Also added
  `OutputsInvalid` (a CLI-only tag from `@kumulo/volumes-cinder`, same
  pattern as `DistroNotWired`) to `CliDomainError`/`renderCliError`, since
  `readOutputs`/`parseOutputsYaml` failures now reach the CLI boundary via
  the new `volumes` commands.
- **`exit-codes.ts`**: `exitCodeFor(error): number`, one code per
  `KumuloErrorTag` (2–13) + `DistroNotWired` (20) + `PlatformError` (21) +
  `OutputsInvalid` (22); a bare CLI parse error (`CliError.isCliError`) gets
  `64` (sysexits.h `EX_USAGE`), matching the pre-existing convention that
  `CliError` renders its own message rather than going through
  `renderCliError`. Wired into `main.ts`'s failure branch in place of the
  old hardcoded `process.exitCode = 1`.
- **Scope cut, documented deliberately**: did *not* speculatively merge a
  `DnsProvider` Layer into `main.ts` — no command calls it yet (DNS record
  management isn't wired into any create/delete path in this codebase),
  so it would be unused scaffolding. `CinderAuthLive`/`VolumeProvider` *did*
  get wired because `reconcileVolumesOnDelete` is a real, tested consumer
  (AC-7). Revisit DNS wiring when a task actually calls `DnsProvider`.
- Package-scoped `bun run typecheck`/vitest (16 files/45 tests, +12 from
  T8.3's 33)/`lint:deps` (317 modules, 0 violations)/oxlint all green for
  `packages/cli`. Root `bun run typecheck` (12 packages) and full `vitest
  run` (95 files/301 tests) both green — ran the full-repo gates this time
  since `main.ts`/`commands.ts` are shared integration points other
  concurrent tasks might also touch; `git status` showed only this
  session's own files before staging.

## M7-M10 verifier follow-up — k3s composition root + CLI wiring

- `applyServers`/`phasesForKind`/`runPhases` (core) are still just phase
  *ordering* data + a bounded-concurrency `ensureServer` helper — there is no
  generic "run every phase" orchestrator in core. The composition root (this
  task) sequences the concrete Network→Security→LB→Nodes→Bootstrap→Addons→
  DNS→Volumes→Kubeconfig calls itself in `packages/cli/src/k3s/reconcile.ts`.
  "ServerGroups" has no separate call at this layer — `openstack`'s
  `ensureServer` already calls `ensureServerGroups` internally per
  `spec.role` (see `packages/openstack/src/provider/cloud-provider.ts`), so
  the Nodes phase covers it.
- **Production gap closed**: `distro-k3s/src/bootstrap/install.ts`
  (`runBootstrap`) is the first *production* caller that actually executes
  the rendered install scripts over `Ssh.exec`, gated by
  `cloudInitReady`/`sshReady` before and `controlPlaneReady` after master 1.
  Previously only `orchestrate.ts`'s `installMasters`/`installWorkers` (pure
  ordering, caller-supplied `installOne`) and the T7.3 e2e test (which only
  pushed rendered scripts into an array) existed — neither actually ran
  anything over SSH in a shipped path.
- `packages/cli/src/k3s/`: `plan.ts` (per-index `ServerSpec`s via core's
  `resourceName`, same all-`Create` ponytail simplification as
  `mks/plan.ts` — upgrade both together once a real tagged-resource diff
  exists), `env.ts` (Layer builders: OpenStack `CloudProvider` reusing
  `OpenStackEnv`/T6.3, Cinder `VolumeProvider` reusing the `volumes.ts`
  pattern, OVH `DnsProvider` reusing `MksEnv`'s OAuth2 env-var pattern),
  `k8s-http-client.ts` (Bun's `fetch` `tls` option via
  `FetchHttpClient.RequestInit`/`BunHttpClient.RequestInit` — no bespoke
  HttpClient constructor needed for the Addons phase's client-cert
  kubeconfig), `reconcile.ts` (the phase pipeline itself).
- **Testability split**: every exported flow has a `*Effect` twin
  (`applyK3sEffect`/`deleteK3sEffect`/`kubeconfigK3sEffect`) expressed purely
  against the ports (`CloudProvider | Ssh | DnsProvider | VolumeProvider |
  OpenStackEnv`), with the public `applyK3s`/`deleteK3s`/`kubeconfigK3s`
  just piping the live Layers on top. Baking `Effect.provide(liveLayer)`
  directly into the exported function (my first draft) makes it
  untestable from outside — the returned Effect's `R` no longer mentions
  the port, so a test can't swap in a fake. Split before writing tests, not
  after.
- `packages/cli/test/k3s/reconcile.test.ts` proves the fakes record
  *executed* commands (`Ssh.exec` calls), not just rendered ones — 3
  masters + 2 workers all show up in the executed-command log, the first
  master's script contains `--cluster-init`, the rest `--server https://...`.
- FR-2.7 scale-down gap: `CloudProvider` has no per-server delete verb (only
  whole-cluster `deleteByTag`) — `_drainOrphanedWorkers` in `reconcile.ts`
  drains+deletes the k8s `Node` object for any running worker not in the
  desired spec set (the real, wired part of FR-2.7); actual VM teardown for
  a single orphaned worker needs that port to grow a delete-by-name verb
  first (out of this task's ownership — core port change).
- Addons phase builds its own `K8sClient` from master 1's raw (unrewritten)
  kubeconfig — this happens *before* the Kubeconfig phase because
  `SELF_MANAGED_PHASES`'s fixed order puts Addons ahead of Kubeconfig.
- Small out-of-package additions (same "necessary barrel wiring" precedent
  as T0.2/T1.2's dep-lint/config fixes): `packages/openstack/src/index.ts`
  now re-exports `buildFr57Rules`/`SecurityGroupRuleInput` (FR-5.7 SG rules,
  previously internal-only); `packages/cli/package.json` was missing
  `@kumulo/distro-k3s`/`@kumulo/dns-ovh`/`@kumulo/addons` as declared deps
  (present transitively enough for `tsc` to resolve, but `bun`'s runtime
  module resolution — and vitest — need them declared to link into
  `node_modules`; caught by `bunx vitest run`, not `tsc --noEmit`).
- `bun run ci` full green: typecheck × 12 packages, vitest 102 files/317
  tests, `lint:deps` 0 violations (328 modules/1065 deps), oxlint clean,
  `codegen:check` clean.
