# Intent: OVH Object Storage via cluster config

## Problem

Clusters provisioned by kumulo (currently exercised with `distro: ovh-mks`) often need
S3-compatible object storage (backups, artifacts, app data). Today that means clicking
through the OVH console or hand-driving the API — outside kumulo's declare-and-converge
model.

## Intent

Declare OVH Object Storage (S3-compatible, Swift-based "storage" product) buckets in the
cluster YAML and have `kumulo create` converge them alongside the cluster, following the
same plan/diff/apply lifecycle as node pools, DNS records, and retained volumes.

## Motivating observations

- The vendored OVH spec (`tools/ovh2openapi/specs/ovh/cloud.json`) already carries every
  needed endpoint: `/cloud/project/{sn}/region/{region}/storage` (list/create),
  `.../storage/{name}` (get/put/delete), `.../storage/{name}/policy/{userId}`,
  `/cloud/project/{sn}/user` + `.../s3Credentials` — no spec update required, only
  allowlist + regen.
- The codebase has an established module pattern for optional per-cluster capabilities
  (`dns.module: ovh|designate|none`, `volumes.module: cinder|none`) with a core port and
  a provider package; object storage fits the same shape.

## Non-goals (this feature)

- Object-level operations (upload/download/lifecycle/replication rules).
- Cold archive, Swift-native (non-S3) containers.
- Exposing credentials to workloads beyond an optional Kubernetes Secret.
- Non-OVH object storage backends (the module enum leaves room: `object_storage.module: ovh|none`).
