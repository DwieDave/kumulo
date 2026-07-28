# Intent: UpCloud Managed Kubernetes (UKS) as a third distro

Status: DRAFT — pending human approval.

## Problem

kumulo has two distros today: `k3s` (self-managed, on OVH OpenStack or Hetzner
Cloud) and `ovh-mks` (managed, OVH-only). Both managed-control-plane options a
European user has are therefore one vendor's. UpCloud sells a managed
Kubernetes service (UKS) across 15 zones on a single flat REST API with a
static Bearer token, and it fits kumulo's `ManagedDistroShape` port without any
port changes.

## Intent

Add `distro: "upcloud-uks"` with `provider: "upcloud"`: a hand-written Effect
client for the UpCloud 1.3 API (`@kumulo/upcloud`), a managed distro driver
(`@kumulo/distro-upcloud-uks`) that converges a UKS cluster, its node groups
and the SDN network/router the cluster requires, and the CLI wiring
(env, plan, apply, delete, status, upgrade, doctor) so an UpCloud cluster runs
through the same declare-plan-apply lifecycle as `ovh-mks`.

## Research findings that shape the design

### There is no official OpenAPI spec — this is the one real divergence

- `developers.upcloud.com/1.3/` is prose documentation only. No
  `openapi.json`/`.yaml` is published anywhere on the site or in the
  `UpCloudLtd` GitHub org (`gh api search/code 'org:UpCloudLtd openapi in:path'`
  → 0 results; same for `swagger in:path`).
- The only spec that exists is community-maintained `kaleho/upcloud-api-spec`
  (Swagger 2.0, unmaintained, predates UKS entirely — it covers servers,
  storages, IPs and firewall rules only). The `upcloud-php-api`,
  `upcloud-java-api` and `upcloud-javascript-api` clients were swagger-codegen'd
  from that spec and have been untouched since 2021, so they carry no UKS.
- The maintained clients — `upcloud-go-api`, `upcloud-cli`,
  `terraform-provider-upcloud` — are all hand-written Go. `upcloud-go-api`'s
  `upcloud/kubernetes.go` is the de-facto machine-readable contract for UKS and
  is the reference we transcribe from.
- Consequence (decided, D1): kumulo hand-writes the client instead of
  generating it. Every other client in this repo is generated from a vendored
  spec, so this is a deliberate, documented exception, not drift.

### The managed-distro model fits without port changes

`ManagedDistroShape` needs `ensureCluster`, `ensureNodePools`,
`fetchKubeconfig`, `upgrade`, `delete`. UKS provides all five directly:

| Port member        | UKS API                                                          |
|--------------------|------------------------------------------------------------------|
| `ensureCluster`    | `POST/GET/PATCH /1.3/kubernetes[/{uuid}]`                          |
| `ensureNodePools`  | `POST/GET/PATCH/DELETE /1.3/kubernetes/{uuid}/node-groups[/{name}]` |
| `fetchKubeconfig`  | `GET /1.3/kubernetes/{uuid}/kubeconfig` (YAML in `kubeconfig`)      |
| `upgrade`          | `GET .../available-upgrades` + `POST .../upgrade` (`version`, `strategy`) |
| `delete`           | `DELETE /1.3/kubernetes/{uuid}`                                     |

Cluster creation takes `name`, `zone`, `network` (UUID), `network_cidr`,
plus optional `plan` (control plane, default `dev-md`), `node_groups`,
`private_node_groups`, `control_plane_ip_filter`, `labels`,
`storage_encryption`. Node groups take `name`, `count`, `plan`, `labels`,
`taints`, `kubelet_args`, `ssh_keys`, `storage`, `anti_affinity`,
`utility_network_access`. States are explicit (`pending`/`running`/…), so
`pollUntil` from core works unchanged.

### Networking is a creation-time prerequisite, exactly like MKS's vRack

`network` and `network_cidr` are **required** at cluster creation and the
network must already exist in the same zone. So kumulo creates it:
`POST /1.3/network` (`name`, `zone`, `ip_networks.ip_network[]` with
`address`, `dhcp`, `family`, optional `gateway`, `router`), `/1.3/router` for
the attached router. Prefix length is bounded /8–/29 and several ranges are
excluded (100.64.0.0/10, 127/8, 224/4, 169.254/16) — worth validating in
schema rather than discovering at apply time.

### Availability and capability facts

