# Scope — Kumulo CLI Build

Authoritative spec: `.docs/design/kumulo-design.md`. This file only fixes the boundary.

## In scope

**Workspace & tooling**
- Bun workspaces monorepo; packages: `@kumulo/core`, `@kumulo/openstack`, `@kumulo/provider-ovh`, `@kumulo/distro-k3s`, `@kumulo/distro-ovh-mks`, `@kumulo/dns-ovh`, `@kumulo/volumes-cinder`, `@kumulo/addons`, `@kumulo/cli`, plus `tools/ovh2openapi`.
- Dependency-direction enforcement (arrows inward to core), TypeScript strict, `bun test`.
- Single-file build via `bun build --compile`.

**Core (§3, §5, §6, §8)**
- Config schema (effect/Schema) per §5, incl. `autoscaling` accepted-but-rejected for k3s.
- Ports: `CloudProvider`, `ProviderProfile`, `Distro` (self-managed | managed union), `Addon`, `DnsProvider`, `VolumeProvider`.
- Tag-based stateless reconciler: inventory → plan → present → apply, phase pipeline with the managed/self-managed branch (§3.3.1).
- Tagged-error taxonomy end to end; exhaustive rendering at CLI boundary.

**Codegen (§4)**
- Vendored OpenStack OpenAPI specs; filter → patch (RFC 6902) → Effect OpenAPI generate → commit, per-service allowlists (§4.3), pinned microversions.
- `tools/ovh2openapi`: deterministic OVH v1 schema → OpenAPI 3.1 converter (TDD against vendored fixtures), then same filter/patch/generate stages.
- Auth layers: `KeystoneAuthLive` (app credentials, clouds.yaml, env) and `OvhAuthLive` (OAuth2 service accounts only).

**Distros**
- `distro-k3s`: cloud-init render, token/HA join, SSH kubeconfig fetch, SUC upgrade plans, drain/remove.
- `distro-ovh-mks`: cluster/nodepool CRUD, native per-pool autoscaling, kubeconfig via API, OVH-driven upgrades.

**Extensions & addons**
- `dns-ovh` with TXT ownership records; built-in `none` no-op. Records for api/ingress targets.
- `volumes-cinder`: retained volumes, outputs file, static PV/PVC generation, `volumes list/adopt`.
- Addons: `openstack-ccm`, `cinder-csi`, `system-upgrade-controller`, `cilium` option; kubectl shell-out acceptable for v1 apply.

**CLI (§7)**
- `create`, `delete`, `scale`, `status`, `kubeconfig`, `upgrade`, `releases`, `doctor`, `--dry-run`/`--yes`.

**Verification**
- TDD with fake provider/dns/volume Layers; fixture-replay tests for generated clients; all milestones verifiable offline.
- Final milestone: live smoke tests (`doctor`, create/delete both distros) once user supplies OVH credentials.

## Out of scope (v1 non-goals, §1)

- Autoscaling for k3s (schema present, runtime-rejected; MKS native autoscaling IS in scope).
- Non-OpenStack backends, `dns-designate`, `distro-rke2`/`talos`, NAT topology, kube-vip fallback (documented only), multi-region, Windows/GPU, workload management beyond bundled addons.
- npm/GitHub org registration, trademark scan (checklist item, not build work).
