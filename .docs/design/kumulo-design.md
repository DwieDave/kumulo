# Kumulo — Design Document

**Status:** Draft v1 · **Runtime:** Node.js (TypeScript) · **Framework:** Effect.ts + @effect/cli · **License:** MIT (proposed)

A single-binary-experience CLI that creates production-ready Kubernetes clusters on OpenStack-based clouds from one YAML file — the hetzner-k3s experience, ported to the OpenStack ecosystem. No Terraform, no management cluster, credentials stay local.

Primary target for v1: **k3s on OVHcloud Public Cloud with static node pools** (manual scaling). The architecture keeps the door open for other OpenStack providers, other Kubernetes distributions, and a hand-rolled autoscaler later.

---

## 1. Goals & Non-Goals

### Goals

1. `kumulo create --config cluster.yaml` produces a working, HA-capable cluster in minutes: network, security groups, instances, (optional) Octavia LB, k3s bootstrap, kubeconfig on disk.
2. Idempotent reconciliation — re-running `create` converges toward the config; no state file, resources are discovered by tags.
3. Batteries included: OpenStack Cloud Controller Manager (Octavia LBs for `Service type: LoadBalancer`), Cinder CSI (dynamic PVs), System Upgrade Controller (k3s upgrades).
4. **Provider-agnostic core** with a thin provider profile system; OVH ships as the first, first-class profile in its own package.
5. **Distro-agnostic core** behind a `Distro` interface; k3s ships as the first implementation.
6. Generated, typed OpenStack clients from OpenAPI specs — no hand-wired endpoints.
7. Static node pools with labels/taints and a `scale` command.
8. **Beyond hetzner-k3s:** declarative DNS record management (OVH DNS / Designate) for CI/CD-driven clusters, and retained Cinder volumes with stable IDs bindable directly in k8s manifests (§3.5, §3.6).

### Non-Goals (v1)

