# memories

## Milestone 6 (examples/schema/docs)

- `examples/upcloud-uks.json` now exercises `volumes.module=upcloud` (one
  `standard` managed volume, `staging-de-data`, with a `pvc` block) and
  `object_storage.module=upcloud` (`region: europe-1`, one bucket
  `staging-de-backups`), alongside the existing sops secrets sink. Both
  example configs (`upcloud-uks.json`, `ovh-mks.json`) validate against
  `kumulo.schema.json` via `bunx ajv-cli validate --strict=false
  --spec=draft2020`.
- `scripts/generate-schema.ts`'s `object_storage → secrets` cross-field rule
  was still hardcoded to `module === "ovh"` — stale from before the upcloud
  object-storage module existed. Generalized to `module !== "none"` (any
  non-none object_storage module requires a non-none secrets sink), then
  regenerated `kumulo.schema.json` and re-validated both examples.
- `packages/storage-upcloud/README.md` did not exist; added, mirroring
  `packages/storage-ovh/README.md`'s structure (package name / one-line
  description / OVH+UpCloud workspace blurb / install / links). Already
  listed in `storage-upcloud/package.json`'s `files` array.
- `packages/volumes-upcloud/README.md` already existed and already described
  the OVH/UpCloud workspace correctly — no change needed.

### File map (this task)

- `examples/upcloud-uks.json` — volumes + object_storage upcloud modules added
- `kumulo.schema.json` — regenerated
- `scripts/generate-schema.ts` — object_storage→secrets rule generalized
- `packages/storage-upcloud/README.md` — new

### Open

- T7.2 (live probe): AC1/AC2/AC4 against a real UpCloud account, and Q1 (the
  CSI sub-account device-permission grant — see
  `packages/volumes-upcloud/src/doctor.ts`'s `csiDevicePermissionNote`)
  remain unresolved. Everything else in Milestone 6 is implemented and
  covered by the fake-server tests; only the real-account run is outstanding.
