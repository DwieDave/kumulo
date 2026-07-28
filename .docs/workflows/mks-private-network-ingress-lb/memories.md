# Memories

Carried forward between milestones. Newest section last.

## M2 — MKS network wiring (T2.1–T2.5, landed)

### Shipped

- `MksNetwork = { cidr, nodes_subnet, load_balancers_subnet }`, all three
  required `Cidr`s, attached as `network: Schema.optionalKey(...)` on core's
  `MksClusterConfig`. Deliberately NOT k3s's `Network` (`{ cidr, public_access }`).
- Distro-layer `MksClusterConfig` carries all three ids; `_create` posts all
  three. Passed unconditionally — `bodyJsonUnsafe` drops `undefined`.
- `_ensureMksNetwork` (cli `mks/reconcile.ts`) runs between the spec build and
  `ensureCluster`. Gated on the `network` block; `requireVrack` first.
- `clusterDrift` gained `_networkDrift`: presence-only, `Blocked`, message says
  recreate.
- Plan rows `network/<cluster>`, `subnet/<cluster>/nodes`,
  `subnet/<cluster>/load-balancers`, ahead of the cluster row.

### D2 is still provisional

M0 was **not run**. Design choice D2 (kumulo owns the LB, the CCM adopts it by
id via `loadbalancer.openstack.org/load-balancer-id`) rests on upstream + OVH
documentation and has never been observed on a live MKS cluster. Nothing in M2
depends on it. Retire Q4 before M3.

### Decisions worth not re-deriving

- **Presence, not identity, at plan time.** The desired network id is unknowable
  before the network exists (`ensureNetwork` is create-if-missing, not a read).
  Comparing ids would fabricate drift on every apply or need a read-only lookup
  the `CloudProvider` port does not have. `MksClusterState.privateNetworkId` is
  `string | null | undefined`: `null`/`""` = OVH said "no network", `undefined` =
  never read → no claim. `MksDesiredCluster.privateNetwork` is
  `boolean | undefined`, absent = the caller models no networking.
- **`_convergeCluster` derives the flag**: `privateNetworkId !== undefined`. Safe
  because `_networkIds` fails when `ensureNetwork` returns a `NetworkInfo` short
  a subnet id, so a configured network always yields all three ids or an error.
- **The vRack gate is load-bearing.** `requireVrack` unconditional would refuse
  every MKS apply on a vRack-less project. R5 forbids that. Keep it inside the
  `network !== undefined` branch.
- **Network resolution must stay out of `_toMksConfig`.** That helper is shared
  by `lookupMksInventory`, `kubeconfigMks` and `deleteMksEffect`; resolving there
  would create a Neutron network on `kumulo kubeconfig` or `status`.
- **MKS apply now needs OS_\* credentials** — but only when a `network` block is
  present. `mksCloudProviderLayer` builds either way and fails at first use.
- **`octaviaEnabled: false` on the MKS `CloudProvider`.** MKS configs have no
  `api_server.high_availability`. `ensureNetwork` never reads the flag. R11 (M3)
  must give it a real source before `ensureLoadBalancer` is wired.

### Traps that bit, or would have

- Four `distro: ovh-mks` test fixtures carried a k3s-shaped `network:` block that
  decoded-and-was-dropped by excess-property-ignore. Same for
  `dns-distro.test.ts`'s `_forDistro`, which spread the k3s fixture. All fixed in
  T2.1. **They still carry `api_server`/`ssh`/`masters`/`addons`/`k3s` blocks** —
  the same trap re-arms the moment MKS gains any of those keys (R11/R12 are
  candidates).
- `mksEntry.appliedPrefixes` now `["network/", "subnet/", "mks-cluster/",
  "mks-pool/"]`. A row without a matching prefix renders and never checks off,
  and nothing fails — `plan.test.ts` pins this now.
- Adding network rows moved the cluster row off index 0. Plan assertions that
  index positionally break; find rows by name.
- `examples/ovh-mks.json` and `.yaml` are asserted deep-equal by
  `examples/decode.test.ts` — always edit both.
- `examples/cli-smoke.test.ts` throws at import unless `packages/cli/dist/main.mjs`
  exists. `bun run build` before `bun run test`.
- `scripts/generate-schema.ts` carries a hand-maintained `crossFieldConstraints`
  array. M2 added no cross-field filter, so it needed no edit — a future one does.