- Autoscaling (designed-for, not implemented — see §9).
- Non-OpenStack backends (Hetzner, Proxmox, etc.).
- Managing workloads beyond the bundled addons.
- Windows nodes, GPU flavors (should "just work" as flavors, but untested).
- Multi-region / multi-cloud clusters.

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  @kumulo/cli            @effect/cli commands, TUI output     │
├─────────────────────────────────────────────────────────────┤
│  @kumulo/core           Orchestration engine                 │
│    · ConfigSchema (effect/Schema)                           │
│    · Reconciler (plan → diff → apply, tag-based discovery)  │
│    · Phases: Network → Security → LB → Nodes → Bootstrap    │
│              → Addons → Kubeconfig                          │
│    · Ports (interfaces): CloudProvider, Distro, Addon       │
├──────────────────────────┬──────────────────────────────────┤
│  @kumulo/openstack        │  @kumulo/distro-k3s               │
│  Generated clients +     │  cloud-init templates, token     │
│  CloudProvider impl      │  mgmt, HA join, kubeconfig       │
│  (Keystone, Nova,        │  retrieval, upgrade plans        │
│   Neutron, Glance,       │                                  │
│   Cinder, Octavia)       │  (future: distro-rke2,           │
│                          │   distro-talos)                  │
├──────────────────────────┼──────────────────────────────────┤
│  @kumulo/provider-ovh     │  @kumulo/addons                   │
│  OVH profile: regions,   │  Manifests + install logic:      │
│  Ext-Net, image names,   │  OCCM, cinder-csi, SUC, CNI      │
│  Octavia availability,   │  (Cilium option)                 │
│  flavor catalog, quirks  │                                  │
└──────────────────────────┴──────────────────────────────────┘
```

**Monorepo** (pnpm workspaces + turborepo or nx):

| Package | Responsibility |
|---|---|
| `@kumulo/core` | Domain model, config schema, reconciler, phase orchestration, port interfaces. Zero HTTP code. |
| `@kumulo/openstack` | Generated OpenStack API clients + `CloudProvider` implementation. Keystone auth layer. |
| `@kumulo/provider-ovh` | `ProviderProfile` for OVH: sane defaults, capability flags, credential helpers. |
| `@kumulo/distro-k3s` | `Distro` (self-managed) implementation for k3s. |
| `@kumulo/distro-ovh-mks` | `Distro` (managed) implementation for OVH Managed Kubernetes (§3.3.1). |
| `@kumulo/dns-ovh` | `DnsProvider` module for OVH DNS (§3.5). |
| `@kumulo/volumes-cinder` | `VolumeProvider` module for retained Cinder volumes (§3.6). |
| `@kumulo/addons` | Addon registry and installers (applied via kubectl-equivalent HTTP calls to the API server, no kubectl dependency — or shell out to kubectl as a pragmatic v1 fallback). |
| `@kumulo/cli` | Command definitions, output formatting, wiring of Layers. |

Everything composes through Effect **Layers**; the CLI's `main` builds the Layer graph: `ProviderProfile → KeystoneAuth → OpenStackClients → CloudProvider → Reconciler`.

---

## 3. Core Abstractions (Ports)

### 3.1 `CloudProvider` (implemented by `@kumulo/openstack`)

The only interface the reconciler talks to for infrastructure:

```ts
interface CloudProvider {
  ensureNetwork(spec: NetworkSpec): Effect<NetworkInfo, CloudError>
  ensureSecurityGroups(spec: SecGroupSpec): Effect<SecGroupInfo, CloudError>
  ensureLoadBalancer(spec: LbSpec): Effect<LbInfo, CloudError>       // optional capability
  ensureServer(spec: ServerSpec): Effect<ServerInfo, CloudError>     // idempotent by tag+name
  deleteByTag(tag: ClusterTag): Effect<void, CloudError>
  listClusterResources(tag: ClusterTag): Effect<Inventory, CloudError>
  resolveImage(ref: ImageRef): Effect<ImageId, CloudError>
  resolveFlavor(ref: FlavorRef): Effect<FlavorId, CloudError>
}
```

Although v1 has exactly one implementation (OpenStack), keeping this port honest is what makes a future `@kumulo/hcloud` or `@kumulo/proxmox` conceivable without touching core.

### 3.2 `ProviderProfile` (implemented by `@kumulo/provider-ovh`)

A *data + small logic* layer that parameterizes the OpenStack implementation. It never makes HTTP calls itself (except optional credential helpers):

```ts
interface ProviderProfile {
  name: string                                  // "ovh" | "generic"
  auth: AuthDefaults                            // keystone URL patterns, domain defaults
  capabilities: {
    octavia: (region: string) => boolean        // OVH: per-region
    floatingIps: boolean                        // OVH: Ext-Net model instead, in most regions
    volumeTypes: string[]                       // OVH: "classic", "high-speed", "high-speed-gen2"
  }
  defaults: {
    externalNetworkName: string                 // OVH: "Ext-Net"
    imageAliases: Record<string, string>        // "ubuntu-24.04" -> exact Glance name per region
    dnsServers: string[]
  }
  validate(config: ClusterConfig): Effect<void, ProfileError>   // reject unsupported combos early
}
```

A `generic` profile ships in core for vanilla OpenStack clouds (clouds.yaml-driven, no assumptions). Users on Infomaniak/OTC/private clouds use `provider: generic` and set what OVH users get for free.

### 3.3 `Distro` (implemented by `@kumulo/distro-k3s`)

The distro abstraction is deliberately narrow — it owns everything Kubernetes-flavored, and core knows nothing about k3s:

```ts
interface Distro {
  name: string                                   // "k3s"
  planBootstrap(cluster: ClusterConfig, inventory: Inventory): Effect<BootstrapPlan>
  renderUserData(role: NodeRole, ctx: NodeContext): Effect<string>   // cloud-init per node
  fetchKubeconfig(entry: SshTarget, apiEndpoint: string): Effect<Kubeconfig>
  upgradePlan(target: Version): Effect<K8sManifest[]>                // SUC plans for k3s
  validateVersion(v: string): Effect<ResolvedVersion>                // queries k3s releases
  drainAndRemove(node: NodeRef): Effect<void>                        // for scale-down
}
```

**What's realistic about "k3s-agnostic":** the infra phases (network, SGs, LB, instances) are already 100% distro-agnostic. Bootstrap, join tokens, kubeconfig location, and upgrade mechanics are distro-specific and live entirely behind this interface. RKE2 is a near-clone of k3s here (same vendor, similar cloud-init shape) and would be a small package. Talos would need a variant `renderUserData` (machine config instead of cloud-init) and a different `fetchKubeconfig` (talosctl API) — feasible, but v2+ work. **v1 ships `distro: k3s` and `distro: ovh-mks`; the enum lives in the config schema from day one.**

### 3.3.1 `distro: ovh-mks` — OVH Managed Kubernetes as a distro

Managed Kubernetes inverts the model: OVH runs the control plane and provisions the nodes, so most of our infra phases don't apply. Rather than forcing it through `renderUserData`, the `Distro` port is split into two shapes behind one discriminated union:

```ts
type Distro = SelfManagedDistro | ManagedDistro   // discriminated on kind

