# Requirements: k3s on Hetzner Cloud

Status: DRAFT — awaiting human approval.

## Functional requirements

- **R1 — Config schema.** `packages/core/src/config/schema.ts`:
  `Provider` → `Schema.Literals(["ovh", "generic", "hetzner"])`;
  `AuthMethod` → adds `"api_token"`; `VolumesModule` → adds `"hcloud"`;
  `Addons` gains `hcloud_csi: { enabled: boolean }`. Cross-field filters
  (style of `isVersionValidForDistro`/`isSecretsRequiredForObjectStorage`):
  `provider === "hetzner" ⇔ auth.method === "api_token"`;
  `volumes.module === "hcloud" ⇒ provider === "hetzner"`;
  `volumes.module === "cinder" ⇒ provider !== "hetzner"`;
  `addons.hcloud_csi.enabled ⇒ provider === "hetzner"`;
  `addons.cinder_csi.enabled ⇒ provider !== "hetzner"`. `examples/*.yaml`
  gains an `examples/k3s-hetzner.yaml`; existing examples fail loudly if the
  new cross-field filters would reject them (schema is total).
- **R2 — `config.provider` becomes load-bearing.** Every place that today
  unconditionally builds the OpenStack stack (`k3s/env.ts`,
  `k3s/reconcile.ts`) branches on `config.provider`. No behavior change for
  `provider: "ovh"`/`"generic"` configs — same Layers, same code paths.
- **R3 — `packages/hetzner` hcloud client (codegen).** Vendored OpenAPI spec
  (`https://docs.hetzner.cloud/cloud.spec.json`, pinned by content hash the
  way OpenStack specs are pinned by SHA) → allowlist (servers, images,
  server_types, locations, networks, firewalls, ssh_keys, volumes,
  placement_groups, load_balancers, actions — action-polling endpoints
  needed because hcloud operations are async) → `runPipeline(...,
  { format: "httpapi" })` → committed `src/generated/hcloud.ts`. Registered
  in `tools/codegen/services.json`; `bun run codegen:check` (part of
  `bun run ci`) is the regen-noop gate (N7).
- **R4 — Auth layer.** Static `Authorization: Bearer <token>` header
  injection via an `HttpClient.mapRequest`-style wrapper Layer (no token
  cache/expiry — simpler than `OvhAuthLive`'s Ref+Schedule, since the token
  never expires). Token sourced only from `HCLOUD_TOKEN` env
  (`Config.redacted`, N5), never from the config file.