### Known ceilings (marked `ponytail:` in code)

- `_networkActions` (cli `mks/plan.ts`) reads network existence off the live
  cluster's `privateNetworkId`. A network that outlived its cluster plans as
  `Create` and applies as a no-op. Upgrade path: a read-only network lookup on
  the `CloudProvider` port.
- `packages/core/src/reconcile/phases.ts`'s `MANAGED_PHASES` comment ("Managed
  control planes own network/nodes themselves, so the infra phases are skipped
  entirely") is now false for MKS. Cosmetic; no consumer but its own test.

### M2 verification fixes (landed after T2.5)

- **`Layer.unwrap` fails at LAYER-BUILD time, not first use.** The old
  `_openStackCloudProviderLayer` comment claimed otherwise and was false, so
  `applyMks` (which provides it unconditionally) broke every OVH-only MKS apply
  with `AuthenticationFailed` the moment OS_* was absent. Fixed by returning
  `_unavailableCloudProvider(hint)` — a `CloudProvider` whose nine verbs each
  fail with the same `AuthenticationFailed` — instead of failing the unwrap.
  `CloudError` already contains `AuthenticationFailed`, so no signature moved.
  **Only `applyMks` catches this; every `applyMksEffect` test injects a
  `CloudProvider` and is blind to it.**
- **R8's refusal now runs before `ensureNetwork`.** `_convergeCluster`'s refusal
  is inside `ensureCluster`, i.e. *after* the Neutron writes — the add-network
  direction left a network + two subnets orphaned. `_refuseClusterDrift` (cli
  `mks/reconcile.ts`) repeats the read-only lookup + `clusterDrift` ahead of
  `requireVrack`. Costs one extra `findClusterByName` per networked apply.
  `driftConflict` (distro `cluster-drift.ts`) is the shared failure wording.
- **`_networkIds` now fails with `ResourceConflict{kind:"network-drift"}`**
  naming the offending `nodes_subnet`/`load_balancers_subnet` and saying
  *recreate*. Editing a subnet CIDR on a live network lands here, not at plan
  time — plan compares presence only. Exit code moved 6 → 7 for that case.
- **`network.cidr` is now load-bearing**: `isSubnetsWithinCidr` (core
  `config/schema.ts`) rejects a subnet outside the declared network. JSON Schema
  cannot express CIDR containment, so `kumulo.schema.json` is unchanged and
  `crossFieldConstraints` still needed no edit.

### Still open after those fixes

- **R8 is met at apply time, not plan time, for a changed network *identity*.**
  A subnet CIDR edit still plans as `NoOp`. Closing it needs a read-only
  network/subnet lookup on the `CloudProvider` port (the ids a config resolves
  to are unknowable without Neutron) — a port change, so M3+ work, not a
  correction. The apply-time failure now says recreate, which is the honest
  half that was reachable inside M2.

### Left for later milestones (deliberately not started)

- Teardown of the network (M5/T5.1–T5.3). `deleteMksEffect` deletes the cluster
  and DNS only; a network created by M2 is currently orphaned on delete.
- `MksClusterState` carries `privateNetworkId` only — not the two subnet ids.
  `Cloud_kube_Cluster` returns all three if a later milestone needs them.

## M3 — Floating IP + ingress load balancer (T3.1–T3.7, landed)

### D2 is STILL provisional

M0 was again **not run**. Everything in M3 is built to the documented
upstream/OVH contract for `loadbalancer.openstack.org/load-balancer-id`
adoption. T3.6's property test pins *kumulo's* side (it writes nothing to an LB
that already exists), NOT that OVH's CCM honours the annotation. Q4 is still
open, and M4/M5 inherit it.

### Shipped

- **Neutron floating IPs are newly generated code.** `allowlists/neutron.json`
  had no FIP ops at all — T3.1 added `floatingips:get|post|/id:delete` plus
  three patches (requestBody `required`; removing the `in: path`
  `floatingips_id` wrongly listed as parameter 0 of the collection GET; adding
  the path-item `parameters` that `_filterPathItem` drops). Regenerate with
  `bun run --cwd packages/openstack generate`; `bun run codegen:check` is the
  gate. **`floatingips/id:put` deliberately NOT allowlisted**: `floatingips:post`
  associates at create time via `port_id`, so allocate+associate is one call and
  no generated client here has to emit its first PUT endpoint.
