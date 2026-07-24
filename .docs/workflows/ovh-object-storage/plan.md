# Plan: OVH Object Storage via cluster config

Status: DRAFT — awaiting human approval. Each task lists its requirements.

## Milestone 1 — Config + core contracts

- T1.1 Add `object_storage` + top-level `secrets` schema (module, buckets, S3 name
  rules; cross-field filters: module/none, module requires secrets.sink); update
  `examples/*.yaml` + decode tests. [R1, R2]
- T1.2 Add `ObjectStorageProvider` + `CredentialsSink` ports and error types to core;
  export via barrel. [R3, R8]

## Milestone 2 — storage-ovh provider

- T2.1 Allowlist + generate `packages/storage-ovh` client from vendored cloud.json;
  register in `codegen:check`. [R4, N2]
- T2.2 Implement provider: list/ensure/delete bucket (delete refuses non-empty via
  object count check), ensure user + s3Credentials. [R4, R6, R7]

## Milestone 3 — Reconcile + plan

- T3.1 Pure bucket diff (property tests: idempotence, totality). [R5, N1]
- T3.2 Wire into plan rendering + create/scale/delete/status CLI paths (ovh-mks only).
  [R5, R11]

## Milestone 4 — Credentials sink

- T4.1 Sops sink (encrypt via stdin, fail-closed), file schema per contract; unit
  tests with a fake sops binary. [R9, R10, N4]
- T4.2 Document the credentials file contract for konfig.ts consumption (header
  comment + requirements doc cross-link). [R10]

## Milestone 5 — Hardening

- T5.1 End-to-end dry-run snapshot covering buckets in the example config. [R5]
- T5.2 Live smoke against the real OVH project (manual, gated on env vars). [R4, R7]

Phase-4 execution: per task — detail plan here, failing test first, implement, verify,
commit.
