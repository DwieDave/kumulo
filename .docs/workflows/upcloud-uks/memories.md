# Memories: UpCloud Managed Kubernetes (UKS)

Notes for whichever agent picks this workflow up next — background a diff
alone won't carry.

## No OpenAPI spec

UpCloud publishes no machine-readable API spec (unlike OVH, Hetzner, and
OpenStack, all of which are `@effect/openapi-generator` targets here).
`@kumulo/upcloud` is hand-written against UpCloud's prose API reference and is
**deliberately absent from `tools/codegen/services.json`**, so
`codegen:check` has nothing to compare it against and never flags it as
stale. See `packages/upcloud/README.md`'s "Why hand-written (D1)" section.

## Versions are minor-only

UKS clusters carry `version: "1.31"` — no patch component, ever. The API's
own `available-upgrades` endpoint returns `{"versions": ["1.31", ...]}` in
the same minor-only shape. `UksVersion` (`^v?\d+\.\d+$`) is a distinct schema
literal from `K3sVersion` and `PlainK8sVersion` — do not conflate them, and
do not try to derive a patch component from anywhere; it does not exist in
this API.

## PATCH is narrow — do not add fields to it

- `PATCH /kubernetes-clusters/{name}` (cluster) accepts **only**
  `control_plane_ip_filter` and `labels`. Every other field (`zone`, `plan`,
  `network`, `storage_encryption`, `private_node_groups`) is creation-time —
  `clusterDrift` refuses a mismatch rather than mutating it (D8/R9/AC6).
- `PATCH /node-groups/{name}` accepts **only** `count`. Everything else about
  a node group (`plan`, `labels`, `taints`, `ssh_keys`, `storage`,
  `anti_affinity`, `utility_network_access`) is creation-time too, which is
  why node-group identity is hashed (`uksPoolHash`) rather than diffed
  field-by-field.

If a future change adds a field to either config block, check first whether
the live API actually accepts it via PATCH — assume not until proven
otherwise, per the pattern above.

## D9 — suffixed node-group names, create-then-delete

