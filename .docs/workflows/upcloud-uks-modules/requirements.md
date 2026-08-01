# Requirements: UpCloud object storage and block storage for UKS (LB deferred)

Status: APPROVED 2026-08-01 (LB deferred at approval). Sources: developers.upcloud.com 1.3
docs, `upcloud-go-api` structs (the de-facto contract, per the upcloud-uks
workflow's D1), `upcloud-csi`, `upcloud-cloud-controller-manager`,
terraform-provider-upcloud. Researched 2026-08-01.

## Design decisions

- **D1 (ports)** — no new ports; implement `ObjectStorageProvider` and
  `VolumeProvider`; ingress is distro-internal.
- **D2 (LB deferred, approved 2026-08-01)** — the ingress/LB block ships in a
  later cut. Verified: `/1.3/load-balancer` is the same API and token as
  everything else, but a CCM-managed LB rejects out-of-band edits and a
  standalone LB would make kumulo reimplement CCM's backend-member sync — so
  the future design stays CCM-driven (`Service type=LoadBalancer` +
  `service.beta.kubernetes.io/upcloud-load-balancer-config` annotation).
  Nothing LB-related is built now.
- **D3 (envelopes are per-endpoint facts)** — `/1.3/storage` wraps
  (`{"storage": {...}}`, `{"storages": {"storage": [...]}}`);
  `/object-storage-2` is bare. Transcribe each from
  `upcloud-go-api` (`storage.go`, `managed_object_storage.go` + request
  types); fake servers reproduce the documented response shapes.
- **D4 (volume identity by label)** — storage `title` is not unique; kumulo
  stamps `labels` (cluster tag + managed-volume name) and finds its volumes by
  label, mirroring how UKS node groups are found by the `kumulo-pool` label.
- **D5 (volume type = tier, replace-on-change)** — config `type` is
  `maxiops|standard|hdd` (validated enum, unlike cinder's free string because
  UpCloud's tiers are closed). Tier and zone are immutable at the API; a type
  change is a refused drift / confirmed replace, like UKS immutable fields.
- **D6 (one object-storage service per cluster)** — deterministic name
  `<cluster>-objsto`, `configured_status: "started"`, one private network
  attachment on the cluster's SDN network plus one public attachment; all
  buckets and one IAM user (`<cluster>-kumulo`) live inside it.
- **D7 (secret handled once)** — `secret_access_key` exists only in the
  access-key create response. `ensureCredentials` creates user+key on first
  run and hands `S3Credentials` straight to the secrets sink; a re-run that
  finds the key present but the sink file missing rotates the key (delete +
  recreate) rather than failing.
- **D8 (object storage is region-scoped)** — config carries an explicit
  `region` (like ovh buckets carry theirs) because zone→region inference would
  manufacture 404s; validated live against `GET /object-storage-2/regions` in
  doctor, not statically (Q2 resolved: the region list is small but growing).
- **D9 (teardown order)** — delete: object storage service (`?force=true`
  only when every bucket is `retain: false`) → non-retained volumes
  (detach-checked) → cluster → network → router. The router-last rule from
  the live 2026-08-01 probe stands.
- **D10 (volumes module gated to UKS)** — `volumes.module: "upcloud"` is only
  expressible on the UKS variant (the k3s variant keeps cinder/hcloud); the
  static-PV path assumes the preinstalled CSI driver.

## Acceptance criteria

- AC1: a config with `object_storage.module: "upcloud"` and buckets applies to
  a live account: service reaches `running`, buckets exist, S3 credentials
  land in the sops sink, endpoints land in the outputs file.
- AC2: `volumes.module: "upcloud"` with a `pvc` block yields a bound PVC on
  the cluster backed by a pre-provisioned storage of the configured tier/size,
  surviving pod rescheduling.
- AC3: (dropped with the deferred LB.)
- AC4: `delete` on a cluster using both modules tears everything down in
  D9's order with no 409s and no orphaned billed resources (except
  `retain: true` ones, which are reported, not deleted).
- AC5: plan is pure and idempotent — a second apply with no config change is
  all-unchanged; immutable drift (volume tier, bucket region/name, service
  region) is refused at plan time with a replace-confirmation path where one
  exists.
- AC6: all of it works against fake servers in CI (no live credentials), with
  the fakes enforcing envelope shapes, async states, and once-only secrets.

## Functional requirements

### Client — `@kumulo/upcloud`

- R1: `storage.ts` — `list/get/create/modify/delete` on `/1.3/storage`;
  wrapped envelopes; fields `uuid,size,tier,zone,title,encrypted,state,labels`;
  create requires `size,zone,title`; modify only `title,size,labels`; delete
  passes `?backups=delete`; expose `state` for polling to `online`.
- R2: `object-storage.ts` — services (`list/get/create/patch/delete` with
  `?force=`), buckets (`create/list/delete`, metrics carry `deleted`), users
  (`create/get/delete`), access keys (`create/get/patch/delete`, secret only
  on create); bare shapes; `operational_state` exposed for polling to
  `running`, deletion polled to 404.
- R3: every response Schema-decoded; new fakes for both endpoint families,
  responses modeled from documented samples, incl. the wrapped/bare split.

### Volumes — `@kumulo/volumes-upcloud`

- R4: `ensureVolume` creates (or finds by label) a storage in the cluster
  zone, polls to `online`, returns `VolumeInfo` with the UUID as stable id.
- R5: `staticPvManifest` emits PV (`driver: storage.csi.upcloud.com`,
  `volumeHandle: <uuid>`, `ReadWriteOnce`, `Retain`) + PVC pinned by
  `volumeName`, `storageClassName` = the tier's preinstalled class.
- R6: `deleteVolume` refuses while attached (surface the API conflict, don't
  force-detach); reconciler never calls it for `retain: true` (port stance).
- R7: CSI sub-account device-permission grant (Q1) executed before the PV is
  usable; if the probe shows no API for it, R7 degrades to a documented manual
  step surfaced by doctor.

### Object storage — `@kumulo/storage-upcloud`

- R8: `ensureBucket` ensures the D6 service first (create → poll `running`),
  then the bucket; bucket name/service immutability enforced at plan.
- R9: `ensureCredentials` per D7; emits `S3Credentials` with the service's
  endpoints (`domain_name` from the endpoints list).
- R10: `deleteBucket` maps the non-empty failure to `BucketNotEmpty`; service
  deletion only in cluster delete, `?force=true` gated on D9.
- R11: `listBuckets` tolerates async-deleting buckets (`deleted: true`
  filtered out).

### Distro / core / CLI

- R12: `UpcloudUksClusterConfig` gains `volumes: NoVolumes | UpcloudVolumes`
  and the `object_storage` upcloud variant `{module, region, buckets}`;
  cross-field rule: upcloud object storage ⇒ secrets sink not `none` (extends
  the existing ovh rule); generated JSON schema derives all of it (the
  hand-mirrored constraint list in `generate-schema.ts` grows from data, not
  copy-paste).
- R13: (dropped with the deferred LB.)
- R14: `delete` implements D9's ordering with polled teardown.
- R15: doctor checks: token scopes reach `/object-storage-2` and
  `/1.3/storage`, configured region exists, tier names valid, Q1's grant
  capability present.

## Non-functional requirements

- N1: property tests for the pure parts (diff/plan of buckets and volumes)
  as with node pools.
- N2: no polling without timeout; reuse `pollUntil` with explicit budgets
  (service create is minutes-scale like clusters).
- N3: secrets never logged; the once-only secret exists in memory only between
  create response and sink write.
- N4: every fake enforces at least one live-probed quirk per family, so echo
  drift of the class fixed on 2026-08-01 fails in CI.

## Open questions

- Q1 (blocks R7): exact API for the CSI sub-account device-permission grant —
  needs a live probe; fallback path defined in R7.
- Q2 (resolved into D8): region validation is live-in-doctor.
- Q3: deferred with the LB.