- `ensureFloatingIp({options, portId})` / `releaseFloatingIp({options})` in
  `packages/openstack/src/provider/cloud-provider.ts`.
- `LbSpec` += optional `vipSubnetId`/`vipNetworkId`/`flavorId`/`floatingIp`;
  `LbInfo` += optional `floatingIp`. All optional — k3s and the Hetzner adapter
  pass `{ members: [] }` and their wire payload is pinned unchanged (N1).
- `mksCloudProviderLayer` now derives `octaviaEnabled` from `hasOctavia(region)`
  (@kumulo/provider-ovh). `_openStackCloudProviderLayer` takes
  `octaviaEnabled: (region) => boolean` so both distros pick their own source.
- `ingress` block on core's `MksClusterConfig` (`flavor_id` only), presence =
  enabled, `isIngressPlaceable` rejects it without `network`.
- `OutputsFile` += optional `ingress: { load_balancer_id, floating_ip }` in
  **@kumulo/volumes-cinder** (it owns that file), with `setIngress`.
- Plan rows `load-balancer/<cluster>/ingress`, `floating-ip/<cluster>/ingress`.

### Decisions worth not re-deriving

- **A floating IP's natural key is `description`, not `port_id` or a name.**
  Neutron FIPs have no `name`, and the CREATE body has no `tags` (the response
  does). `port_id` looks tempting but stops working the instant the LB owning
  that port is deleted — which is exactly when teardown needs to find the FIP.
  `_fipKey(options)` = `kumulo-<tag>`, and `floatingips:get` takes
  `?description=` as a real server-side filter.
- **External network discovery is `?router:external=true` + first match.** No
  config field. OVH exposes exactly one (`Ext-Net`). Marked `ponytail:`.
- **`ensureLoadBalancer` allocates the FIP itself** rather than the FIP being a
  new `CloudProvider` port verb — which is why `_unavailableCloudProvider`'s
  nine-verb list did not have to grow.
- **Outputs are RETURNED from apply, not written by it.** `_convergeAll` runs
  the distro apply concurrently with `convergeManagedVolumes`, which
  read-modify-writes `<cluster>.outputs.yaml`, and `stringifyOutputs` rebuilds
  the file from a fixed literal — so an interleaved write silently loses one
  side. `DistroApplyResult` gained an optional `ingress`, and
  `recordIngressOutputs` (exported from `cli/src/commands.ts`) writes it AFTER
  `Effect.all`. Do not move that write back inside the apply.
- **`MksApplyResult extends ManagedClusterInfo`** so every existing caller and
  test reading `id`/`apiEndpoint`/`status` was untouched.
- **k3s's `octaviaEnabled` source is untouched on purpose.** It gates apply,
  kubeconfig AND status unconditionally; a region lookup would silently change
  which k3s configs can boot. Pinned by a test in `test/provider/registry.test.ts`.

### Known ceilings (marked `ponytail:` in code)

- `_ingressActions` (cli `mks/plan.ts`) infers LB existence from
  `inventory.clusterExists`. Adding `ingress:` to a live cluster plans NoOp and
  then creates. Upgrade path: a read-only LB lookup on the `CloudProvider` port
  (same fix `_networkActions` wants). Reading Octavia at plan time instead would
  make `kumulo plan` fail without OS_* credentials.
- `floatingips:get` as vendored exposes no `marker`/`limit`, so `_paginate` is
  not wired for FIPs. The `?description=` filter matches at most one per cluster.
- Octavia's LB list is still unpaginated and matched client-side by name, while
  D2 guarantees the CCM creates sibling LBs in the same project. A kumulo-owned
  LB that falls off page one plans as absent and gets re-created. `_paginate`
  exists and `loadbalancers_links` is on the response — a straight reuse when it
  matters.
- The ingress LB is still named `kumulo-<tag>`, same as the network and the
  security group and the k3s API-VIP LB. Fine today (one distro per cluster),
  but `_deleteLoadBalancer` sends `cascade: true`, which would destroy exactly
  the CCM-owned listeners/pools D2 protects. **M5 must not reuse that verb for
  the ingress LB.**

### Traps that bit, or would have

- `bun run build` before `bun run test`: `examples/cli-smoke.test.ts` and
  `secrets-smoke.test.ts` run the built `packages/cli/dist/main.mjs` and fail
  confusingly against a stale one.
