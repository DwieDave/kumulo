# Requirements: MKS private network + ingress load balancer

Status: DRAFT — phases 1–3 drafted in one pass at the human's explicit request
(2026-07-27), superseding the per-phase approval gates in `AGENTS.md`.

## Functional requirements

- **R1 — Network spec/info.** `NetworkSpec` carries `cidr`, `nodes_subnet` and
  `load_balancers_subnet`; `NetworkInfo` returns the network id plus both subnet
  ids (`packages/core/src/domain/types.ts:13-19`). Both subnets are explicitly
  configurable — neither is derived from the other (D1).
- **R2 — Both subnets created.** `ensureNetwork`
  (`packages/openstack/src/provider/cloud-provider.ts:105`) creates the network
  and both subnets, and returns their ids. It creates exactly one subnet from
  `spec.cidr` today (`:119`).
- **R3 — Existing-network path returns subnet ids.** When a network with the tag
  name already exists, `ensureNetwork` reads its subnets and returns their ids
  rather than early-returning without them (`:113`). Two consecutive calls
  return equal, fully-populated `NetworkInfo`.
- **R4 — vRack precondition.** Missing project vRack fails with a tagged error
  naming the project and the remedy, before any network is created. Never
  produce a network the cluster cannot use.
- **R5 — MKS config.** `MksClusterConfig` gains a `network` block
  (`packages/core/src/config/schema.ts`). Absent means today's behaviour
  (no private network); present drives R1–R3.
- **R6 — MKS spec wiring.** The distro-layer `MksClusterConfig`
  (`packages/distro-ovh-mks/src/distro/types.ts:29`) gains
  `loadBalancersSubnetId` beside its existing `privateNetworkId`/`nodesSubnetId`;
  `ensure-cluster.ts:65` populates all three from `NetworkInfo`.
  **Name collision, read carefully:** this is *not* the config-schema
  `MksClusterConfig` in `packages/core/src/config/schema.ts` that R5 changes.
  Two distinct types share the name and both are in scope in
  `packages/cli/src/mks/reconcile.ts`. R5 = the user-facing config schema;
  R6 = the distro's internal cluster spec. Editing the wrong one satisfies
  neither.
- **R7 — Ordering.** Network is reconciled before the cluster: its ids are
  creation-time inputs to `Cloud_ProjectKubeCreation`.
- **R8 — Unappliable network change fails loudly.** A config whose network
  identity differs from the live cluster fails at plan time with a message that
  says *recreate*, not *retry*. MKS's update payload is
  `{ name?, updatePolicy? }` (`packages/distro-ovh-mks/src/generated/client.ts:64`),
  so no other outcome is honest. `cluster-drift.ts` updated; its now-false
  "never set by the CLI" comment (`:15`) deleted.
- **R9 — Floating IP.** Allocate from the external network, associate to a load
  balancer's `vip_port_id`, release on teardown. Uses the generated Neutron
  client; no floating-IP code exists in `packages/openstack` today.
- **R10 — Load balancer placement.** `ensureLoadBalancer`
  (`cloud-provider.ts:208`) accepts VIP subnet/network placement and a flavor,
  and returns `{ id, vip, floatingIp }`. Placement is required for MKS: the
  cluster and its LB must share a network.
- **R11 — `octaviaEnabled` for MKS.** A source that does not read
  `config.api_server.high_availability` (`packages/cli/src/provider/registry.ts:31`),
  a field MKS configs lack.
- **R12 — Ingress config + reconcile.** An `ingress` block selects whether a
  cluster gets an ingress LB; a reconcile phase converges it.
- **R13 — Outputs.** LB id and floating IP land in `<cluster>.outputs.yaml`
  beside volume ids, so a consumer can annotate a Service to adopt the LB.
- **R14 — Inert against CCM-owned children.** Once a Service adopts the LB, its
  listeners/pools/members belong to the CCM. Reconcile neither creates, prunes
  nor diffs them, and `status`/plan do not report them as drift (D2).
- **R15 — `ingress` DNS target.** `_resolveTarget` (`packages/cli/src/dns.ts:17`)
  resolves `ingress` to the ingress LB's floating IP. `api_server` behaviour is
  unchanged; an unrecognised target still passes through literally, as today.
