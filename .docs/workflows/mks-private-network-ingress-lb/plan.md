# Plan: MKS private network + ingress load balancer

Status: M1–M6 landed except T6.3 (publish — human only). **M0 was never run**,
so D2 and Q1–Q4 are still open; everything downstream of them is built to
documentation, not observation. Each task lists its requirements. Per
`AGENTS.md` Phase 4: one task at a time, failing test first, commit per task.

Milestone order is forced by two dependencies: the network must exist before a
cluster can be created on it (R7), and the LB must exist before `target: ingress`
can resolve (R15). M0 comes first because its outcome can invalidate M3–M4.

## Milestone 0 — Spike: LB adoption on MKS — NOT RUN

Skipped: it needs a live MKS cluster and an OVH account, which no agent has.
M3–M5 shipped against the documented contract instead, so **D2 and Q1–Q4 are
still open** and T0.1–T0.4 remain the only way to close them.

- T0.1 On a throwaway MKS cluster (≥1.31): create an Octavia LB via the
  OpenStack API, create a `Service type=LoadBalancer` annotated
  `loadbalancer.openstack.org/load-balancer-id: <id>`, and confirm the CCM
  attaches listeners rather than provisioning a second LB. **Answers Q4;
  a negative result invalidates D2.** [Q4, D2]
- T0.2 Delete that Service; confirm the LB survives (upstream's
  "created outside the cluster" protection). Confirms the ownership split R14
  depends on. [Q4, R14]
- T0.3 Record the flavor vocabulary the target plan actually accepts, and
  whether the ingress controller needs proxy-protocol. [Q1, Q2]
- T0.4 Confirm Octavia tag support in the target region. [Q3]

## Milestone 1 — Network creation — DONE

Shared with k3s — N1 applies to every task here.

- T1.1 Widen `NetworkSpec`/`NetworkInfo` in
  `packages/core/src/domain/types.ts`: two subnet CIDRs in, network id + two
  subnet ids out. Pure types; no provider change yet. [R1, D1]
- T1.2 `ensureNetwork` creates both subnets and returns their ids. [R2]
- T1.3 Existing-network path re-reads subnets instead of early-returning at
  `cloud-provider.ts:113`. Property test: `ensureNetwork` twice returns equal,
  fully-populated `NetworkInfo` — the first call's create path and the second's
  lookup path must agree. [R3, N2]
- T1.4 vRack precondition check, tagged error, fails before creating anything.
  [R4]
- T1.5 Confirm k3s provisioning is unchanged by T1.1–T1.3; existing suites
  green. [N1]

## Milestone 2 — MKS network wiring — DONE

- T2.1 `network` block on `MksClusterConfig`; absent = today's behaviour.
  Update `examples/ovh-mks.{json,yaml}` + decode tests. [R5, N5]
- T2.2 `loadBalancersSubnetId` on the **distro-layer** `MksClusterConfig`
  (`packages/distro-ovh-mks/src/distro/types.ts:29` — NOT core's config-schema
  type of the same name, see R6); populate all three ids in
  `ensure-cluster.ts`'s creation payload from `NetworkInfo`. [R6]
- T2.3 Order the reconcile so the network is created before the cluster, and
  call `requireVrack` (M1/T1.4) ahead of it, gated on the `network` block —
  ungated it would refuse every MKS apply on a vRack-less project, which R5
  forbids. **R4 is only satisfied once this lands**; T1.4 shipped the check with
  no production caller, so nothing enforces the ordering yet. [R7, R4]
- T2.4 Plan-time rejection of an unappliable network change; update
  `cluster-drift.ts` and delete its now-false `:15` comment. [R8]
- T2.5 Network + subnets as plan actions. [R18]

## Milestone 3 — Floating IP + load balancer — DONE

Was gated on M0/T0.1; shipped without it.

- T3.1 Floating IP allocate/associate/release in `packages/openstack`, on the
  generated Neutron client. Provider contract tests. [R9]
- T3.2 `ensureLoadBalancer` takes VIP placement + flavor, returns
  `{ id, vip, floatingIp }`. Keep — and comment — the no-members contract.
  [R10, R14, D4]
- T3.3 `octaviaEnabled` source that works for MKS. [R11]
- T3.4 `ingress` config block + reconcile phase. [R12]
- T3.5 LB id + floating IP into `<cluster>.outputs.yaml`; assert no credentials
  are written. [R13, N6]
- T3.6 Idempotence test against an LB carrying foreign listeners: reconcile is a
  no-op and reports no drift. This is the test that encodes D2 — write it
  against a fixture mimicking what the CCM leaves behind. [R14, N2]
- T3.7 LB + floating IP as plan actions. [R18]

## Milestone 4 — `ingress` DNS target — DONE

- T4.1 Generalise `_resolveTarget` (`packages/cli/src/dns.ts:17`) from a scalar
  `apiTarget` to a target→value resolution. [R15]
- T4.2 Resolve `ingress` to the LB's floating IP; wire into `applyMks`. [R15]
- T4.3 Honest plan rows for ingress records, including when the LB is absent.
  [R16]
- T4.4 Tests: `api_server` unchanged, `ingress` resolves, unrecognised target
  still passes through literally — the current pass-through is what makes a
  mistyped target silently wrong, so pin it deliberately. [R15, N1]

## Milestone 5 — Teardown — DONE

- T5.1 Delete order: cluster → LB → floating IP → network. [R17]
- T5.2 Network always deleted, never retained; volumes/buckets keep `retain`.
  [R17, D3]
- T5.3 Test that a delete blocked by a resource still holding a port fails
  loudly rather than half-tearing the network. [R17]

## Milestone 6 — Release — T6.1/T6.2 DONE, T6.3 OPEN (human)

- T6.1 DONE. `bun run ci` green — typecheck, build, 776 tests in 170 files,
  dep-lint (715 modules), oxlint, codegen:check (11 pipelines),
  schema:check (no diff). [N3]
- T6.2 DONE. README gained a "Private network and ingress (`ovh-mks`)" section
  and an OS_* credentials note; CHANGELOG's Unreleased gained the `network`
  and `ingress` blocks, the `<cluster>.outputs.yaml` `ingress` fields, the
  `target: ingress` resolution, the teardown, and three Fixed entries. [N5]
- T6.3 Version bump + publish, so the consuming repo can pin an exact version.
  **Human only** — deliberately not done by an agent; publishing is
  irreversible and outward-facing.