- oxlint's `unicorn(consistent-function-scoping)` fires on a helper defined
  inside a `describe` body that captures nothing — hoist it to module scope.
  Likewise `no-array-sort`: use `toSorted()`.
- `scripts/generate-schema.ts`'s `crossFieldConstraints` DID need an edit this
  time (unlike M2): `ingress ⇒ network` is expressible in JSON Schema, so it was
  mirrored there. Only skip the mirror when JSON Schema genuinely cannot say it.
- Editing `examples/ovh-mks.json` with a JSON round-trip reformats unrelated
  arrays; patch the text, not the parsed object.

### Unresolved / flagged, not fixed

- **R9 vs the OVH ProviderProfile.** `packages/provider-ovh/src/profile/ovh.ts`
  declares `capabilities.floatingIps: false` with the comment "Ext-Net model (no
  floating IPs)", and `defaults.externalNetworkName: "Ext-Net"`. Nothing in
  `src` reads that flag (tests only), so it is a dormant claim, but it directly
  contradicts R9. Settle before M5 wires teardown.
- **Q1/Q2 still open.** `ingress.flavor_id` follows the MKS *Standard*
  (`loadbalancer.openstack.org/flavor-id`, a UUID) vocabulary because that is
  what Octavia's POST takes. MKS Free's `S`/`M`/`L` is not expressible. No
  proxy-protocol field exists — per D4 it must be a creation-time decision, and
  there is no answer yet.
- **`_deletePlanActions` (cli `distro/mks-entry.ts`) emits no LB/floating-IP
  Delete rows.** Deliberate: nothing deletes them yet (M5/T5.1), and a Delete row
  for a resource nothing removes is a lie. Add them with the teardown.
- **`_ingressOutputs` (cli `distro/mks-entry.ts`)** guards on empty id/address
  and is not directly covered by a test; the branches it protects are reachable
  only if Octavia/Neutron return a body with no id or address.

## M3 — corrections after verification

- **Assert POST bodies, not that a POST happened.** `expect(post).toBeDefined()`
  passed with `port_id` dropped from the floating-IP create body AND with the
  LB's *id* associated instead of its `vip_port_id`. The fakes now record every
  posted body and the tests deep-equal it.
- **An adopted floating IP has to be re-associated.** `description` is the FIP's
  key precisely so it survives the LB's deletion — which is exactly the case
  where Neutron has nulled its `port_id`. Adopting it unchecked published an
  address that routed nowhere. `floatingips/id:put` was added to
  `allowlists/neutron.json` (+ the two usual patch entries: `requestBody.required`
  and the path parameter) and `_associate` re-points a FIP whose `port_id`
  differs. Re-generated with `bun run --cwd packages/openstack generate`.
