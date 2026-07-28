# Plan: UpCloud Managed Kubernetes (UKS)

Status: DRAFT — awaiting human approval. Each task lists the requirements it
satisfies. Sequenced by real dependency; tasks marked **[parallel]** have no
ordering constraint against their siblings in the same milestone.

Every task follows Phase 4: failing test first, verify it fails, implement,
verify it passes, commit.

## Milestone 1 — Config schema **[parallel with M2]**

- **T1.1** `Provider` += `"upcloud"`, `DistroKind` += `"upcloud-uks"`,
  `UksVersion` literal, and the `UpcloudUksClusterConfig` variant joined into
  the `ClusterConfig` union. Decode tests: accept a minimal valid config,
  reject a `X.Y.Z` version, reject `volumes.module` other than `none`.
  [R14, R15, D7]
- **T1.2** `isAuthMethodConsistentWithProvider` → per-provider allowed-methods
  map. Property test: for every `(provider, method)` pair, the filter accepts
  exactly the pairs in the map. [R16, D5, N2]
- **T1.3** UpCloud CIDR validator (prefix /8–/29, outside 100.64.0.0/10,
  127.0.0.0/8, 224.0.0.0/4, 169.254.0.0/16) + pool-name validator (≤54 chars
  so D9's `-<hash8>` suffix fits UpCloud's 63-char limit). Property-tested.
  [R15, R20, N2]
- **T1.4** `distroCapabilities["upcloud-uks"]`, and `validateAutoscaling`'s
  message names the offending distro instead of hardcoding k3s. [R17, AC8]

_No dependency on anything. T1.2–T1.4 are independent of T1.1 except for the
new literals, so they land in order but each is separately testable._

## Milestone 2 — `@kumulo/upcloud` package skeleton + transport **[parallel with M1]**

- **T2.1** Package scaffolding: `packages/upcloud` (package.json mirroring
  `distro-ovh-mks`'s, tsconfig pair, barrel, README carrying D1's
  "hand-written, exempt from codegen:check" note), workspace registration,
  and the D15 `no-sibling-package-imports` exception in
  `.dependency-cruiser.cjs`. `lint:deps` passes. [D1, D2, D15, N3, N4]
- **T2.2** Bearer-token `HttpClient` layer from `UPCLOUD_API_TOKEN`, base URL,
  and the 429-aware bounded retry. Test: header present, token never appears
  in a rendered error. [R1, R6]
- **T2.3** Status → tagged-error mapping (`mapUpcloudError`), property-tested
  over the status space so every code lands on exactly one tagged error.
  [R5, N2]

_T2.1 first; T2.2 and T2.3 are independent of each other **[parallel]**._

## Milestone 3 — `@kumulo/upcloud` API surface

- **T3.1** UKS schemas + cluster calls: list/get/create/patch/delete,
  `available-upgrades`, `upgrade`, `kubeconfig`, `plans`. Decode tests from
  captured fixtures. [R2, R4]
- **T3.2** Node group schemas + calls: list/get/create/patch/delete, single
  node delete. **[parallel with T3.1]** [R2, R4]
- **T3.3** Network + router schemas and calls. **[parallel with T3.1]**
  [R3, R4]

_Depends on M2 (transport + error mapping)._

## Milestone 4 — Pure distro logic

Everything here is pure and total, so it is tested without a server and is
where N2's property tests concentrate.

- **T4.0** `packages/distro-upcloud-uks` scaffolding (package.json, tsconfig
  pair, barrel, workspace registration) — pulled forward from M5 so M4's pure
  logic has a home before the client exists. No `@kumulo/upcloud` dependency
  is added until T5.1. [D2, N3]
- **T4.1** `uksPoolHash` over the immutable node-group fields + the
  `<pool>-<hash8>` live-name scheme and its `kumulo-pool` label. [D8, D9, R20]
- **T4.2** `diffNodePools` → `toCreate | toUpdate | toReplace | toDelete`,
  keyed on the `kumulo-pool` label, with unconfirmed immutable drift left
  alone. Property test: applying a diff and re-diffing yields empty (AC2's
  idempotence at the unit level). **[parallel with T4.3]**
  [D8, R10, AC4, AC5, N1, N2]
- **T4.3** `clusterDrift` over the creation-time-only fields (network, zone,
  plan, storage_encryption, private_node_groups) → refusal, never mutation.
  **[parallel with T4.2]** [R9, AC6]
