# Scope: OVH Object Storage via cluster config

## In scope

1. **Config**: new top-level `object_storage` section in `ClusterConfig`
   (`packages/core/src/config/schema.ts`), module-style like `dns`/`volumes`:

   ```yaml
   object_storage:
     module: ovh          # ovh | none
     buckets:
       - name: staging-eu-backups
         region: DE1       # per-bucket, defaults to auth.region (decision 2026-07-24)
         versioning: false
         encryption: false
         # deletion is destructive: like retained volumes, buckets removed from
         # config are only deleted when `retain: false`; a non-empty bucket
         # REFUSES deletion with a tagged error (decision 2026-07-24 — no
         # force_destroy in v1)
         retain: true
   ```

2. **Core port**: `ObjectStorageProvider` (create/get/delete bucket, ensure S3 user +
   credentials) in `packages/core/src/ports`, error channel = existing tagged errors.

3. **Provider impl**: new `packages/storage-ovh` (mirrors `dns-ovh` layout: allowlist →
   ovh2openapi → generated client + thin provider), reusing `OvhAuth`/`ovhHttpClientLayer`.

4. **Plan/reconcile**: buckets appear in the plan output (`+ bucket/staging-eu-backups`),
   diffed by name+region; converge on create/scale, delete honoring `retain`.

5. **Credentials → outputs, not k8s Secrets** (decision 2026-07-24): one S3 user per
   cluster (`kumulo-<cluster>`), credentials created via `/user/{id}/s3Credentials` and
   written to kumulo's outputs file (accessKey/secret/endpoint/region per bucket).
   In-cluster delivery is owned by konfig.ts (`.references/konfig.ts`): its
   `SecretSource` interface (`packages/env/src/source.ts`) gets a small
   kumulo-outputs source in the konfig repo, and delivery flows through konfig's
   existing backends (sops/sealed-secrets/external-secrets). No library coupling —
   konfig pins effect beta.70, kumulo is on beta.101; the contract is the outputs
   file format only.

6. Tests in line with repo conventions (property tests for the diff, schema decode
   tests, generated-client regen gate).

## Out of scope

- Bucket contents, lifecycle/replication policies, quotas.
- IAM policy fine-tuning beyond read-write on declared buckets.
- k3s-distro wiring beyond compiling (module works cluster-agnostically via the port,
  but only the ovh-mks path is exercised/tested for now).
- CLI subcommands dedicated to storage (covered by `create`/`delete` reconcile).

## Resolved questions (2026-07-24)

1. Credentials: provisioned by kumulo, exported via outputs file; k8s Secret delivery
   delegated to konfig.ts (see item 5). No `credentials.secret` field in kumulo.
2. Deletion: refuse to delete non-empty buckets (tagged error); no force_destroy in v1.
3. Regions: per-bucket `region`, defaulting to `auth.region`.

4. Credentials at rest (decision 2026-07-24): encrypted with sops before touching disk,
   but behind an agnostic port — a core `CredentialsSink` port (`write(values) →
   Effect<void, E>`) with the sops implementation as the first backend (shells out to
   `sops --encrypt`, fail-closed: no sops binary/recipient configured → tagged error,
   never a plaintext fallback). Other backends (plaintext-0600 for dev, vault, …) can
   implement the same port later without touching the reconcile.