- **Test the seam, not the two halves.** `recordIngressOutputs` and
  `applyMksEffect(...).ingress` were each covered alone, so the join between
  them could be deleted with CI green. `test/commands/apply-ingress.test.ts`
  drives the real `apply` command (fake OVH + fake Neutron/Octavia via
  `makeFakeCinder`'s HTTP layer + a stubbed `OpenStackEnv` keystone) and reads
  `<cluster>.outputs.yaml` back off disk.
- `makeFakeCinder` keeps query params in `request.urlParams`, not in
  `request.url` — read them from there (`router:external=true`).

## M4 — `ingress` DNS target (T4.1–T4.4, landed)

### D2 is STILL provisional

M0 was not run, for the third milestone running. `target: ingress` now
resolves to the floating IP kumulo allocated; whether OVH's CCM ever attaches
listeners to that LB is unobserved. A correct DNS record pointing at an LB with
no listeners is the failure mode this milestone cannot rule out.

### Shipped

- `DnsTargets = { api_server: DnsTarget; ingress?: DnsTarget }` (cli `dns.ts`).
  `desiredRecords`/`reconcileDns` take `targets`, not `apiTarget`.
  `_resolveTarget` is a lookup: an absent key falls through exactly as an
  unrecognised target does.
- `DnsPlanTargets` (cli `dns-plan.ts`) is the same map in *kinds*
  (`"ip" | "hostname"`), consumed by `_kindOf`. `k3s/plan.ts` passes
  `{ api_server: "ip" }`, `mks/plan.ts` passes `_dnsTargets(config)`.
- `reconcileMksDns` gained an optional `ingress?: LbInfo`; `_dnsTargets`
  (cli `mks/reconcile.ts`) offers it only when `floatingIp` is a non-empty
  string, mirroring `_ingressOutputs`' guard.
- `packages/cli/test/mks/spy-dns.ts` — the `DnsProvider` spy, hoisted out of
  `test/mks/dns.test.ts` so `ingress.test.ts` can drive the seam.
- The fake MKS server now returns a cluster `url`. Without one `apiEndpoint`
  was `""` and every fixture apply with a real `dns.module` failed
  `ConfigInvalid` before reaching the DNS phase. `test/commands/delete.test.ts`
  hand-builds a `FakeCluster` and had to gain the field too.

### Decisions worth not re-deriving

- **A partial map, not a second parameter.** k3s must keep passing `ingress`
  through literally (scope §5); an absent key gives that for free, while a
  required second argument would force k3s to invent a target it has none of.
- **Plan derives the ingress record kind from the `ingress:` block alone.** A
  Neutron FIP is always IPv4 → `A`, so the row is right even on the apply that
  creates the LB. Reading Octavia at plan time would make `kumulo plan` demand
  OS_* credentials (same ceiling `_networkActions`/`_ingressActions` carry).
- **Plan and apply must move together.** Fixing `_resolveTarget` without
  `_kindOf` would have shipped a plan promising a CNAME where the apply writes
  an A record — worse than the old uniform lie, because the plan then looks
  trustworthy.

### Known ceiling — decided deliberately, not overlooked

`target: ingress` with **no `ingress:` block** decodes clean, plans a `CNAME`
row and applies a CNAME to the literal hostname `ingress`. Nothing validates a
record's target against the ingress block (`isIngressPlaceable` only enforces
`ingress ⇒ network`). Left as-is because R15 requires an unrecognised target to
pass through literally and R16 asks for an honest *row*, not a rejected config —
plan and apply now agree on exactly what lands. The same silence makes any
mistyped target (`api-server`) a valid record pointing nowhere; it is pinned by
a test rather than left to be rediscovered. Upgrade path if it starts biting: a
cross-field schema filter beside `isIngressPlaceable`, which then also needs the
`crossFieldConstraints` mirror in `scripts/generate-schema.ts` + a committed
`kumulo.schema.json` (the `ingress ⇒ network` precedent from M3).

### Traps that bit

- oxlint's `kumulo(no-type-assertion)` bans `as` in tests too — a property
  expectation indexing a map by the generated target needed rewriting as
  explicit branches. `as const` is fine.
- The config schema rejects an empty record target (`NonEmptyString`), so `""`
  cannot appear in a target arbitrary: `decodeTestConfig` throws before the
  property runs.

## M4 verification fixes — DNS ownership TXT + kind migration

Two defects found by verifying a *second* apply (M4 only ever exercised one).
Both pre-existing and shared with k3s, both fixed at the single place all
callers route through.

- **The CLI never emitted the ownership TXT.** `DnsProvider`'s contract keys
  ownership off a `kumulo.cluster=<tag>` TXT rrset at the same name — every
  provider contract test passed one explicitly, and nothing in `src/` ever did.
  So apply #2 saw its own records as foreign (`ResourceConflict`) and
  `removeClusterRecords` deleted nothing. `desiredRecords`
  (`packages/cli/src/dns.ts`) now appends one TXT per distinct name, tagged
  `config.name` — the same tag `removeDns` deletes by. Records first, ownership
  appended, so `ensureRecords`' pairing (which is order-independent) and the
  existing "first element is the resolved record" tests both hold.
- **A record's *kind* could not migrate.** `_ensurePair` looked up
  `existingOther.find(r => r.type === kind)`, so a name whose target changed
  from hostname to address gained an A rrset *beside* the stale CNAME —
  invalid per RFC 1034 §3.6.2. M4 is the first release where a kind moves
  (`target: ingress` with no `ingress:` block writes CNAME `www -> ingress`,
  then adding `ingress: {}` makes it an A). `_deleteStaleKinds` drops the
  other-kind rrsets past the ownership guard, in **both** dns-ovh and
  dns-hetzner (identical `_ensurePair`, identical bug).