- **R5 — Rate-limit resilience.** Every Hetzner API call goes through a
  429-aware bounded exp-backoff+jitter retry (mirrors `provider-ovh`'s
  `_retrySchedule`, but applied at the transport layer, not just token
  fetch — Hetzner's 429 can happen on any call, not only auth). Honors
  `RateLimit-Reset`/`Retry-After` when present, falls back to the backoff
  schedule otherwise. Bounded (finite retries), never silently drops a
  failed call.
- **R6 — `ProviderProfile` impl.** `packages/hetzner`'s profile: `capabilities
  .octavia` (port field name unchanged, reused as "load balancer available in
  this location" — Hetzner LBs are broadly available, collapses toward
  always-true pending the per-location verification in T3.1);
  `capabilities.floatingIps`/`volumeTypes` populated from verified Hetzner
  facts; `defaults.imageAliases`/`dnsServers` Hetzner-appropriate;
  `defaults.externalNetworkName` — see D6 (OPEN). `validate()` covers:
  location validity (one of the 6 known locations), network-zone derivation
  from `auth.region` (static lookup table, D2), placement-group 10-server
  cap per pool (D7), volume-type allowlist, cross-distro rules
  (`validateAutoscaling`/`validateCni`, reused unchanged).
- **R7 — `CloudProvider` impl.** `ensureNetwork` derives the Hetzner network
  zone from `auth.region` internally (D2 — no `NetworkSpec` change);
  `ensureSecurityGroups` maps to a Hetzner Firewall built from a new pure
  rule-builder (SSH/API CIDRs, intra-network allow, etcd, CNI-specific
  wireguard port when `cni: cilium`, mirroring `buildFr57Rules`'s inputs but
  Hetzner Firewall's `direction/protocol/port/source_ips` rule shape);
  `ensureLoadBalancer` on the native Hetzner Load Balancer product;
  `ensureServer` creates via server_type/image/location, assigns to a
  placement group (capped per D7), applies the `kumulo-cluster=<tag>` label;
  `deleteServer`/`deleteByTag`/`listClusterResources` use `label_selector`
  uniformly across servers/networks/firewalls/LBs/volumes (simpler than
  OpenStack's three separate tagging mechanisms); `resolveImage`/
  `resolveFlavor` resolve Hetzner image/server-type names to their integer
  ids, coerced to `string` at the port boundary (same non-issue as any
  numeric-ID API).
- **R8 — `VolumeProvider` impl.** `ensureVolume`/`listClusterVolumes`/
  `deleteVolume`/`staticPvManifest` on hcloud Volumes; enforces the 10Gi
  minimum (round up, loud log line when a requested size is rounded) and
  enlarge-only semantics at the provider boundary (a shrink request fails
  with a tagged error naming old/new size, never silently no-ops).
- **R9 — Placement-group cap.** A worker pool (or the masters pool) whose
  member count would push a placement group past Hetzner's hard 10-server
  cap fails the plan/apply loudly with a `QuotaExceeded` tagged error naming
  the pool and the cap, **before** any server is created for that pool
  (validated in `ProviderProfile.validate`, not discovered mid-apply from a
  raw hcloud 422). See D7 (OPEN on auto-split vs hard-fail).
- **R10 — Addon credential delivery.** `hcloud-secret.ts` renders a
  `Secret` named `hcloud` in `kube-system` with a `token` key (+ optional
  `network` key when private-network routing is enabled) — env-var
  delivery (`HCLOUD_TOKEN`/`HCLOUD_NETWORK`), not a mounted file, unlike
  `cloud-conf.ts`'s INI. `manifests/hcloud-ccm.ts` uses the `-networks`
  manifest variant, pinned to an explicit released tag **≥ v1.30.1** (the
  2026-07-01 `server.datacenter` field removal breaks ≤ v1.30.0; `:latest`
  was deleted upstream as broken on 2026-07-07 — never pin `:latest`).
  `manifests/hcloud-csi.ts` shares the same `hcloud` Secret, provisioner
  `csi.hetzner.cloud`, default StorageClass `hcloud-volumes`.
- **R11 — `CloudCredentialEnv` generalization (D5).** `packages/cli/src/
  doctor-openstack/env.ts`'s `OpenStackEnv` is joined by a new
  provider-tagged port, `CloudCredentialEnv`, holding a discriminated union
  (`{ provider: "openstack"; ...ini fields } | { provider: "hetzner"; token:
  Redacted<string> }`). `k3s/reconcile.ts`'s `_installAddons` depends on
  `CloudCredentialEnv` instead of `OpenStackEnv` directly.
  `addons/registry.ts`'s `AddonSelectionInput.cloudConf: CloudConf` widens
  to `cloudCredential: CloudCredentialEnv["Service"]`; `_toggledOn` picks
  `openstack-ccm`/`cinder-csi` vs `hcloud-ccm`/`hcloud-csi` manifest sets
  from the union tag. `k3s/env.ts` gains `k3sCloudCredentialLayer(config)`,
  provider-branched the same way `k3sCloudProviderLayer` will be (R2).
  Existing `provider: "ovh"` behavior (manifests, secret content, addon
  names) is unchanged — this is a refactor of the R-channel dependency
  shape, not the OVH addon output.
- **R12 — CLI dispatch.** `commands.ts`'s `_isK3s(config)` gains no new
  top-level branch; the provider split lives inside the k3s path
  (`k3s/env.ts`/`k3s/reconcile.ts`), same shape as `_isOvhStorage` gating
  object storage independently of distro. `create`/`scale`/`delete`/
  `status`/`kubeconfig` all work for `provider: "hetzner"` through the same
  entry points used for `provider: "ovh"`.
- **R13 — Live plan diffs.** Hetzner-backed clusters get the same plan
  output shape as OVH k3s clusters today (`k3s/plan.ts`'s
  `buildK3sServerSpecs`/`buildK3sPlan`, reused unchanged — it's already
  provider-agnostic, built only from `ClusterConfig` + `ServerSpec`). No
  Hetzner-specific plan code needed; the existing `+`/`-`/`=` per-node
  rendering just works once `CloudProvider` resolves.

## Non-functional requirements

- **N1 — Idempotent re-runs.** `ensureNetwork`/`ensureSecurityGroups`/
  `ensureLoadBalancer`/`ensureServer`/`ensureVolume` are create-if-missing by
  name/label, safe to call repeatedly from any partial-apply state (same
  contract `CloudProvider`/`VolumeProvider` already document). Out-of-band
  deletions are healed on the next converge (a resource missing from
  `listClusterResources` gets recreated), matching the OVH provider's
  established pattern.
- **N2 — Resilience.** Bounded retries (R5) on every hcloud call for
  transient failures (429, 5xx, connection resets) — exp-backoff+jitter,
  finite attempt cap, never an infinite retry loop. Async hcloud operations
  (server create, volume attach, etc. return an `Action` to poll) get a
  bounded polling loop with a `ProvisioningTimeout` tagged error on cap.
- **N3 — Loud, tagged failures.** No silent skips. Every failure mode
  surfaces one of the existing tagged errors (`AuthenticationFailed`,
  `QuotaExceeded`, `ResourceNotFound`, `ResourceConflict`,
  `CapabilityMissing`, `ProvisioningTimeout`) with enough context (resource
  kind + ref) to act on — no new error types anticipated (confirmed against
  Hetzner's documented error surface).
- **N4 — Per-resource logging.** Every `ensure*`/`delete*` call logs at
  resource granularity (create/reuse/delete/heal), matching the
  established OVH-path convention — needed for the placement-group cap
  (R9) and volume min-size rounding (R8) to be debuggable from CLI output
  alone.
- **N5 — Effect Config + Redacted secrets.** `HCLOUD_TOKEN` read via
  `Config.redacted` (reusing `requiredRedactedEnv` from `mks/env.ts`, same
  pattern `OVH_CLIENT_SECRET` uses); never logged, never in plan output,
  unwrapped only at the HTTP-request-building boundary (R4) — same
  discipline as OVH's `applicationCredentialSecret`.
- **N6 — Retain semantics.** `volumes.managed[].retain` honored identically
  to the Cinder path: `deleteK3sEffect`'s per-resource retain check
  (`volumes-cinder`'s existing logic) needs no Hetzner-specific change once
  `VolumeProvider` resolves to the hcloud impl — it's already provider-only
  code in `reconcile.ts`.
- **N7 — Codegen regen-noop gate.** `packages/hetzner`'s generated client
  is committed; `codegen:check` regenerates in-memory and diffs — CI fails
  on drift, same as every other `services.json` entry. No hand edits to
  `src/generated/hcloud.ts`.
- **N8 — Repo conventions.** dependency-cruiser rules pass (`packages/
  hetzner` imports only `@kumulo/core`, per `no-sibling-package-imports`;
  exports only through `src/index.ts`, per `no-deep-package-imports`);
  functions ≤ 20–30 lines; oxlint/typecheck/vitest green; `Effect<A,E,R>`
  channels kept intact everywhere (no `as never` — see AGENTS.md's Hall of
  Shame).
- **N9 — Property tests.** The Hetzner firewall rule-builder and the
  placement-group-cap check are pure functions — property-tested (e.g. rule
  builder: every input CIDR appears in exactly one rule; placement-group
  check: any count ≤ 10 always passes, any count > 10 always fails)
  alongside example-based tests for the documented edge cases.

## Design choices

- **D1 — One package, `packages/hetzner`.** Both `CloudProvider` and
  `VolumeProvider` live in one package (not OVH's forced 3-way split). The
  *reason* for OVH's split — per-service Keystone token exchange, dep-cruiser
  forcing `volumes-cinder` to re-declare its own auth port — doesn't apply:
  Hetzner is one flat API with one static token, so there's no separately-
  scoped auth to isolate. **Approved** (simpler, no forced duplication).
- **D2 — Network zone via internal lookup, not a port change.**
  `NetworkSpec{cidr}` (`packages/core/src/domain/types.ts`) is left
  untouched. The Hetzner `CloudProvider` impl derives its network zone from
  `auth.region` via a static `location → zone` table (`fsn1`/`nbg1`/`hel1` →
  `eu-central`, `ash` → `us-east`, `hil` → `us-west`, `sin` → its zone,
  confirmed at implementation time) supplied through the same
  Layer-construction-time options object OpenStack's `_cloudProviderOptions`
  already uses (`k3sCloudProviderLayer`'s equivalent for Hetzner). **Approved**
  — avoids touching a shared core domain type for one provider's constraint.
- **D3 — Sibling config field, not a rename.** `addons.cinder_csi` keeps its
  name; Hetzner gets `addons.hcloud_csi: { enabled }` (no `default_volume_type`
  — Hetzner has one volume product). Renaming `cinder_csi` to something
  generic would be a breaking change to every existing OVH config for a
  cosmetic win. **Approved.**
- **D4 — Auth: static header injection, no token-cache Layer.** Unlike
  `OvhAuthLive` (Ref + Schedule.exponential + expiry skew) or Keystone's
  token-with-catalog cache, Hetzner's Bearer token never expires — R4 is a
  plain `HttpClient.mapRequest` wrapper, no `Ref`/`Clock` involved.
  **Approved** — matches D2's "don't build machinery the API doesn't need."
- **D5 — Generalize `OpenStackEnv` into `CloudCredentialEnv` (R11).**
  Alternative considered: leave `OpenStackEnv` alone and add a fully
  parallel Hetzner-flavored `reconcile-hetzner.ts`. Rejected — `applyK3sEffect`
  /`deleteK3sEffect`/`kubeconfigK3sEffect`/`k3sStatusEffect` are otherwise
  100% provider-neutral today (confirmed by reading `k3s/reconcile.ts`); a
  parallel file would duplicate ~200 lines of correct, tested pipeline logic
  to route around one field. The discriminated-union port is the smaller,
  DRYer diff, at the cost of being the single riskiest task in the plan
  (touches a working, tested path) — **flagged as its own milestone task
  with its own regression-test bar** (plan.md M5, "existing ovh-mks/k3s-ovh
  tests must stay green"). **Approved**, given the risk mitigation.
- **D6 (OPEN) — `ProviderProfile.defaults.externalNetworkName` optionality.**
  Hetzner has no Neutron-ext-net equivalent (servers get public IPv4
  directly). Two options: (a) Hetzner's profile impl supplies a degenerate
  value (e.g. `""`) and nothing reads it on the Hetzner path — zero core
  changes, mildly smelly; (b) widen the port field to `externalNetworkName?:
  string` — one-line, backward-compatible, but touches a shared core
  interface for one provider's absence. **Recommendation: (a)** — matches
  D1/D2/D4's bias toward not touching shared core surface for a
  provider-specific absence; revisit if a third provider hits the same gap
  (then it's a real pattern, not speculative).
- **D7 (OPEN) — Placement-group cap: hard-fail vs auto-split.** Hetzner
  placement groups cap at 10 servers; a `worker_pools[].count` (or
  `masters.count`, though that's already bounded by `isOddCount` and
  realistically ≤ 7) above 10 either (a) fails the plan/apply loudly
  (R9) or (b) auto-creates a second placement group (`<pool>-2`, `<pool>-3`,
  ...) and spreads members across them. **Recommendation: (a) hard-fail for
  v1** — matches YAGNI (no config schema support for per-pool grouping
  today, and large single-pool worker counts are the less common shape);
  revisit as (b) only if a real user hits the cap with a config that can't
  reasonably be split into multiple `worker_pools[]` entries (which the
  schema already supports as a workaround — two pools of 8 instead of one
  pool of 16 gets two placement groups for free with zero new code).
- **D8 — `auth.region` reinterpretation, no new field.** Rather than adding
  a Hetzner-specific `auth.location`/`auth.hetzner_zone` field, `auth.region`
  is reused with provider-specific meaning (already the case implicitly,
  since the field's semantics were only ever "whatever the active provider's
  region concept is" — the schema never encoded a fixed vocabulary).
  **Approved** — avoids growing the schema with parallel provider-specific
  fields for what's structurally the same "where does this cluster live"
  concept.

Note: `HCLOUD_TOKEN` and the dns feature's `HETZNER_DNS_TOKEN` are both hcloud
project API tokens against `api.hetzner.cloud/v1`; a single token can serve both
(kept as separate env vars to avoid over-scoping single-feature setups).
