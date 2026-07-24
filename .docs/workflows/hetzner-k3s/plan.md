# Plan: k3s on Hetzner Cloud

Status: DRAFT — awaiting human approval. Each task lists its requirements.
Sequenced by real dependency; tasks marked **[parallel]** have no ordering
constraint against their sibling(s) in the same milestone.

## Milestone 1 — Config schema

- T1.1 `Provider`/`AuthMethod`/`VolumesModule`/`Addons.hcloud_csi` schema
  additions + the five cross-field filters (provider⇔api_token,
  volumes.module↔provider, hcloud_csi/cinder_csi↔provider); new
  `examples/k3s-hetzner.yaml`; decode tests for every new filter (accept +
  reject cases). [R1, R2, N8]

_No dependency on any other milestone — can start immediately, and M2 can run
in parallel with it._

## Milestone 2 — `packages/hetzner` codegen **[parallel with M1]**

- T2.1 Vendor the official spec (`https://docs.hetzner.cloud/cloud.spec.json`,
  content-hash pinned); package skeleton (`packages/hetzner`, barrel
  `src/index.ts`, dep-cruiser-compliant — core-only imports). [R3, N8]
- T2.2 Allowlist (servers, images, server_types, locations, networks,
  firewalls, ssh_keys, volumes, placement_groups, load_balancers, actions) →
  `runPipeline(..., { format: "httpapi" })` → `src/generated/hcloud.ts`;
  register in `tools/codegen/services.json`; root `specs:update:hetzner`
  script. [R3, N7]

## Milestone 3 — Auth + profile

- T3.1 Bearer-token `HttpClient` wrapper Layer (no cache/expiry, D4) + 429-
  aware bounded retry (honors `Retry-After`/`RateLimit-Reset`, falls back to
  exp-backoff+jitter). [R4, R5, N2, N5]
- T3.2 `ProviderProfile` impl: location→zone lookup table (verify all 6
  locations' zones directly against the API before hard-coding, per
  scope.md open question 3 on volume-location parity), placement-group cap
  check, volume-type allowlist, `validateHetznerConfig` mirroring
  `provider-ovh/src/profile/validation.ts`'s shape (reuses
  `validateAutoscaling`/`validateCni` unchanged). [R6, R9, N9]

_Depends on M2 (needs the generated client's `HttpClient`/types). T3.1 and
T3.2 are independently mergeable — T3.2's lookup tables/validators are pure
and don't need T3.1's transport layer to be tested._

## Milestone 4 — `CloudProvider` impl

- T4.1 `ensureNetwork` (zone derived per D2) + Hetzner firewall rule-builder
  (property-tested, N9) + `ensureSecurityGroups`. [R7, N1, N9]
- T4.2 `ensureLoadBalancer` on the native Hetzner LB product. [R7, N1]
- T4.3 `ensureServer` (server_type/image/location + placement-group
  assignment, capped per R9/T3.2) + `deleteServer`. [R7, R9, N1, N4]
- T4.4 `deleteByTag`/`listClusterResources` via uniform `label_selector`;
  `resolveImage`/`resolveFlavor` (integer-id coercion to `string`). [R7, N1]

_Depends on M3 (auth layer + profile's zone/cap logic). T4.1–T4.4 touch
different hcloud resource types and can be built/tested in parallel
**[parallel]**, sequenced for merge only._

## Milestone 5 — `VolumeProvider` impl **[parallel with M4]**

- T5.1 `ensureVolume` (10Gi-minimum round-up with a loud log line,
  enlarge-only enforced with a tagged error on shrink) /
  `listClusterVolumes` / `deleteVolume` / `staticPvManifest`. [R8, N1, N4, N6]

_Depends on M3 only, not M4 — independently mergeable alongside Milestone 4._

## Milestone 6 — Addons **[parallel with M4/M5]**

- T6.1 `hcloud-secret.ts` (flat `token`/`network` Secret) +
  `manifests/hcloud-ccm.ts` (pinned ≥ v1.30.1, `-networks` variant) +
  `manifests/hcloud-csi.ts` (`csi.hetzner.cloud`, `hcloud-volumes` default
  StorageClass). [R10]
- T6.2 `registry.ts`: `AddonSelectionInput` widened per R11 (this task's
  output is consumed by M7, not blocked by it — the widened shape can land
  with `cloudCredential` accepting only the openstack variant until M7 adds
  the hetzner branch, keeping `ovh-mks`/OVH-k3s green throughout). [R10, R11]

_Depends on M1 (needs `hcloud_csi` field) only — independent of M2–M5._

## Milestone 7 — `CloudCredentialEnv` generalization + CLI wiring

This is the highest-risk milestone (D5) — it touches the currently-working,
tested `k3s/reconcile.ts` pipeline. Existing ovh-mks/OVH-k3s tests must stay
green throughout; each task below runs its own regression pass before the
next starts.

- T7.1 Introduce `CloudCredentialEnv` port (discriminated union,
  `packages/cli/src/doctor-openstack/env.ts` area or a new shared location);
  refactor `OpenStackEnv`'s existing usage in `k3s/reconcile.ts`'s
  `_installAddons` to go through it with **zero behavior change** for
  `provider: "ovh"` — verified by the existing test suite passing unchanged.
  [R11]
- T7.2 Hetzner `CloudCredentialEnv` impl (`HCLOUD_TOKEN` via
  `requiredRedactedEnv`); `k3s/env.ts` gains `k3sCloudCredentialLayer`,
  `k3sHetznerCloudProviderLayer`, `k3sHetznerVolumeProviderLayer`, all
  provider-branched on `config.provider`. [R2, R11, N5]
- T7.3 Wire the branch into `applyK3s`/`deleteK3s`/`kubeconfigK3s`/
  `k3sStatus`'s live-Layer composition (`k3s/reconcile.ts`'s bottom-level
  exports); confirm `commands.ts` needs no new dispatch branch (R12). [R2,
  R12, R13]

_Depends on M3, M4, M5, M6 (needs the real Hetzner Layers to wire) and M1
(schema)._

## Milestone 8 — Hardening

- T8.1 End-to-end dry-run snapshot: `examples/k3s-hetzner.yaml` through
  `buildK3sPlan`, asserting the same `+`/`-`/`=` shape OVH k3s configs
  produce (R13 — no Hetzner-specific plan code needed, this proves it).
  [R13]
- T8.2 Live smoke against a real Hetzner project (manual, gated on
  `HCLOUD_TOKEN` env presence — skipped otherwise): create → plan (noop) →
  scale a worker pool → delete, confirming retain semantics (N6) and
  placement-group cap behavior (R9) against the real API. [R3–R10]

_Depends on Milestone 7._

## Dependency summary

```
M1 ──────────────────────────────┐
M2 ── M3 ── M4 ──┐                │
            └ M5 ─┤                │
M6 (needs M1 only) ┤                │
                    ├── M7 ── M8
```

Phase-4 execution: per task — detail plan here, failing test first,
implement, verify, commit (per AGENTS.md Phase 4).

Note: the sibling hetzner-dns plan (R6 dispatch refactor) also touches
`packages/cli/src/k3s/reconcile.ts`; whichever feature lands second rebases its
reconcile.ts task on the other's merged state.