- The kind-migration test lives in the shared `runDnsProviderContractSuite`, so
  every future adapter inherits it; it needed one new harness hook
  (`kindsAt`) because `targetOf` deliberately returns the first non-TXT record
  and so cannot see a split-brain name.

## M5 — Teardown (T5.1–T5.3, landed)

### D2 is STILL provisional

M0 was not run, for the fourth milestone running. M5 builds to the documented
contract only. Nothing here has been observed against a live MKS cluster.

### Shipped

- `deleteMksEffect` (cli `mks/reconcile.ts`) now runs
  DNS → cluster → *wait* → `cloud.deleteByTag(config.name)`. Its R gained
  `CloudProvider`; `deleteMks` provides `mksCloudProviderLayer(config)` beside
  the DNS layer, exactly as `applyMks` does.
- `_waitClusterGone` polls `findClusterByName(...)?.status ?? "DELETED"` via the
  distro's `pollUntil` (now exported from `@kumulo/distro-ovh-mks`), 5s interval,
  20min timeout → `ProvisioningTimeout{kind:"mks-cluster"}`.
- `deleteByTag` (openstack) gained `releaseFloatingIp` between the LB and the
  servers. k3s never allocates a FIP, so for that path it is one extra
  `GET /v2.0/floatingips?description=kumulo-<tag>` returning empty (N1).
- `_networkInUse` → `ResourceConflict{kind:"network-in-use"}` naming the network
  id and the remedy, raised from `_deleteNetworking`'s 409.
- `_infraDeleteRows` (cli `distro/mks-entry.ts`) emits `load-balancer/…`,
  `floating-ip/…`, both `subnet/…` and `network/<cluster>` Delete rows.

### Decisions worth not re-deriving

- **`deleteByTag` is REUSED for MKS rather than a new port verb.** Widening
  `CloudProvider` would force edits to the Hetzner adapter and to
  `_unavailableCloudProvider`'s verb list. On MKS the server/server-group/
  security-group steps simply find nothing — three cheap reads — and the
  LB/FIP/network steps are exactly R17's order. `deleteByTag` itself stays
  byte-compatible for k3s apart from the FIP release.
- **`cascade: true` is KEPT for the ingress LB, reversing M3's note** ("M5 must
  not reuse that verb"). At teardown the cluster is already gone, so the
  CCM-owned listeners D2 protects can never be reconciled again; a non-cascade
  delete of an LB carrying listeners is a 409 that reads exactly like the
  network-in-use conflict while meaning something else. Documented at the call
  site in `_deleteLoadBalancer`.
- **The teardown is gated on `config.network`, not on `ingress`.**
  `isIngressPlaceable` already forbids `ingress` without `network`, and the gate
  is what keeps OS_* credentials optional for a network-less MKS delete (R5).
  The three MKS delete tests that use a network-less config now provide
  `cloudProviderNever`, which dies on every verb — the gate is asserted, not
  assumed. Do NOT "fix" those by handing them credentials.
- **Delete plan rows come off the CONFIG, not the live cluster.** `deleteByTag`
  finds each resource by name and deleting an absent one is a no-op, so a
  declared network always plans `Delete`. This sidesteps `_networkActions`'
  apply-side ceiling (existence inferred from `clusterState.privateNetworkId`)
  rather than inheriting it.
- **No `retain` for the network, ever (D3).** Volumes/buckets keep theirs
  untouched. `_infraDeleteRows` has no `(retained)` branch and a property test
  pins that no delete row ever contains the word.

### Traps that bit, or would have

- **`it.effect` runs on the TestClock — real sleeps never elapse.** A 409 on an
  idempotent method is replayed by `OpenStackHttpLive` with exponential backoff
  (`transportMaxRetries = 5`, ~6s), and under `it.effect` the test hangs forever
  instead of failing. Cost an hour chasing a phantom "infinite retry" bug in the
  transport; there is none. Any test that must observe a real backoff, timeout
  or poll interval needs `it.live` (plus an explicit vitest timeout).
- `Effect.repeat`'s `times`/`while` options do NOT bound a delayed schedule in a
  way that is observable under the TestClock — do not "fix" the transport on
  that evidence. Verified: `Schedule.recurs(n)` terminates, `exponential`
  does not, purely because the latter sleeps.
