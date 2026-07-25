# Requirements

## Functional

- **R1 — Secrets file format.** A sops-encrypted YAML file whose top-level keys
  are the exact env-var names (`OVH_CLIENT_SECRET: ...`, `HCLOUD_TOKEN: ...`).
  Values must be strings; non-string values are a decode error. Unknown keys
  are ignored (the file may hold vars for several clusters/tools).
- **R2 — Path discovery.** At process start, the secrets-file path is resolved
  in order: `--secrets-file <path>` found by a plain argv scan (both
  `--secrets-file x` and `--secrets-file=x` forms), else `KUMULO_SECRETS_FILE`,
  else none. Relative paths resolve against the current working directory.
- **R3 — Precedence.** Real env vars always win over sops values
  (`ConfigProvider.orElse(fromEnv, sops)`). A var present in both sources uses
  the env value with no warning.
- **R4 — Lazy, single decrypt.** `sops --decrypt <file>` is spawned at most
  once per process, and only when some `Config` read misses the env provider.
  The decrypted map is cached for the process lifetime. No configured path →
  the provider is not installed at all.
- **R5 — Coverage.** All existing credential reads work unchanged:
  `requiredEnv`/`requiredRedactedEnv` call sites (mks/env.ts, k3s/env.ts,
  provider/registry.ts, doctor-openstack/env.ts, storage/env.ts) require no
  edits. Redaction semantics are unchanged (`Config.redacted` wraps whatever
  the provider returns).
- **R6 — Errors.** Decrypt failure (missing file, bad key, sops exit != 0)
  fails the credential read with a hint containing the file path and sops
  stderr — not a silent fall-through to "missing required env var".
- **R7 — No plaintext on disk.** Decryption reads sops stdout only; plaintext
  is never written to a file (mirrors the encrypt sink's stdin discipline).

## Non-functional

- **N1 — Zero new dependencies.** Reuse `yaml` (already a secrets-sops dep),
  Effect's `ConfigProvider`, and the existing `ChildProcessSpawner` spawn shape.
- **N2 — Runtime-agnostic package.** `@kumulo/secrets-sops` keeps taking
  `spawner`/`fs` from the caller; only `main.ts` touches Bun services.
- **N3 — Startup cost.** No sops spawn on the happy path where env vars cover
  everything (follows from R4).
- **N4 — Tests.** Provider unit tests with a fake spawner (success, sops
  failure, non-string value, precedence via layered provider); one CLI smoke
  test proving an env var sourced from a fixture secrets file reaches a
  command. Property test for R1 key/value round-trip where practical.