interface ManagedDistro {
  kind: "managed"
  name: "ovh-mks"
  ensureCluster(cfg: ClusterConfig): Effect<ManagedClusterInfo, MksError>     // create/update control plane
  ensureNodePools(cfg: ClusterConfig): Effect<void, MksError>                 // pools = MKS node pools
  fetchKubeconfig(ref: ManagedClusterRef): Effect<Kubeconfig, MksError>       // via OVH API, no SSH
  upgrade(target: Version): Effect<void, MksError>                            // OVH-driven upgrades
  delete(ref: ManagedClusterRef): Effect<void, MksError>
}
```

The reconciler branches once on `kind`:
- **`managed`:** skip Network*/Security/LB/Bootstrap phases (OVH owns them, or they're configured through MKS options like private network attachment); run `ensureCluster → ensureNodePools → Addons(subset) → DNS → Volumes → Kubeconfig`.
- **`self-managed`:** the full phase pipeline as designed.

Implementation lives in **`@kumulo/distro-ovh-mks`**, built on the **OVH API's Managed Kubernetes endpoints** (`/cloud/project/{serviceName}/kube/*`: cluster CRUD, node pools with flavor/desired/min/max autoscaling and anti-affinity, kubeconfig retrieval, updates) — clients generated via the OVH v1 conversion pipeline (§4.5). Note this distro is inherently OVH-coupled (it's their product), which is fine: the *port* stays provider-neutral; a future `distro: scaleway-kapsule` or `distro: eks` would be sibling managed distros.

**What still applies with MKS** (and is why the tool remains valuable even managed):
- `worker_pools` map 1:1 to MKS node pools — including **native autoscaling** (MKS supports min/max per pool), so the `autoscaling` config block becomes *functional* under this distro in v1, ahead of the hand-rolled k3s autoscaler.
- **DNS management (§3.5)** and **retained volumes (§3.6)** work identically — cinder-csi is preinstalled by OVH, and our generated static PVs bind the same `volumeHandle`s.
- Addons: OCCM/cinder-csi/SUC are OVH-managed → skipped; Cilium is not selectable (OVH controls CNI); other user addons still apply.
- `doctor`, plan/diff output, tagged errors, outputs file, CI/CD flow — unchanged.

**k3s vs ovh-mks decision aid** (for the "which do I start with" question):

| | `k3s` (self-managed) | `ovh-mks` (managed) |
|---|---|---|
| Control plane cost | you pay master instances | free |
| Control plane ops (etcd, upgrades, HA) | yours (tool-assisted) | OVH's |
| k3s's low resource footprint | yes | no (standard k8s) |
| Autoscaling in v1 | no (static + `scale`) | **yes (native per-pool)** |
| CNI choice | flannel/Cilium | fixed by OVH |
| Full node/OS control | yes | limited |
| Portability off OVH | high (generic OpenStack) | none |
| Tool build effort | M1–M4 | **much smaller** (one API, no bootstrap/SSH/cloud-init) |

Pragmatic sequencing option: **implement `ovh-mks` first** — it exercises the codegen pipeline, config schema, reconciler skeleton, DNS, and retained volumes with a fraction of the surface (no Keystone/Nova/Neutron needed initially), delivers autoscaling immediately, and the k3s distro then slots into an already-proven core.

### 3.4 `Addon`

```ts
interface Addon {
  name: string
  requiredCapabilities: Capability[]     // e.g. LB addon requires octavia
  manifests(ctx: AddonContext): Effect<K8sManifest[]>
}
```

Built-in addons: `openstack-ccm`, `cinder-csi`, `system-upgrade-controller`, `cilium` (optional CNI, replacing flannel). Each is toggleable in config. The OCCM/CSI addons receive a generated `cloud.conf` (Keystone app credentials, scoped minimally) injected as a Secret.

### 3.5 Pluggable DNS module (extension beyond hetzner-k3s)

DNS is a **core port with swappable implementations** — core depends only on the `DnsProvider` interface; which implementation is wired is chosen by the `dns.module` config value at Layer-composition time in `main`:

```ts
interface DnsProvider {
  ensureRecords(zone: string, records: DesiredRecord[]): Effect<void, DnsError>
  removeClusterRecords(zone: string, tag: ClusterTag): Effect<void, DnsError>
}
```

Implementations (each its own package — adding one never touches core):

| `dns.module` | Package | Backend |
|---|---|---|
| `ovh` | **`@kumulo/dns-ovh`** (v1, ships now) | OVH DNS API (`/domain/zone/*`, OVH API v1, client via §4.5 pipeline, `OvhAuthLive`) |
| `designate` | `@kumulo/dns-designate` (later) | OpenStack Designate, for generic clouds |
| `none` | built-in no-op | DNS managed elsewhere |

Records are tagged via a TXT ownership record (`kumulo.cluster=<name>`, external-dns convention) so reconcile/`delete` only ever touch records the module created — this contract is part of the *port*, so every implementation must honor it. This makes `kumulo create` in CI produce a fully reachable cluster URL with zero manual steps. See §5 for the config block.

### 3.6 Pluggable Retained-Volumes module (extension beyond hetzner-k3s)

Same pattern: a **`VolumeProvider` port** in core, implementation selected by `volumes.module`:

```ts
interface VolumeProvider {
  ensureVolume(spec: VolumeSpec): Effect<VolumeInfo, VolumeError>       // create-if-missing by tag+name
  listClusterVolumes(tag: ClusterTag): Effect<VolumeInfo[], VolumeError>
  deleteVolume(ref: VolumeRef): Effect<void, VolumeError>               // never called for retain: true
  staticPvManifest(vol: VolumeInfo, spec: VolumeSpec): K8sManifest      // pins csi.volumeHandle
}
```

| `volumes.module` | Package | Backend |
|---|---|---|
| `cinder` | **`@kumulo/volumes-cinder`** (v1, ships now) | Cinder API (create/get/list/delete join the client allowlist); works for both `k3s` (with cinder-csi addon) and `ovh-mks` (cinder-csi preinstalled by OVH) — same `volumeHandle` semantics |
| `none` | built-in no-op | dynamic provisioning only |

Behavior (port contract, implementation-independent):
- Volumes are `ensure`d before addon/workload phases; their **stable IDs** are written to the outputs file (`<cluster>.outputs.yaml`) and rendered as ready-to-apply **static PV + PVC manifests** with `persistentVolumeReclaimPolicy: Retain`, bindable directly from your k8s manifests in CI/CD — no lookup dance, no dynamic-provisioning nondeterminism for stateful workloads.
- `kumulo delete` skips `retain: true` volumes and prints what it kept; `kumulo volumes list/adopt` manages them across cluster rebuilds (`adopt` re-binds an existing volume ID into a new cluster's generated PVs).
- Dynamic provisioning via CSI remains the default for everything else; this module is for the "my database volume must outlive any cluster" case. See §5 for the config block.

---

## 4. Generated OpenStack Clients

### 4.1 Source of truth

- **Specs:** the OpenAPI 3.1 schemas generated by the OpenStack codegenerator project (published via `gtema/openstack-openapi` / opendev codegenerator build artifacts) for: **Keystone (identity), Nova (compute), Neutron (network), Glance (image), Cinder (block-storage), Octavia (load-balancer)**.
- Specs are **vendored** into `@kumulo/openstack/specs/<service>/<version>.yaml` and updated deliberately via a `pnpm specs:update` script — never fetched at build time from the network. Reproducible builds matter more than freshness.

### 4.2 Codegen pipeline (the important engineering decision)

The raw specs are enormous and microversion-annotated. Generating clients for *everything* would produce megabytes of unused types. The pipeline therefore has a **filter step**:

**Generator: the Effect OpenAPI generator** (`@effect/...` OpenAPI → `HttpApi`/`HttpApiClient` codegen). It emits idiomatic Effect artifacts — `HttpApiGroup`/`HttpApiEndpoint` definitions with `Schema` types and tagged error channels — which is exactly the contract the rest of the codebase consumes. Crucially, it supports **JSON Patch (RFC 6902) overlays**, which becomes our official spec-correction mechanism.

```
specs/<service>.json                       (vendored upstream OpenAPI 3.1)
  → 1. filter: keep only allowlisted operationIds (allowlist.json per service)
  → 2. patch:  apply patches/<service>.patch.json (RFC 6902) — fix upstream
       spec bugs, prune microversion variants down to our pinned microversion,
       tighten types (e.g. enums OpenStack leaves as string), name operations
  → 3. generate: Effect OpenAPI generator → HttpApi definitions + HttpApiClient
       + Schema types + per-endpoint tagged errors
  → 4. commit generated output (reviewed in PRs like any code)
```

**Patch policy — we never edit vendored specs.** Every deviation from upstream lives in a reviewed, commented `*.patch.json` file next to the spec. This makes `pnpm specs:update` mechanical: pull new upstream spec → re-apply patches → regenerate → diff. Patches that no longer apply fail loudly in CI, which is the desired signal that upstream changed. Each patch entry carries a `// why` comment (JSON5 in source, compiled to strict JSON) referencing the upstream bug or design decision.

The generator choice is still encapsulated in `@kumulo/openstack`: nothing outside the package imports generated code directly — it's wrapped by the `CloudProvider` implementation.

### 4.3 Operation allowlist (initial)

| Service | Operations |
|---|---|
| Keystone | issue token (password + application-credential), get catalog |
| Nova | create/get/list/delete server, list flavors, server actions (reboot), metadata/tags |
| Neutron | networks/subnets/routers/ports CRUD, security groups + rules CRUD, floating IPs (capability-gated) |
| Glance | list/get images |
| Cinder | list volume types (v1 only needs this; CSI does volume CRUD in-cluster) |
| Octavia | loadbalancer/listener/pool/member CRUD, get provisioning status |

**Microversion policy:** pin Nova to a conservative widely-deployed microversion (e.g. 2.79-era; final pin decided against OVH's deployed versions during M1) and send it explicitly on every request via `X-OpenStack-Nova-API-Version`. Never rely on "latest".

### 4.4 Auth & transport layers

```ts
// Layer graph inside @kumulo/openstack
KeystoneAuthLive:   ProviderProfile + Credentials → KeystoneAuth
  · issues scoped tokens, caches until expiry - skew
  · re-auth via Schedule on 401
  · exposes ServiceCatalog: (service, region) → endpoint URL
OpenStackHttpLive:  KeystoneAuth → HttpClient with X-Auth-Token injection,
                    retry Schedule (exp backoff, jitter, retry-on 409/429/5xx),
                    rate limiting via Effect Semaphore
NovaClientLive, NeutronClientLive, ... : OpenStackHttpLive → typed clients
```

Credentials: support (a) **Keystone application credentials** (recommended; least privilege, what OVH exposes as "OpenStack users" can be narrowed), (b) `clouds.yaml` (openstacksdk-compatible parsing, so existing OpenStack users feel at home), (c) env vars (`OS_*`).

### 4.5 OVH v1 API Spec Strategy — deterministic conversion

The OVH-native clients (`distro-ovh-mks` cluster/nodepool/kubeconfig endpoints, `provider-ovh` DNS zone endpoints) target the **OVH API v1**, which does **not** publish OpenAPI. Its machine-readable description is OVH's proprietary JSON schema format (per-section documents like `cloud.json`, `domain.json`); only the v2 API exposes OpenAPI, and the `kube`/`domain` routes are not on v2. Prior art proves conversion is tractable (ovhapi2openapi; the ovh-api-mcp project merges v1+v2 specs).

**Decision: extend the codegen pipeline with a deterministic `convert` stage rather than hand-authoring specs.** The full pipeline for OVH v1 services becomes:

```
specs/ovh/<section>.schema.json        (vendored OVH proprietary schema)
  → 0. convert: ovh-schema → OpenAPI 3.1 JSON        (in-repo converter, pure function)
  → 1. filter:  allowlisted operationIds              (same as OpenStack pipeline)
  → 2. patch:   patches/ovh/<section>.patch.json      (RFC 6902, same mechanism)
  → 3. generate: Effect OpenAPI generator → HttpApi + Schema + tagged errors
  → 4. commit generated output
```

Converter requirements:
- **Pure & deterministic:** OVH schema JSON in → OpenAPI 3.1 JSON out; identical input yields byte-identical output (stable key ordering), so regenerations diff cleanly. It lives in the repo (`tools/ovh2openapi`, TypeScript, developed TDD against vendored fixtures) — we own it rather than depending on an unmaintained external converter, but we crib the mapping rules from ovhapi2openapi.
- **Small by construction:** it only needs to handle the schema constructs actually used by the allowlisted routes (models → components/schemas, route params → parameters, `responseType` → responses, enums, format hints). Constructs we don't consume fail loudly (`ConversionUnsupported` tagged error at build time) instead of being silently guessed — YAGNI enforced by the converter itself.
- **Patches apply post-conversion**, so all semantic corrections (tightening types, naming operations, fixing OVH doc bugs) stay in the one reviewed patch mechanism — the converter performs *mechanical* translation only, never judgment calls. Judgment lives in patches.
- **Drift alarm:** `pnpm specs:update` re-fetches OVH's schema JSON; a changed upstream produces either a clean regenerated diff or a hard converter/patch failure in CI. Either outcome is the signal we want. This matters because OVH's v1 schema format carries no stability guarantee.

Auth for these clients is a distinct Layer from Keystone: **OVH service accounts (OAuth2 client-credentials)** — token endpoint + IAM-policy-scoped access, valid on both v1 and v2. Structurally a sibling of `KeystoneAuthLive` (`OvhAuthLive: OvhCredentials → OvhAuth`), with the same refresh `Schedule` and Bearer injection; the legacy AK/AS/CK request-signing scheme is deliberately not supported (KISS — service accounts cover our use case and are OVH's recommended production mechanism).

If OVH ever publishes official OpenAPI for these routes (or migrates them to v2), stage 0 is deleted and nothing downstream changes — the converter is an adapter with a planned obsolescence path.

---

## 5. Configuration Schema

Single YAML, validated by `effect/Schema` with precise error paths. Deliberately close to hetzner-k3s's shape:

```yaml
# cluster.yaml
name: prod-eu
provider: ovh                     # ovh | generic
distro: k3s                       # k3s | ovh-mks (managed, §3.3.1)
version: v1.31.4+k3s1             # validated against k3s releases

auth:
  method: application_credential  # or clouds_yaml / env
  region: GRA11

network:
  cidr: 10.0.0.0/16
  public_access: bastionless      # every node gets Ext-Net + private VLAN (OVH default)
  # public_access: nat            # future: single gateway, private-only nodes

api_server:
  high_availability: true         # → Octavia LB in front of masters (if capable),
                                  #   else kube-vip on a shared port (fallback strategy)
  allowed_cidrs: ["203.0.113.0/24"]

ssh:
  public_key_path: ~/.ssh/id_ed25519.pub
  allowed_cidrs: ["203.0.113.0/24"]

masters:
  flavor: b3-8
  count: 3                        # 1 or odd; embedded etcd
  image: ubuntu-24.04             # alias resolved by provider profile

worker_pools:
  - name: general
    flavor: b3-16
    count: 4
    labels: { workload: general }
  - name: highmem
    flavor: r2-30
    count: 2
    labels: { workload: memory }
    taints: [ "dedicated=memory:NoSchedule" ]
    autoscaling:                  # ACCEPTED by schema in v1, REJECTED at runtime
      enabled: false              # with "not yet implemented" — schema stability
      min: 2
      max: 6

dns:                              # pluggable module (§3.5)
  module: ovh                     # ovh | designate (later) | none
  zone: example.com
  ttl: 300
  records:
    - name: api.prod-eu           # → API endpoint (LB VIP / MKS URL)
      target: api_server
    - name: "*.apps.prod-eu"      # → ingress
      target: ingress

volumes:                          # pluggable module (§3.6)
  module: cinder                  # cinder | none
  retained:
    - name: postgres-data
      size_gb: 100
      type: high-speed
      retain: true                # never deleted by `kumulo delete`
      pvc:                        # generated PVC metadata for direct binding
        namespace: db
        access_modes: [ReadWriteOnce]

addons:
  cloud_controller_manager: true
  cinder_csi:
    enabled: true
    default_volume_type: high-speed
  system_upgrade_controller: true
  cni: cilium                     # flannel | cilium

k3s:                              # distro-specific escape hatch, passed through
  extra_server_args: ["--disable=traefik"]
  extra_agent_args: []
```

---

## 6. Reconciliation Model (no state file)

All created resources get:
- **Name convention:** `kumulo-<cluster>-<role>-<pool>-<index>`
- **Tags/metadata:** `kumulo.cluster=<name>`, `kumulo.role=master|worker`, `kumulo.pool=<pool>`, `kumulo.config-hash=<hash-of-relevant-spec>`

`create` (which is really `apply`):

1. **Inventory** — list all resources carrying the cluster tag (Nova servers, Neutron nets/SGs, Octavia LBs).
2. **Plan** — diff desired (config) vs actual (inventory) into a typed `Plan` (creates, deletes, no-ops; flavor/image changes = replace with explicit confirmation).
3. **Present** — print the plan (à la `terraform plan`, but readable); `--yes` skips confirmation.
4. **Apply** — execute phases in dependency order with bounded parallelism (`Effect.forEach` with concurrency limits); each resource creation is an Effect with retry + a polling `Schedule` on OpenStack async statuses (`ACTIVE`, `provisioning_status=ACTIVE`).
5. **Bootstrap** — first master initializes (`--cluster-init`), token retrieved over SSH, remaining masters/workers join via cloud-init rendered with the token + API endpoint. (Token pre-generation and full cloud-init join — no post-boot SSH orchestration for workers — is the design goal; SSH is used only against master 1 for token/kubeconfig.)
6. **Addons** — applied through the API server.
7. **Output** — kubeconfig written locally, summary printed.

`delete` = inventory by tag → delete in reverse dependency order. `scale` = edit count (flag or config) → same reconcile path.

Interrupted runs are safe: Effect's structured concurrency + the fact that every step is a tag-discoverable, idempotent `ensure*` means re-running converges.

---

## 7. CLI Surface (`@effect/cli`)

```
kumulo create   --config cluster.yaml [--yes] [--dry-run]
kumulo delete   --config cluster.yaml [--yes]
kumulo scale    --config cluster.yaml --pool general --count 6
kumulo status   --config cluster.yaml          # inventory + node health
kumulo kubeconfig --config cluster.yaml        # (re)fetch
kumulo upgrade  --config cluster.yaml          # SUC plan for new k3s version
kumulo releases [--filter v1.31]               # list k3s versions
kumulo doctor                                  # validate credentials, quotas, capabilities
```

`doctor` is worth building early: it checks Keystone auth, region capabilities (Octavia?), quota headroom vs config, image/flavor resolution — most first-run failures die here with good messages instead of mid-apply.

---

## 8. Effect.ts Leverage (why this stack)

- **Layers** = the entire plugin architecture (provider, distro, addons) with zero DI framework.
- **Schema** = config validation, API response validation, and cloud-init template inputs from one type source.
- **Schedule** = retries, token refresh, and async-resource polling declaratively.
- **Structured concurrency** = parallel node creation with clean interruption (Ctrl-C mid-create doesn't orphan half-tracked resources — everything is tag-discoverable anyway).
- **Tagged errors** — see §8.1; every failure mode is a `Data.TaggedError` in the Effect error channel, matched exhaustively at the CLI boundary.
- **@effect/cli** = free `--help`, completions, option parsing tied to Schema.
- Testing: fake `CloudProvider` Layer for reconciler unit tests; recorded HTTP fixtures for client tests; one E2E suite against a real OVH project in CI (manual trigger, cost-gated).

### 8.1 Error Model — `Data.TaggedError` throughout

No thrown exceptions, no `unknown` errors past the HTTP adapter. Errors form a small, layered taxonomy; each layer only exposes errors meaningful at its abstraction level and maps lower-level ones upward (`Effect.mapError` / `catchTags`).

```ts
// ── transport layer (@kumulo/openstack, mostly generator-emitted) ──
class HttpTransportError extends Data.TaggedError("HttpTransportError")<{ cause: unknown }> {}
class ResponseDecodeError extends Data.TaggedError("ResponseDecodeError")<{ endpoint: string; issue: ParseIssue }> {}

// ── cloud layer (CloudProvider port — what core sees) ──
class AuthenticationFailed extends Data.TaggedError("AuthenticationFailed")<{ hint: string }> {}
class QuotaExceeded       extends Data.TaggedError("QuotaExceeded")<{ resource: string; limit: number; requested: number }> {}
class ResourceNotFound    extends Data.TaggedError("ResourceNotFound")<{ kind: string; ref: string }> {}
class ResourceConflict    extends Data.TaggedError("ResourceConflict")<{ kind: string; ref: string }> {}
class CapabilityMissing   extends Data.TaggedError("CapabilityMissing")<{ capability: string; region: string; workaround?: string }> {}
class ProvisioningTimeout extends Data.TaggedError("ProvisioningTimeout")<{ kind: string; ref: string; lastStatus: string }> {}

// ── domain layer (core / distro) ──
class ConfigInvalid    extends Data.TaggedError("ConfigInvalid")<{ issues: ReadonlyArray<PathedIssue> }> {}
class PlanRejected     extends Data.TaggedError("PlanRejected")<{ reason: string }> {}
class BootstrapFailed  extends Data.TaggedError("BootstrapFailed")<{ node: string; phase: string; log: string }> {}
class AddonInstallFailed extends Data.TaggedError("AddonInstallFailed")<{ addon: string; cause: string }> {}
```

Rules:

1. **Signatures are honest:** `ensureServer: Effect<ServerInfo, QuotaExceeded | ResourceConflict | ProvisioningTimeout | AuthenticationFailed>` — the union *is* the documentation.
2. **Retryable vs terminal is encoded per tag**, not guessed from status codes at call sites: the transport layer's retry `Schedule` consults a `Retryable` type-class-style predicate keyed by tag (429/conflict-during-async → retry; quota/auth → terminal).
3. **One exhaustive `catchTags` at the CLI boundary** renders every tag to a human message + exit code (`QuotaExceeded` → "your OVH project allows N instances; this plan needs M — raise the quota or shrink pools"). Adding an error tag without a renderer is a compile error.
4. **Defects stay defects:** genuinely impossible states use `Effect.die`; they surface as bug-report prompts, never as user-error messages.

---

## 9. Autoscaling Roadmap

- **v1 (yours):** static pools + `kumulo scale`. Config schema already carries `autoscaling` blocks (rejected at runtime) so future enablement isn't a breaking change.
- **v1.x — hand-rolled autoscaler (`@kumulo/autoscaler`):** a small controller Deployment shipped as an addon. Watches for unschedulable pods → maps to a pool via labels/taints → calls the same Nova provisioning path (packaged as a tiny in-cluster service using the same generated clients) → scales within min/max; scale-down on sustained low utilization with drain via the `Distro` port. This avoids upstream cluster-autoscaler entirely.
- **v2 option:** contribute a raw-Nova cloudprovider to upstream cluster-autoscaler. Bigger effort, broader ecosystem value; only if the hand-rolled one proves insufficient.

---

## 10. Key Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Generated-spec drift/gaps (Neutron's extension model is messy) | Vendored specs + allowlist + response `Schema` validation in *lenient* mode by default (log, don't fail, on extra fields) |
| OVH v1 proprietary schema format changes without notice (no stability guarantee) | Deterministic in-repo converter (§4.5) fails loudly on unknown constructs; vendored schemas + CI drift check on `specs:update` |
| Octavia unavailable in a chosen OVH region | Capability check in `doctor`/`validate`; kube-vip fallback for API HA documented v1, implemented v1.x |
| OVH image/flavor naming churn | Alias table in `provider-ovh` with per-region overrides; `resolveImage` falls back to fuzzy Glance search with a warning |
| Microversion mismatches across clouds (generic profile) | Explicit pin + `doctor` verifies the cloud accepts it |
| cloud-init size limits / secrets in user-data | Join token is the only secret in user-data (same as hetzner-k3s); keep templates < 16KB; gzip+base64 if needed |
| SSH dependency for master-1 bootstrap | Minimized to token+kubeconfig fetch; evaluate Nova console/metadata alternatives later |

---

## 11. Engineering Principles

- **TDD:** the reconciler and distro logic are developed test-first against fake `CloudProvider`/`DnsProvider` Layers (Effect makes substituting these trivial — no mocking framework). Every bug fix lands with a failing test first. Generated clients are exempt from TDD (they're generated) but covered by fixture-replay tests and Schema round-trips.
- **DRY:** one source of truth per concern — types come from Schema, endpoint shapes from patched specs, provider quirks from the profile. The JSON-patch pipeline exists precisely so spec fixes aren't duplicated into hand-written code.
- **KISS:** no state file, no plugin discovery/registry magic (Layers are wired explicitly in `main`), no premature config surface. Shelling out to `kubectl` for addon apply in v1 is acceptable KISS over an in-house k8s client.
- **SOLID:** the ports in §3 are the interface-segregation/dependency-inversion story; packages depend inward on `core` only (enforced by dependency-cruiser). Open/closed shows up as "new provider/distro = new package, zero core changes."
- **YAGNI, applied selectively:** we *do* pre-carve the `Distro`/`ProviderProfile` seams and the `autoscaling` schema block (cheap now, breaking later) — but we do **not** build the second distro, the second cloud backend, floating-IP/NAT topologies, or upstream cluster-autoscaler integration until someone needs them. When principle conflicts arise: KISS beats DRY, shipped beats perfect.

## 12. Milestones

- **M1 — Clients & auth (1–2 wk):** codegen pipeline, Keystone layer, `doctor` against a real OVH project.
- **M2 — Single-node create/delete (1–2 wk):** network, SG, one master, cloud-init k3s, kubeconfig. The demo moment.
- **M3 — Pools & HA (2 wk):** worker pools, 3-master etcd, Octavia LB, `scale`, plan/diff output.
- **M4 — Addons (1–2 wk):** OCCM, cinder-csi, SUC, Cilium option; `upgrade`.
- **M4.5 — Extensions (1–2 wk):** `DnsProvider` (OVH DNS client via the same codegen pipeline), retained volumes + outputs file + static PV generation.
- **M5 — Polish & release (1 wk):** generic profile, docs, npm publish (+ single-file build via `bun build --compile` or Node SEA for the "single binary" feel).

**Alternative track (MKS-first):** M1′ ovh2openapi converter (TDD, fixtures) + codegen + OVH OAuth2 service-account auth Layer + `doctor` (1–2 wk) → M2′ `ovh-mks` create/delete/kubeconfig + node pools incl. native autoscaling (1–2 wk) → M3′ DNS + retained volumes (1 wk) → then the k3s track (original M1–M4) lands on a battle-tested core. Both tracks share nearly all of core; the choice is which distro proves it first.

---

## Appendix A — Package dependency graph

```
cli → core → (ports: CloudProvider, ProviderProfile, Distro, DnsProvider, VolumeProvider, Addon)
openstack → core (implements CloudProvider) ; depends on generated clients
provider-ovh → core (implements ProviderProfile)
distro-k3s → core (implements Distro, self-managed)
distro-ovh-mks → core (implements Distro, managed)
dns-ovh → core (implements DnsProvider)
volumes-cinder → core (implements VolumeProvider)
addons → core (implements Addon) ; distro-agnostic manifests
```

Module selection (`dns.module`, `volumes.module`, `distro`, `provider`) maps config values to Layers in `cli/main` — explicit wiring, no runtime plugin discovery (KISS).

Core depends on nothing but `effect`. All arrows point inward — hexagonal, enforced with dependency-cruiser in CI.

## Appendix B — Naming

**Decided: Kumulo** (K-swapped *cumulus*; Esperanto for "cumulus/heap" — cloud-neutral, distro-neutral, no crowded `kube-` prefix). Binary `kumulo`, npm scope `@kumulo/*`, GitHub org `kumulo`. Before first publish: verify npm org + package name, GitHub org, domain (kumulo.dev), and run a trademark scan against cloud-adjacent names (Cumulo9, Kumolus) for conflicts in developer tooling.