- oxlint's `kumulo(no-type-assertion)` plus TS narrowing: `assert.strictEqual`
  does not narrow a tagged union, so reading `failure.kind`/`failure.ref` after
  it fails `typecheck` even though the test passes. `expect(x).toMatchObject({
  _tag, kind, ref: expect.stringContaining(...) })` needs no narrowing.
- `deletePlanActions`' declared R is the whole `DistroServices` union, so a test
  calling it through `mksEntry` must provide `CinderAuth`/`HttpClient`
  (`makeFakeCinder({})`) and `OpenStackEnv` even though an `ovh-mks` plan
  reaches neither.

### Known ceilings

- The delete of the two subnets is implicit: Neutron removes a network's
  subnets with it, so no subnet DELETE is ever issued. The plan rows are still
  honest (they do get deleted) but nothing would notice a Neutron that stopped
  cascading.
- `_waitClusterGone` polls the cluster only. Nothing waits on the Nova ports
  themselves, so a slow port release still lands on the 409 — which is now
  retried by the transport (~6s) and then fails loudly with the remedy. Upgrade
  path if it bites: poll Neutron ports on the network before the network delete.
- MKS delete now issues three no-op OpenStack reads (servers by tag, server
  groups, security groups) that a managed control plane can never own. Cheap,
  and the price of not widening the `CloudProvider` port.

### M5 verification fixes (2026-07-28)

- Octavia's `DELETE /lbaas/loadbalancers/:id` is ACCEPTED, not performed: the LB
  goes PENDING_DELETE and keeps its VIP port on the load-balancers subnet, so the
  network delete ~1-2s later 409s on every real MKS teardown. `_deleteLoadBalancer`
  now polls `provisioning_status` (2s/10min) until DELETED or gone from the list —
  the LB twin of `_waitClusterGone`. Octavia keeps a DELETED record until
  housekeeping purges it, so waiting on a 404 alone would have hung for the
  retention window.
- Fakes that answer a DELETE with 204 and keep listing the resource unchanged
  cannot distinguish a synchronous delete from an asynchronous one — every
  teardown fake now flips `provisioning_status`. That is what made this defect
  invisible to the M5 suite.
- `TestClock` from `effect/testing` DOES work under `it.effect`
  (`Effect.forkChild` + `TestClock.adjust` + `Fiber.join`); `it.live` is only
  needed where the sleep is inside the transport's retry, which the fiber can't
  observe. First use in this repo — see the PENDING_DELETE test in
  `packages/openstack/test/provider/cloud-provider.test.ts`.
- Delete-plan rows must be gated on exactly what the teardown gates on.
  `_deleteMksInfra` gates on `network` alone and `deleteByTag` then finds the LB
  and the floating IP BY NAME, so gating the plan's rows on `config.ingress`
  under-reported any config that dropped its `ingress:` block after applying it.

## M6 — Release preparation (T6.1/T6.2 landed; T6.3 NOT done)

### CI is green, and this is what green means

`bun run ci` (2026-07-28, clean tree): typecheck → build → 776 tests in 170
files → dep-cruise 715 modules/2622 deps, no violations → oxlint clean →
codegen:check "11 service pipeline(s) clean" → schema:check no diff. The only
noise is dependency-cruiser warning that it wants `typescript@<7` while the
catalog pins `7.0.2`; it is a warning, exit 0, and predates this work.

`bun run ci` runs `build` before `test` on purpose — `examples/cli-smoke.test.ts`
and `secrets-smoke.test.ts` execute `packages/cli/dist/main.mjs`. Running
`vitest` alone against a stale build fails confusingly. This bit M2, M3 and M5.

### Carried forward from M2–M5 — the short list

The per-milestone sections above are the detail. If only five things survive:

1. **D2 is unverified.** M0 was never run, through five milestones. kumulo
   creating an empty Octavia LB and OVH's CCM adopting it via
   `loadbalancer.openstack.org/load-balancer-id` is documented by upstream and
   by OVH and has never been observed on a live MKS cluster. Every test pins
   *kumulo's* half of the contract. A negative result invalidates D2 and most
   of R9–R16. Q1 (flavor vocabulary — `flavor_id` follows MKS Standard's UUID,
   MKS Free's S/M/L is not expressible), Q2 (proxy protocol — no field exists,
   and per D4 it must be decided at creation) and Q3 (Octavia tag support) are
   open with it.
