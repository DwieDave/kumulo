# Intent: k3s on Hetzner Cloud

Status: DRAFT — pending human approval.

## Problem

kumulo provisions k3s clusters today only on OpenStack-flavored OVH Public Cloud
(`provider: "ovh"`, compute via `@kumulo/openstack`, volumes via
`@kumulo/volumes-cinder`). Hetzner Cloud is a materially cheaper, simpler
(single flat REST API, static Bearer token, no Keystone-style service catalog)
alternative that users of the k3s distro want as a second compute target.

## Intent

Add `provider: "hetzner"` as a first-class option for `distro: "k3s"`: a
`CloudProvider` implementation on the hcloud API (servers, networks,
firewalls, load balancers, SSH keys, placement groups), a `VolumeProvider` on
hcloud Volumes, `hcloud-cloud-controller-manager` + `hcloud-csi` addons, and
CLI wiring (env, live plan diffs, apply/delete/status) so a Hetzner k3s
cluster converges through the exact same declare-and-plan-and-apply lifecycle
already established for OVH. `packages/distro-k3s` (SSH bootstrap, cloud-init,
kubeconfig, upgrade/drain) is provider-agnostic today and is reused unchanged.

## Motivating observations

- `config.provider` exists in the schema but is **dead data** today — nothing
  branches on it (`grep -rn "provider ===" packages` outside tests is empty).
  `k3s/env.ts` unconditionally wires the OpenStack stack regardless of the
  configured provider. This feature is the first thing that makes `provider`
  load-bearing, and that's a real structural change to `k3s/env.ts` and
  `k3s/reconcile.ts`, not just an enum addition.
- Hetzner publishes an official OpenAPI 3.0.3 spec directly
  (`https://docs.hetzner.cloud/cloud.spec.json`) — the same codegen shape
  `packages/openstack` already uses (vendor spec → allowlist → patch →
  `runPipeline(..., format: "httpapi")`, regen-noop gated in
  `tools/codegen/src/bin/check.ts`), not the OVH-proprietary
  `ovh2openapi`-conversion shape `dns-ovh`/`storage-ovh` use.
- Hetzner's single flat API + static token removes the *reason* OVH's stack is
  split three ways (`provider-ovh` + `openstack` + `volumes-cinder`, forced by
  dependency-cruiser's `no-sibling-package-imports` rule plus Keystone's
  per-service token-exchange). `CloudProvider` and `VolumeProvider` for
  Hetzner can plausibly live in one package — see D1.
- `packages/core/src/ports` (`CloudProvider`, `VolumeProvider`,
  `ProviderProfile`, `validation.ts`, tagged errors) are largely reusable
  as-is; the OpenStack-flavored shapes in `ProviderProfile.defaults`
  (`externalNetworkName`) and the OpenStack-specific addon credential
  (`OpenStackEnv`, `cloud-conf.ts`) are the two places genuine divergence
  shows up. See scope.md / requirements.md D-items.
- `packages/distro-k3s` is confirmed provider-agnostic by grep (no
  openstack/ovh/OS_/nova/cinder references in its `src/`) — zero changes
  needed there.

## Non-goals (this feature)

- A Hetzner DNS module (`dns.module: hetzner` is handled by the sibling
  `.docs/workflows/hetzner-dns` workflow, against the same `api.hetzner.cloud/v1`
  API this feature targets — existing `dns.module: ovh` still
  works for a Hetzner-compute cluster if the user keeps their zone on OVH).
- `distro: "ovh-mks"` on Hetzner (MKS is an OVH-managed product; not portable).
- Multi-location/multi-region clusters, cross-zone private networking.
- A `doctor-hetzner` diagnostics command (YAGNI for v1; `doctor-openstack` is
  the precedent if wanted later).
- Automatic placement-group splitting once a worker pool exceeds Hetzner's
  hard 10-servers-per-group cap (v1 caps and fails loudly instead — see
  requirements.md R9/D7).
- Hetzner Robot (dedicated server) support, Hetzner Floating IPs beyond what's
  needed for the load-balancer/server IP model already covered by the
  existing `LbInfo`/`ServerInfo` port shapes.
- Rotation/refresh of `HCLOUD_TOKEN` (static token, same as OVH's
  application-credential — provided once via env, no expiry to manage).