Node groups cannot be renamed and their names must be unique per cluster, so
a config's `worker_pools[].name` (the *pool* name, ≤54 chars so this fits) is
never the live API name. The live name is `<pool>-<hash8>`, where `hash8` is
`uksPoolHash` over the pool's immutable fields. `diffNodePools` keys off the
`kumulo-pool` label, not the live name, so a hash change (any immutable field
edited) is a `ReplaceNeedsConfirm`: create the new generation, wait for
`running`, then delete the old one. Two generations of a pool run — and are
billed — concurrently for the length of a confirmed replace. This is a
deliberate, loudly-documented tradeoff (see D9 in requirements.md and the
plan's Risks section), not an oversight to "optimize away" by deleting first.

## D15 — the dep-cruiser exception, and its one condition

`.dependency-cruiser.cjs`'s `no-sibling-package-imports` rule normally
forbids any non-core package from importing another non-core sibling.
`distro-upcloud-uks` importing `@kumulo/upcloud` is exactly that shape, so
the rule is relaxed for *incoming* edges into `@kumulo/upcloud` only — it is
treated like `@kumulo/core` from the outside.

**The condition that must keep holding:** `@kumulo/upcloud`'s own *outgoing*
imports stay fully governed by the unrelaxed rule — it may import
`@kumulo/core` and nothing else. If `@kumulo/upcloud` ever grows an import of
another sibling package, the exception as written would silently permit a
real layering violation instead of catching it. Anyone touching
`.dependency-cruiser.cjs`'s `upcloud`-related pattern should keep `upcloud`
in the rule's `from` pattern so only the incoming edge is exempted, not the
outgoing ones too.

## Open questions still unanswered (Q7–Q10)

None of these have been probed live — T7.2 (the gated live smoke test) is
deferred, requires a paid `UPCLOUD_API_TOKEN` account, and was not run as
part of this milestone. The current implementation encodes the *documented
assumption* for each, flagged with a `kumulo:` comment naming the question:

- **Q7** — Does `DELETE /node-groups/{name}` drain pods first? Undocumented.
  Assumed: no explicit drain step is added before D9's delete-the-old-
  generation step; core's `drainNode`/`cordonNode` exist if this turns out to
  be wrong.
- **Q8** — Exact 4xx error body shape. Assumed: status-code-only mapping
  (R5) is precise enough; no body-shape parsing was attempted.
- **Q9** — Which control plane plans exist beyond `dev-md`/`prod-md`.
  Assumed: config validates `plan` as a free `NonEmptyString`, not a literal
  union — `GET /kubernetes/plans` is the live source of truth, checked by
  `doctor` (AC9), not the schema.
- **Q10** — Does deleting a cluster release its network automatically, or
  does network delete fail while the cluster still terminates? Assumed: no
  poll is inserted between cluster delete and network/router delete in the
  teardown sequence (R11) — if UpCloud requires one, `T5.5`'s delete
  ordering needs a wait step added between the two deletes.

Whoever runs T7.2 should treat a contradiction on any of these as a required
follow-up task against the file(s) named above, not a live-only footnote.

## T7.1 state (examples, schema, snapshot)

- `examples/upcloud-uks.yaml` added: one worker pool, a `network` block, a
  `zone`, `version: "1.31"`, `volumes.module: none`, `object_storage.module:
  none`, `secrets.sink: none` (no secrets surface needed for a minimal
  example).
- `examples/decode.test.ts` and `examples/plan-snapshot.test.ts` both gained
  an `upcloud-uks` case, generated the same way as the existing
  `ovh-mks`/`k3s`/`k3s-hetzner` cases (no distro-specific branching needed —
  `_desiredBuckets`/`_volumeActions` already fall through to `[]` for
  `module: none`).
- `kumulo.schema.json` regenerated via `bun run schema:generate`;
  `schema:check` passes clean.
- `bun run codegen:check` fails, but on an unrelated pre-existing issue: an
  `effect/schema/isPattern` decode error inside the OpenStack-generated
  `ServersCreate_20` schema, surfacing after the `effect@beta.102` bump
  (recent commit `a585f9f`). Not touched by this milestone's changes —
  reported, not papered over.
- `bun run lint` is clean; the errors M7 reported (non-null assertions,
  `private-function-prefix`, `no-type-assertion`) were fixed in the
  remediation pass below.

## What the verification pass caught (read this before trusting a fake server)

Every item here shipped green in CI first, which is the point.

- **`version` never reached UpCloud.** `UksClusterCreateInput` had no
  `version` field, so every cluster would have been created at UpCloud's
  default — D7's entire purpose, defeated. It survived because
  `fake-uks-server.ts` echoed a hardcoded `"1.31"`, the config's own value, so
  the lifecycle test asserted against a constant the fake invented. The fake
  now rejects a create without `version` as strictly as one without `zone`,
  and the test asserts on what the server stored.
  **Lesson: a fake that supplies a value is a fake that cannot test it.**
- **AC8 was satisfied only in a unit test.** `validateAutoscaling` is called
  from the ovh and hetzner profile validators; `provider: upcloud` fell
  through to `genericProfile`, whose `validate` was `Effect.void`. The gates
  are distro-capability checks, not provider checks, so `generic` now runs
  them — which also closes the same hole for any future provider without a
  bespoke profile.
- **Duplicate pool labels stranded a billed node group.** See D9 above; the
  by-label `Map` kept the last generation and the orphan was invisible to
  `toDelete` forever, because its label *was* in `desiredPoolNames`.
- **Cluster drift compared a boolean.** `network` was "is a network
  attached", which is always true, so an edited `network.cidr` planned as a
  NoOp. Now compares `network_cidr`. `storage_encryption` reached the drift
  check at apply time but was missing from the plan-time `actual`, so AC6's
  "refused at plan time" was half-true; the CLI inventory carries it now.
- **Plan rows used UpCloud resource names** (`staging-eu-network`) while
  `upcloud-uks-entry.ts`'s `appliedPrefixes` matched `network/`. No row ever
  matched. Rows are `<kind>/<cluster>` like every other distro;
  `networkName`/`routerName` are for finding resources, never for labelling
  rows.
- **The zone doctor check hardcoded 13 of 15 zones**, so two valid zones
  produced a confident false `fail`. It now reads `/1.3/zone` (a new client
  in `@kumulo/upcloud`) and excludes private-cloud zones. When the listing
  itself fails it says the zone could not be *verified* rather than claiming
  it is invalid — `DoctorCheckResult` is pass/fail only, so the wording is
  what carries the distinction.
- **A property test's generator was wrong, not the code.** `okCidr` filtered
  on leading octets, so it produced `100.146.91.251/8` — which masks to
  `100.0.0.0/8` and contains the excluded `100.64.0.0/10`. The validator was
  right to reject it. The generator now applies the same masked-range overlap
  rule the implementation does.

## Build order is now load-bearing (D15's other consequence)

`packages/*` build alphabetically between `core` and `cli`, so
`distro-upcloud-uks` built *before* `upcloud` and compiled against a stale
`.d.ts`. Every other package depends only on `core`, which is why this never
came up. The root `build` script now seeds the order with `core` then
`upcloud`. If another sibling-to-sibling edge is ever added, that list is
where it has to be reflected.