2. **Plan-time reads are the standing ceiling.** `_networkActions`,
   `_ingressActions` and R8's identity check all infer existence from the live
   cluster rather than reading Neutron/Octavia, because reading them would make
   `kumulo plan` demand OS_* credentials. Consequences: adding `network:` or
   `ingress:` to a live cluster plans NoOp then fails/creates at apply, and a
   changed subnet CIDR fails at apply with "recreate", not at plan. All three
   want the same fix: a read-only network/LB lookup on the `CloudProvider`
   port. That is a port change — the Hetzner adapter and
   `_unavailableCloudProvider`'s verb list move with it.
3. **N1 held.** k3s shares `NetworkSpec`/`NetworkInfo`, `ensureNetwork`,
   `ensureLoadBalancer` and `deleteByTag`. Every widening is optional-keyed and
   the k3s wire payloads are pinned byte-for-byte by tests. k3s's
   `octaviaEnabled` source is deliberately untouched (it gates apply,
   kubeconfig *and* status). The one behavioural change k3s sees is a single
   extra `GET /v2.0/floatingips?description=kumulo-<tag>` on delete, which
   returns empty.
4. **Async deletes are the recurring production defect.** Both the MKS cluster
   and the Octavia LB return ACCEPTED and keep their ports for seconds to
   minutes; the next delete in the chain 409s. `_waitClusterGone` and
   `_deleteLoadBalancer`'s `provisioning_status` poll exist for exactly that.
   A fake that answers DELETE with 204 and keeps listing the resource unchanged
   cannot tell a synchronous delete from an async one — that is what hid the LB
   defect from the whole M5 suite. Nothing yet waits on Nova ports before the
   network delete; that 409 is retried by the transport and then fails loudly
   with the remedy.
5. **The two generated-artifact gates.** `kumulo.schema.json` is generated from
   `packages/core/src/config/schema.ts` (`bun run schema:generate`, commit the
   result) and `scripts/generate-schema.ts` carries a hand-maintained
   `crossFieldConstraints` array that must mirror any cross-field filter JSON
   Schema *can* express (`ingress ⇒ network` is mirrored; CIDR containment is
   not, because JSON Schema cannot say it). Generated clients under
   `packages/*/src/generated/` are never hand-edited — change
   `allowlists/*.json` + its patches and run the package's `generate`.

### Test-harness lore that cost the most time

- `it.effect` runs on the TestClock, so real sleeps never elapse and a
  transport-level backoff hangs the test forever. `TestClock` from
  `effect/testing` *does* work under `it.effect` via `Effect.forkChild` +
  `TestClock.adjust` + `Fiber.join`; `it.live` is only needed when the sleep is
  inside the transport's retry, which the fiber cannot observe.
- Assert POST bodies, not that a POST happened. `expect(post).toBeDefined()`
  passed with `port_id` missing from a floating-IP create and with the LB's id
  associated instead of its `vip_port_id`.
- Test the seam, not the two halves. `recordIngressOutputs` and
  `applyMksEffect(...).ingress` were each covered alone, so the join between
  them could have been deleted with CI green.
- oxlint bans `as` in tests too (`kumulo(no-type-assertion)`), and
  `assert.strictEqual` does not narrow a tagged union — use
  `expect(x).toMatchObject({ _tag, kind, ref })`.
- `examples/ovh-mks.json` and `.yaml` are asserted deep-equal by
  `examples/decode.test.ts`; always edit both, and patch the JSON as text (a
  parse/stringify round-trip reformats unrelated arrays).

### What is deliberately NOT done

- **T6.3 — version bump and publish.** No `package.json` version was touched,
  nothing was published, no tag, no push. The whole workspace is still at
  0.1.1 and the CHANGELOG entries sit under `[Unreleased]`. A human does the
  release.
- **R9 vs the OVH ProviderProfile.** `packages/provider-ovh/src/profile/ovh.ts`
  still declares `capabilities.floatingIps: false` ("Ext-Net model (no floating
  IPs)") while M3/M5 allocate, associate and release floating IPs on OVH.
  Nothing in `src/` reads the flag — only tests do — so it is a dormant
  contradiction, not a bug. It was flagged before M5 and is still unsettled.
- **`target: ingress` with no `ingress:` block** decodes clean and writes a
  CNAME to the literal hostname `ingress`. Pinned by a test, not fixed: R15
  requires an unrecognised target to pass through literally.
