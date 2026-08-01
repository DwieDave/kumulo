# Scope: UpCloud object storage and block storage for UKS (LB deferred)

Status: APPROVED 2026-08-01 (LB deferred at approval).

## Decisions taken (Phase 1)

- **D1 — No new ports.** `@kumulo/storage-upcloud` implements
  `ObjectStorageProvider`; `@kumulo/volumes-upcloud` implements
  `VolumeProvider`.
- **D2 — LB deferred (approved 2026-08-01).** When it lands it will be
  CCM-driven; no `/1.3/load-balancer` client will ever be written. Nothing LB
  ships in this cut.
- **D3 — Client endpoints live in `@kumulo/upcloud`.** `/1.3/storage` and
  `/1.3/object-storage-2` join the existing hand-written client package, each
  transcribed from `upcloud-go-api` (the established contract source), each
  with its own envelope convention.
- **D4 — Config vocabulary mirrors the existing modules.**
  `volumes.module: "upcloud"` with the cinder-style `managed` list;
  `object_storage.module: "upcloud"` with the ovh-style `buckets` list plus a
  `region`.
- **D5 — One object-storage service instance per cluster**, named
  deterministically (`<cluster>-objsto`), holding all configured buckets and
  one credentials user — matching the "deterministic name, never remember
  uuids" stance the UKS network/router already uses.

## In scope

### `@kumulo/upcloud` (extend)

- `storage.ts`: list/get/create/modify/delete over `/1.3/storage` — WRAPPED
  envelopes, async `state` (`online`/`maintenance`/...), delete with
  `?backups=delete`.
- `object-storage.ts`: services, buckets, users, access keys over
  `/object-storage-2` — BARE responses, `operational_state` polling, bucket
  deletion async (`deleted` flag).
- Fake-server coverage for both, modeled from documented response samples
  (never echoing requests — this workflow's standing lesson).

### `@kumulo/volumes-upcloud` (new package)

- `VolumeProvider` impl: ensure/list/delete storages (identity via labels, not
  title), `staticPvManifest` emitting the CSI static-PV/PVC pair
  (`volumeHandle: <uuid>`, tier-matching StorageClass).
- Zone comes from the cluster config; type maps to tier and is
  replace-on-change (immutable at the API).

### `@kumulo/storage-upcloud` (new package)

- `ObjectStorageProvider` impl: ensure service instance (polled to `running`),
  ensure buckets, ensure credentials user + access key; secret captured at
  create time and handed to the secrets sink.
- Bucket delete honors the port's `BucketNotEmpty` stance.

### `distro-upcloud-uks` + core/CLI

- Config schema: volumes/object_storage unions for the UKS variant, cross-field
  rule extended: upcloud object storage requires a non-none secrets sink.
- Delete ordering: object storage service → non-retained volumes → cluster →
  network → router.
- plan/apply/doctor/delete wiring, generated JSON schema, example update.

## Out of scope (this feature)

- The load balancer / `ingress` block entirely (deferred — D2).
- Direct `/1.3/load-balancer` management, certificate bundles, floating IPs.
- Object storage custom domains, policy documents, multiple users, `stopped`
  configured_status.
- Volume expansion/resize flows, snapshots, backup rules, encrypted volumes.
- upcloud volumes/object storage for the k3s distro (config stays gated to
  provider upcloud + distro upcloud-uks).
- DNS integration for the LB hostname (existing dns modules stay untouched).

## Open questions for Phase 2

- Q1: How is the CSI sub-account's device permission granted via API for
  pre-provisioned volumes? (Docs describe the grant; exact endpoint needs a
  live probe.)
- Q2: Which object-storage region does each UKS zone map to — is `de-fra1`
  backed by a region, and is the region list stable enough to validate
  statically, or do we validate live via `GET /object-storage-2/regions`?
- Q3 (deferred with the LB): LB teardown latency after Service delete —
  revisit when the ingress cut is planned.