- **T4.4** Upgrade target resolution: `NEXT_MINOR` takes the first
  `available-upgrades` entry, `LATEST_PATCH` resolves to "already current".
  [D12, R13, AC7]
- **T4.5** Ownership labels: `kumulo-config-hash` + owner stamping, validated
  against UpCloud's label key/value charset rules. [D14, R11]

_Depends on M1 (config types) only — not on M3. Can start as soon as M1 lands._

## Milestone 5 — Distro driver `@kumulo/distro-upcloud-uks`

- **T5.1** `@kumulo/upcloud` dependency added, plus `fake-uks-server.ts` (cluster, node group,
  network, router state machines with the documented `pending → running`
  transitions), mirroring `test/distro/fake-mks-server.ts`. [D13, N5]
- **T5.2** `ensureNetwork` / `deleteNetwork` (router included), ownership per
  T4.5. [R11, AC3]
- **T5.3** `ensureCluster`: find-by-name, create, poll to `running`, reconcile
  the two patchable fields; drift from T4.3 refuses. [R8, R9, AC1, AC6, N6]
- **T5.4** `ensureNodePools`: apply T4.2's diff, with D9's create-then-delete
  ordering, polling each affected group. [R10, AC4, AC5, N6]
- **T5.5** `fetchKubeconfig`, `upgrade`, `delete` (cluster → router → network,
  in that order). [R12, R13, AC3, AC7]
- **T5.6** The `ManagedDistroShape` barrel tying T5.2–T5.5 together. [R7]

_Depends on M3 (client) and M4 (pure logic). T5.2–T5.5 are sequential only
where the fake server's state machine makes them so; T5.2 and T5.5's teardown
share ordering assumptions and should land together._

## Milestone 6 — CLI wiring

- **T6.1** `UpcloudEnv` layer (token from env, client construction), mirroring
  `cli/src/mks/env.ts`. [R18]
- **T6.2** `upcloud-uks` `DistroEntry` (plan, apply, delete, kubeconfig,
  status, upgrade, labels, prefixes) and `onDistro`'s three-way branch,
  cast-free. [R18, AC1–AC7]
- **T6.3** Doctor checks: token valid, zone exists, control plane plan exists,
  node group plans exist, version supported. [R19, AC9]
- **T6.4** Env summary + error renderer entries for the new distro. [R18, R6]

_Depends on M5._

## Milestone 7 — Artifacts, live probe, docs

- **T7.1** `examples/upcloud-uks.yaml` + regenerated `kumulo.schema.json` and
  plan snapshot; full `bun run ci` green. [AC10]
- **T7.2** Gated live smoke test (skips without `UPCLOUD_API_TOKEN`):
  create → node group scale → kubeconfig → delete. Answers **Q7** (does node
  group DELETE drain?), **Q8** (4xx error body shape), **Q9** (real plan
  list), **Q10** (network delete while cluster terminates) — and each answer
  feeds back as a follow-up task if it contradicts an assumption above.
  [D13, AC1, AC3]
- **T7.3** Package READMEs, root README distro table, `memories.md` update.
  [AC10]

_T7.2 is the only task requiring a paid account; T7.1 and T7.3 do not block on
it._

## Sequencing summary

```
M1 ──┬── M4 ──┐
     │        ├── M5 ── M6 ── M7
M2 ── M3 ─────┘
```

M1 and M2 start together. M4 needs only M1; M3 needs only M2. M5 is the first
join point.

## Risks

- **Q7/Q8/Q10 are unanswered until T7.2 runs.** T5.4's replace ordering and
  T2.3's error mapping are built on documented behaviour that has not been
  observed. If the live probe contradicts them, the fix is localized to those
  two tasks — but it is a real rework risk. Running the probe earlier was
  considered and deliberately declined: no spend before the build is done.
  Accepted.
- **D9's double-billing window.** A confirmed replace runs two generations of
  a node group concurrently. Worth a loud plan-row line so nobody is surprised
  by the invoice.
- **D15 relaxes a repo-wide invariant.** If `@kumulo/upcloud` ever grows an
  import of a non-core sibling, the exception silently permits a layering
  violation. T2.1 must keep `upcloud` in the rule's `from` pattern so only
  incoming edges are exempted.
