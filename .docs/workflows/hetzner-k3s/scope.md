# Scope: k3s on Hetzner Cloud

Status: DRAFT — pending human approval.

## In scope

1. **Config schema** (`packages/core/src/config/schema.ts`):
   - `Provider` gains `"hetzner"`.
   - `AuthMethod` gains `"api_token"` (Hetzner's single static Bearer token
     doesn't fit `application_credential`/`clouds_yaml`/`env`). Cross-field
     filter: `provider: "hetzner"` ⇔ `auth.method: "api_token"`.
   - `VolumesModule` gains `"hcloud"`. Cross-field filter:
     `volumes.module: "hcloud"` ⇒ `provider: "hetzner"`, and
     `volumes.module: "cinder"` ⇒ `provider !== "hetzner"`.
   - `Addons` gains a sibling `hcloud_csi: { enabled: boolean }` field next to
     the existing `cinder_csi` (no rename — see D3). Cross-field filter:
     `hcloud_csi.enabled` ⇒ `provider: "hetzner"`;
     `cinder_csi.enabled` ⇒ `provider !== "hetzner"`.
   - `auth.region` is reinterpreted per-provider: OpenStack region code for
     `ovh`/`generic`, Hetzner **location** code (`fsn1`, `nbg1`, `hel1`,
     `ash`, `hil`, `sin`) for `hetzner`. No new field — same string, new
     provider-specific validator (`packages/hetzner`'s profile).
   - `Masters.image`/`WorkerPool.flavor` reused unchanged as Hetzner image
     name and server-type name respectively (already plain strings; worker
     pools share the masters' image today, confirmed in `k3s/plan.ts` — that
     convention carries over unchanged).
   - `ManagedVolume.type` reused; Hetzner's profile validator restricts it to
     a fixed allowlist (Hetzner has one volume product, no named tiers).
   - This is the feature that makes `config.provider` load-bearing for the
     first time — cross-field filters above are the mechanism.

2. **Core ports** (`packages/core/src/ports`) — reused as-is:
   `CloudProvider`, `VolumeProvider`, `ProviderProfile`, `validation.ts`
   (`validateAutoscaling`/`validateCni`), all existing tagged errors
   (`AuthenticationFailed`, `QuotaExceeded`, `ResourceNotFound`,
   `ResourceConflict`, `CapabilityMissing`, `ProvisioningTimeout`). One
   optional, backward-compatible loosening flagged as OPEN — see
   requirements.md D6.

3. **New package `packages/hetzner`** (single package — D1): hcloud API
   client (codegen'd from the official OpenAPI spec, httpapi pipeline shape
   mirroring `packages/openstack`), Bearer-token auth layer with 429-aware
   bounded retry, `ProviderProfile` impl (locations, network zones,
   placement-group cap, volume-type allowlist), `CloudProvider` impl
   (network/security-groups/load-balancer/server/inventory/deleteByTag via
   `label_selector`), `VolumeProvider` impl, a Hetzner Firewall
   rule-builder (parallel to `buildFr57Rules`, different rule shape).

4. **Addons** (`packages/addons/src`): `hcloud-secret.ts` (flat `token` [+
   optional `network`] Secret named `hcloud` in `kube-system`, parallel to
   `cloud-conf.ts`), `manifests/hcloud-ccm.ts` (pinned ≥ v1.30.1, per the
   2026-07-01 breaking-change/`:latest`-deletion currency note),
   `manifests/hcloud-csi.ts` (provisioner `csi.hetzner.cloud`, StorageClass
   `hcloud-volumes`). `registry.ts` wiring gated on `addons.hcloud_csi`/
   `addons.cloud_controller_manager` + `config.provider === "hetzner"`.

5. **CLI wiring** (`packages/cli/src`): `k3s/env.ts` provider-branches
   `CloudProvider`/`VolumeProvider`/(new) `CloudCredentialEnv` layer
   construction on `config.provider`; `HCLOUD_TOKEN` read via
   `Config.redacted` (same `requiredRedactedEnv` helper `mks/env.ts` already
   has). `k3s/reconcile.ts`'s hard `OpenStackEnv` R-channel dependency is
   generalized into a provider-agnostic `CloudCredentialEnv` port so the
   addon-secret phase works for both providers without a parallel reconcile
   file — see requirements.md D5 (the largest structural task in the plan).
   `commands.ts`'s existing `_isK3s(config)` dispatch needs no new branch;
   the provider split happens inside the k3s path, same shape as
   `_isOvhStorage` gating object storage independently of distro.

6. **Codegen pipeline**: `packages/hetzner/{specs,allowlists,patches,scripts,
   src/generated}` mirroring `packages/openstack`; vendored spec fetched from
   `https://docs.hetzner.cloud/cloud.spec.json` via a new
   `specs:update:hetzner` root script; registered in
   `tools/codegen/services.json` (httpapi format) so `bun run codegen:check`
   (part of `bun run ci`) catches drift.

7. Tests in line with repo conventions: property tests for the Hetzner
   firewall-rule builder and the pure diff pieces, schema decode tests for
   the new cross-field filters, generated-client regen gate, fake-hcloud-API
   provider tests (mirroring `openstack`'s provider test shape).

## Out of scope

- Hetzner DNS module, Hetzner Robot/dedicated servers.
- Multi-location clusters; cross-zone private networking (Hetzner networks
  are bound to one network zone, all member locations must share it — v1
  derives the zone from the single `auth.region` location and never spans
  zones).
- Automatic placement-group splitting past the 10-server cap (loud failure
  instead, D7).
- `doctor-hetzner`.
- Volume type variety (Hetzner has one product; no `high-speed`-style tiers).
- Rotating/refreshing `HCLOUD_TOKEN`.
- Any change to `distro-k3s`, `distro-ovh-mks`, `ovh-mks` CLI paths, or the
  already-shipped OVH object-storage feature (`storage-ovh`,
  `secrets-sops`) — those are done, unrelated surfaces.

## Open questions carried into requirements.md as (OPEN)

1. Whether `ProviderProfile.defaults.externalNetworkName` should become
   optional (Hetzner has no ext-net concept at all) — see D6.
2. Whether the placement-group 10-server cap should hard-fail
   (`QuotaExceeded`) or auto-split into multiple groups per pool in v1 — D7
   recommends hard-fail, flagged OPEN because it changes what a large
   `worker_pools[].count` config can express.
3. Per-location availability of Hetzner Volumes (research didn't
   conclusively confirm parity with server/network locations) — needs a
   direct-from-hcloud-API verification step (task-level, in plan.md M3)
   before the profile validator hard-codes "always available."