- **R16 — Honest plan rows.** `dnsPlanActions` (`packages/cli/src/dns-plan.ts`)
  renders an ingress record's row correctly, including when the LB does not yet
  exist — it must not promise a write it cannot make.
- **R17 — Teardown order.** Delete cluster, then LB, then floating IP, then
  network. The network is deleted, never retained (D3). A delete attempted while
  a resource still holds a port on the network fails loudly rather than leaving
  a half-torn network.
- **R18 — Plan visibility.** Network, subnets, LB and floating IP appear as plan
  actions, consistent with existing `volume/`/`bucket/` rows.

## Non-functional requirements

- **N1 — k3s unchanged.** k3s shares `NetworkSpec`/`NetworkInfo`,
  `ensureNetwork` and `ensureLoadBalancer`. Its existing tests stay green and its
  provisioning behaviour is unaltered. This is the largest regression risk in
  the work.
- **N2 — Pure diffs, property-tested.** Any new diff is a pure total function,
  property-tested for idempotence and totality, per `N1` of the object-storage
  work.
- **N3 — Repo conventions.** dependency-cruiser rules pass; core imports only
  `effect`; generated clients are not hand-edited.
- **N4 — Function size.** No function over 20–30 lines; the LB/network
  reconcilers decompose into small atoms rather than growing one wide `Effect.gen`.
- **N5 — Examples decode.** `examples/ovh-mks.{json,yaml}` are updated and keep
  passing `examples/decode.test.ts`, which exists to stop exactly this drift.
- **N6 — No secrets in outputs.** `<cluster>.outputs.yaml` is not encrypted; it
  may carry ids and addresses, never credentials.

## Design choices

- **D1 — Two configurable subnets.** MKS splits `nodesSubnetId` and
  `loadBalancersSubnetId`, so kumulo models both explicitly rather than sharing
  one subnet or deriving the LB subnet from the node subnet. Keeps LB VIPs out
  of node addressing.
- **D2 — kumulo owns the LB, the CCM owns its children.** kumulo creates an
  empty Octavia LB and a floating IP; an in-cluster Service adopts it by id via
  `loadbalancer.openstack.org/load-balancer-id` and the CCM fills in listeners,
  pools and members. Upstream supports adopting an externally-created LB and
  protects it from CCM deletion. This is what makes DNS resolvable in one apply:
  kumulo allocates the address instead of discovering it.
- **D3 — Network deleted, not retained.** Fully reproducible from config, so
  retaining it would strand an unowned resource for no gain. Volumes and buckets
  retain because their contents cannot be regenerated; a network's can.
- **D4 — LB features at creation time.** OVH: "if this annotation is specified,
  the other annotations which define the load balancer features will be
  ignored." Flavor, proxy-protocol and timeouts are therefore kumulo's to set
  when it creates the LB, not the consumer's to annotate afterwards.
- **D5 — Octavia, not IOLB.** IOLB is deprecated for Kubernetes >1.31 and its
  presence blocks cluster upgrades. Target MKS ≥1.31, where Octavia is the
  default and `loadbalancer.ovhcloud.com/class` is unnecessary.
- **D6 — `privateNetworkId` is an OpenStack network id.** Confirmed against OVH
  docs; the Neutron-created network is directly usable and no OVH-specific
  network API is needed — consistent with the generated MKS client exposing no
  network endpoints at all.

## Open questions

- **Q1 — LB flavor vocabulary.** MKS Free uses
  `loadbalancer.ovhcloud.com/flavor` (S/M/L); MKS Standard uses
  `loadbalancer.openstack.org/flavor-id` (UUID). The `ingress` block's flavor
  field shape depends on which plan is targeted.
- **Q2 — Proxy protocol.** Whether the consuming ingress controller needs it.
  Per D4 it must be decided at creation, so it needs an answer before R10 is
  implemented.
- **Q3 — Octavia tag support.** Upstream gates shared-LB on Octavia supporting
  tags. Assumed present on OVH; unverified.
- **Q4 — Adoption on MKS, unverified.** Documented upstream and by OVH, never
  observed on a live MKS cluster with an LB the CCM did not create. **A negative
  result invalidates D2 and most of R9–R16.** Retire this before implementing
  Milestone 3 (see plan M0).
