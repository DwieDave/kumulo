# Intent: UpCloud object storage and block storage for UKS (LB deferred)

Status: APPROVED 2026-08-01 (LB deferred at approval). (Phases 1–3 drafted in one pass at the
human's explicit request, 2026-08-01.)

## Problem

`distro: "upcloud-uks"` ships with every optional module hard-wired to `none`:
`volumes` is pinned to the `none` literal in the config schema, `object_storage`
only offers the OVH module, and there is no ingress/load-balancer story at all.
An UpCloud cluster therefore cannot express what the OVH paths already can —
managed buckets with credentials sinked to sops, pre-provisioned volumes with
static PV/PVC manifests, and a managed load balancer in front of the cluster.

## Intent

Close two gaps for `provider: "upcloud"` (the load-balancer gap is DEFERRED —
approved 2026-08-01: the CCM/Service path is the right shape, but it ships in a
later cut):

1. **Object storage** — a `module: "upcloud"` variant of the existing
   `object_storage` block, implemented as `@kumulo/storage-upcloud` against the
   existing `ObjectStorageProvider` port, over UpCloud's Managed Object Storage
   v2 API (`/1.3/object-storage-2`).
2. **Block storage** — a `module: "upcloud"` variant of `volumes` (UKS only),
   implemented as `@kumulo/volumes-upcloud` against the existing
   `VolumeProvider` port, over `/1.3/storage`, emitting static PV/PVC manifests
   for the CSI driver UKS preinstalls (`storage.csi.upcloud.com`).

No new ports. Both are adapters to the existing `ObjectStorageProvider` and
`VolumeProvider` ports.

## Research findings that shape the design

Full findings live in requirements.md; the intent-level ones:

- **Three different envelope conventions in one vendor API.** `/1.3/storage`
  wraps (`{"storage": {...}}`, list `{"storages": {"storage": [...]}}`);
  `/object-storage-2` and `/load-balancer` are bare. The upcloud-uks workflow
  already burned once on assuming a sibling's envelope — every new endpoint's
  shape is transcribed from `upcloud-go-api` structs, never inferred.
- **UKS preinstalls the UpCloud CSI driver** with StorageClasses
  `upcloud-block-storage-{maxiops,standard,hdd}` (maxiops is cluster default,
  `reclaimPolicy: Retain`, expansion allowed). Pre-provisioned volumes are
  imported by a static PV with `driver: storage.csi.upcloud.com` and
  `volumeHandle: <storage-uuid>` — same shape as the cinder module's manifest
  path. One UpCloud-only extra step: the cluster's CSI sub-account must be
  granted device permission on the storage before import (Q1).
- **UKS bundles a Cloud Controller Manager** that provisions/updates/deletes a
  Managed LB from `Service type=LoadBalancer` via the
  `service.beta.kubernetes.io/upcloud-load-balancer-config` annotation. Manual
  API edits to a CCM-managed LB are overwritten. Driving the LB API directly
  would fight the platform; the CCM path is the idiomatic one and removes an
  entire client surface from scope.
- **Managed Object Storage is region-scoped, not zone-scoped** (`europe-1`
  etc., each region backed by one primary zone). A service instance is an
  async resource (`operational_state` polling, like UKS clusters), and the S3
  `secret_access_key` is returned exactly once, at access-key creation — which
  is precisely the existing "ovh buckets require a real secrets sink" rule.
- **Teardown ordering grows two new edges.** CCM-created LBs survive cluster
  deletion, and an SDN network cannot be deleted while an LB is attached — so
  `delete` must remove LB Services (and wait for the LB to be gone) before the
  cluster/network teardown that exists today.

## Non-goals

- The load balancer / `ingress` block entirely (deferred): when it lands it
  will be CCM-driven (`Service type=LoadBalancer` + config annotation), never
  a direct `/1.3/load-balancer` client — same API/token, but UpCloud
  overwrites API edits on cluster-managed LBs and the CCM already reconciles
  backend membership.
- Object-storage custom domains, policies beyond the single credentials user,
  static websites.
- Volume snapshots, backups, cloning, encryption StorageClasses.
- Any change to the k3s or ovh-mks paths.
