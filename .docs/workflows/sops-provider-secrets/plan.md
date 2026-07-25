# Plan

## Milestone 1 — sops ConfigProvider in `@kumulo/secrets-sops`

- **T1.1** (R1, R7, N1, N2) `src/provider.ts`: `decryptSopsFile({ file, spawner })`
  — spawn `sops --decrypt --output-type json <file>`, parse stdout, validate
  string-valued flat record. Reuses the sink's spawn/collect shape.
- **T1.2** (R4, R6) `sopsConfigProvider({ file, spawner })`: wrap T1.1 in a
  process-lifetime cache (`Effect.cached` / lazy Ref) and expose it as a
  `ConfigProvider` (`ConfigProvider.fromJson` over the cached map, lazily).
  Failures carry file path + stderr.
- **T1.3** (N4) `test/provider.test.ts` with a fake spawner: happy path,
  sops non-zero exit, non-string value, decrypt-called-once (cache), and a
  property test over arbitrary key/value records.

## Milestone 2 — CLI wiring

- **T2.1** (R2) `packages/cli/src/secrets-file.ts`: pure argv/env path
  resolution (`--secrets-file`, `=` form, `KUMULO_SECRETS_FILE`) + unit tests.
- **T2.2** (R3, R4, R5) `main.ts`: when a path resolves, install
  `ConfigProvider.orElse(ConfigProvider.fromEnv(), sopsConfigProvider(...))`
  as the ambient provider around `program`; otherwise leave defaults untouched.
  Spawner comes from Bun services at the composition root.
- **T2.3** (R6, N4) CLI smoke test: fixture secrets file (test spawner or
  age test key, whichever the existing sink tests already do) proving a
  missing env var is served from the file, and that a broken file surfaces
  the sops stderr hint.

## Milestone 3 — docs

- **T3.1** README (cli + secrets-sops): secrets-file usage, precedence,
  key-name = env-var-name contract, `--secrets-file` / `KUMULO_SECRETS_FILE`.

Each task runs phase 4: failing test → code → green → commit.