- UKS is available in **all** UpCloud zones (15 locations, incl. de-fra1,
  fi-hel1/2, nl-ams1, uk-lon1, es-mad1, pl-waw1, se-sto1, us-*, sg-sin1,
  au-syd1) — no region gymnastics like OVH's DE1-vs-DE object-storage split.
- Node groups use standard Cloud Server plans, plus `custom_plan`,
  `cloud_native_plan` and `gpu_plan` object variants.
- **Autoscaling is not an API field.** OVH's nodepool resource carries
  `autoscale`/`minNodes`/`maxNodes` (see `Cloud_ProjectKubeNodePoolUpdate` in
  `distro-ovh-mks`'s generated client), so kumulo declares the intent and OVH
  runs the autoscaler. UKS's node group has no such field — scaling *is*
  `PATCH count`. UpCloud's autoscaler is the upstream Kubernetes
  Cluster Autoscaler, installed by the operator into their own cluster from
  `UpCloudLtd/autoscaler`'s manifests (kubectl, not helm), with min/max in its
  `--nodes` flags and a `upcloud-autoscaler` secret in `kube-system`. It then
  PATCHes `count` through the same public API kumulo uses.
  Three consequences: `distroCapabilities["upcloud-uks"].autoscaling` is
  `false`; a config carrying `worker_pools[].autoscaling` is rejected by
  `validateAutoscaling` (whose message is hardcoded to k3s today and needs to
  name the distro); and if an operator installs it anyway, it and kumulo both
  own `count` — perpetual plan drift. Reconciling that ownership is its own
  feature, not a flag.
  Note also that UpCloud's autoscaler manifest wants a *username/password*
  secret, i.e. the basic auth UpCloud documents as discouraged, not a `ucat_`
  token.
- CNI is not selectable (Cilium is UpCloud's) → `selectableCni: false`.
- UpCloud sells **no DNS product**. `dns.module` stays `none | ovh | hetzner`
  for UpCloud clusters (D4) — same as a Hetzner-compute cluster keeping an OVH
  zone.
- Storage: UKS ships `upcloud-csi` itself, so `volumes.module` is `none` for
  this distro; no Cinder, no hcloud volumes.
- Auth: `Authorization: Bearer ucat_…` API tokens. Basic auth still works but
  UpCloud documents it as discouraged and slated for removal — tokens only.

### Things this touches in existing code

- `packages/core/src/config/schema.ts`: `Provider` gains `"upcloud"`, and
  `isAuthMethodConsistentWithProvider` ("`api_token` **iff** hetzner") must
  become a per-provider allowed-methods map — UpCloud is the second
  token-authenticated provider and would fail that rule today (D5).
- `DistroKind`, `distroCapabilities`, `ClusterConfig` union,
  `packages/cli/src/distro/registry.ts` (`onDistro`'s two-way branch becomes
  three-way), `kumulo.schema.json`, examples + plan snapshots.

## Non-goals (this feature)

- `distro: "k3s"` on UpCloud (needs a full `CloudProvider`: servers, firewall,
  SSH keys, floating IPs — a separate feature).
- `object_storage.module: "upcloud"` — UpCloud Managed Object Storage is
  S3-compatible and would mostly transfer from `storage-ovh`, but it is its own
  workflow.
- Private node groups + NAT gateway (`/1.3/gateway`) and an UpCloud Load
  Balancer for ingress. Deferred to a follow-up (see scope.md).
- Deploying the cluster-autoscaler as a kumulo addon.
- A codegen path for UpCloud (revisit if UpCloud ever publishes a spec).

## Sources

- [UpCloud API 1.3 — Managed Kubernetes](https://developers.upcloud.com/1.3/20-managed-kubernetes/)
- [UpCloud API 1.3 — Networks](https://developers.upcloud.com/1.3/13-networks/)
- [UpCloud API 1.3 — API Tokens](https://developers.upcloud.com/1.3/24-api-tokens/)
- [upcloud-go-api `upcloud/kubernetes.go`](https://github.com/UpCloudLtd/upcloud-go-api)
- [UKS availability](https://upcloud.com/docs/products/managed-kubernetes/availability/)
- [UKS autoscaling](https://upcloud.com/docs/products/managed-kubernetes/autoscaling/)
- [uks-instructions](https://github.com/UpCloudLtd/uks-instructions)
- [kaleho/upcloud-api-spec (community, stale)](https://github.com/kaleho/upcloud-api-spec)
