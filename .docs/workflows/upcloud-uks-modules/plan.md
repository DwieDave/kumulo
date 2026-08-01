# Plan: UpCloud object storage and block storage for UKS (LB deferred)

Status: APPROVED 2026-08-01 (LB deferred at approval). Each task follows Phase 4
(failing test → code → pass → memories → commit). Requirement links in
brackets.

## Milestone 1 — Config schema + generated JSON schema **[parallel with M2]**

- T1.1 UKS `volumes` union (`none | upcloud`), tier enum, managed list reusing
  `ManagedVolume` with `type` narrowed [R12, D5, D10]
- T1.2 `object_storage` upcloud variant `{module, region, buckets}`; extend
  the secrets-sink cross-field rule to `module != "none"` instead of
  `module == "ovh"` [R12, D8]
- T1.3 `generate-schema.ts`: derive the object_storage⇒secrets rule from data
  (like the auth rule now is); regenerate; validate examples [R12]

## Milestone 2 — Client endpoints in `@kumulo/upcloud` **[parallel with M1]**

- T2.1 `storage.ts` with wrapped envelopes + fake `/1.3/storage` server
  (enforces wrapping + `maintenance→online` transition) [R1, R3, N4]
- T2.2 `object-storage.ts` bare shapes + fake `/object-storage-2` server
  (enforces once-only secret, async bucket delete, `operational_state`
  ladder) [R2, R3, N4]

## Milestone 3 — `@kumulo/volumes-upcloud`

- T3.1 pure diff: desired managed list vs labeled live storages; tier drift →
  replace-needs-confirm [AC5, N1, D4, D5]
- T3.2 `VolumeProvider` impl: ensure (find-by-label or create+poll), delete
  (attached ⇒ conflict surfaced) [R4, R6]
- T3.3 `staticPvManifest` PV/PVC pair [R5]
- T3.4 Q1 probe + grant step or doctor-surfaced manual step [R7, R15]

## Milestone 4 — `@kumulo/storage-upcloud`

- T4.1 service ensure (deterministic name, networks per D6, poll `running`)
  [R8, D6, N2]
- T4.2 bucket ensure/list/delete with `BucketNotEmpty` + `deleted` filtering
  [R8, R10, R11]
- T4.3 credentials user+key, rotate-on-missing-sink, straight into
  `CredentialsSink` [R9, D7, N3]

## Milestone 5 — CLI wiring + teardown order

- T6.1 wire both providers through plan/apply/delete/status/doctor for the
  upcloud path [R12, R14, R15]
- T6.2 full teardown ordering per D9 with fakes covering AC4's no-409 run
  [AC4, D9]
- T6.3 doctor checks [R15]

## Milestone 6 — Artifacts, live probe, docs

- T7.1 example update: upcloud-uks.json gains both modules + sops (sops
  already landed 2026-08-01) [AC1, AC2]
- T7.2 live probe run: AC1/AC2/AC4 against a real account; resolve Q1; feed
  quirks back into fakes + memories.md [AC1, AC2, AC4, N4]
- T7.3 README/docs

## Sequencing summary

M1 ∥ M2 → M3 ∥ M4 (both need M2; M3 also needs M1's tier enum) → M5 (needs
M3+M4) → M6.
Within the build, `packages/upcloud` stays before its dependents in the root
build order (the alphabetical-order landmine from the UKS workflow).

## Risks

- Q1 has no confirmed API — R7's fallback keeps M3 shippable without it.
- Object-storage service creation is minutes-scale and billed per instance
  (min ~250 GB) — the fake keeps CI free of it; the live probe deletes
  eagerly.
- Two envelope conventions in one client package is a standing foot-gun;
  D3's per-endpoint transcription rule plus N4's fake enforcement is the
  mitigation.
