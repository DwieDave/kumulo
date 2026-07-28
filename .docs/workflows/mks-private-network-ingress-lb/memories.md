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
