# Requirements: OVH Object Storage via cluster config

Status: DRAFT — awaiting human approval.

## Functional requirements

- **R1 — Config schema.** `ClusterConfig` gains a required `object_storage` section
  and a resource-agnostic top-level `secrets` section (see D5+D6):
  `module: "ovh" | "none"`, `buckets: Array<{ name, region?, versioning, encryption,
  retain }>`. `region` defaults to `auth.region`. `module: none` requires `buckets: []`
  (cross-field filter, same style as `isVersionValidForDistro`). Existing configs must
  fail loudly (schema is total, no silent default) — examples updated.
- **R2 — Bucket naming.** Names validated against S3 rules (3–63 chars, lowercase,
  digits, dots, hyphens; start/end alphanumeric) at schema level.
- **R3 — Core port.** `ObjectStorageProvider` Context.Service in
  `packages/core/src/ports`: `listBuckets(region)`, `ensureBucket(spec)`,
  `deleteBucket(ref)`, `ensureCredentials(cluster)`. Error channel drawn from existing
  `KumuloError` members (incl. `HttpTransportError`/`ResponseDecodeError`).
- **R4 — Provider package.** New `packages/storage-ovh` mirroring `dns-ovh`: allowlist
  over the vendored `cloud.json` (`/region/{region}/storage*`, `/user*`,
  `/user/{id}/s3Credentials*`), ovh2openapi → generated client (regen-noop gated in
  `codegen:check`), thin provider impl on `OvhAuth`/`ovhHttpClientLayer`.
- **R5 — Plan integration.** Buckets appear as plan actions (`+ bucket/<name>`,
  `- bucket/<name>`, `= bucket/<name>`); diff keyed by (name, region). Mutable-in-place:
  versioning. Immutable (region, encryption): replace-needs-confirm, like node pools.
- **R6 — Refuse non-empty deletion.** Deleting a bucket that still contains objects
  fails with a tagged error naming the bucket and object count; nothing else in the
  apply is rolled back (per-resource convergence, consistent with nodepool behavior).
- **R7 — Credentials.** One OpenStack/S3 user per cluster (`kumulo-<cluster>`), created
  idempotently; S3 credentials issued via `/user/{id}/s3Credentials`. Re-runs reuse the
  existing user + credential (no rotation in v1). **Verified OVH constraint (2026-07-24,
  needs re-approval):** the S3 secret is only ever returned once, on the creation POST —
  a GET on an existing credential lists it without the secret. The provider therefore
  cannot itself "reuse" a credential across process runs; `ensureCredentials` fails
  closed with `ResourceConflict` if one already exists rather than fabricate/omit a
  secret. Reuse across runs is only achievable one layer up (T3.2 reconcile): read the
  credentials sink (R8/R9) first and skip calling `ensureCredentials` when an entry for
  the cluster already exists.
- **R8 — CredentialsSink port.** Core port `CredentialsSink` (`write(entries) →
  Effect<void, CredentialsSinkError>`); reconcile depends only on the port.
- **R9 — Sops sink.** First sink impl shells out to `sops --encrypt` writing
  `<cluster>.credentials.yaml` (payload: per-cluster user + per-bucket
  endpoint/region/bucket + accessKey/secretKey). Fail-closed: missing sops binary or
  no configured recipient → tagged error; plaintext never touches disk (encrypt via
  stdin/stdout, not a temp file).
- **R10 — Outputs contract for konfig.ts.** The credentials file schema is documented
  (in the file header + this doc) as the stable contract a konfig.ts `SecretSource`
  will consume. Keys: `cluster`, `s3.user`, `s3.buckets[].{name,region,endpoint}`,
  `s3.accessKey`, `s3.secretKey` (last two sops-encrypted values).
- **R11 — CLI wiring.** `create`/`scale` converge buckets when `module: ovh` and
  distro is `ovh-mks`; `delete` removes non-retained buckets (subject to R6);
  `status` lists buckets + credential presence. No new subcommand.

## Non-functional requirements

- **N1 — Pure diff.** Bucket diff is a pure total function, property-tested
  (idempotence: diff(desired, applied(desired)) = empty; every desired bucket appears
  exactly once across create/replace/update/noop).
- **N2 — Codegen discipline.** Generated client committed; `codegen:check` regen-noop
  gate covers storage-ovh; no hand edits to generated files.
- **N3 — Repo conventions.** dependency-cruiser rules pass (imports only via package
  barrels); functions ≤ 20–30 lines; oxlint/typecheck/vitest green; Effect
  `Effect<A,E,R>` intact (no `as never`).
- **N4 — Secrets hygiene.** Access/secret keys are `Redacted` in memory, never logged,
  never in plan output; only the sops-encrypted file persists them.

## Design choices (approved 2026-07-24 unless noted)

- D1: module-style config (`dns`/`volumes` precedent) — approved.
- D2: refuse non-empty deletes, no force_destroy in v1 — approved.
- D3: per-bucket region defaulting to auth.region — approved.
- D4: credentials via agnostic sink, sops first backend — approved.
- D5+D6 (approved 2026-07-24): a resource-type-agnostic top-level `secrets` section —
  NOT nested under `object_storage` — so future secret-bearing resources (e.g.
  postgres) reuse the same settings:

  ```yaml
  secrets:
    sink: sops            # sops | none (none forbids secret-bearing resources)
    dir: .                # where <cluster>.credentials.yaml lands
    sops:
      age_recipient: age1…   # explicit, no .sops.yaml discovery in v1
  ```

  `object_storage.module: ovh` requires `secrets.sink != none` (cross-field filter).
