# Scope

## In scope

- New export in `@kumulo/secrets-sops`: a sops-backed `ConfigProvider`
  (decrypt file via `sops --decrypt`, parse YAML, serve flat keys).
- Composition-root wiring in `packages/cli/src/main.ts`: install
  `ConfigProvider.orElse(env, sops)` — env vars always win, sops fills gaps.
- Secrets-file path discovery at startup (before CLI arg parsing):
  `--secrets-file <path>` argv pre-scan, falling back to `KUMULO_SECRETS_FILE`.
  No path configured → behavior identical to today.
- Lazy decrypt: `sops` is spawned at most once, and only on the first `Config`
  key miss. Runs with a fully populated env never touch sops.
- Error surfacing: configured-but-broken secrets file fails with the sops
  stderr in the hint.
- Tests in `packages/secrets-sops` (provider) and a CLI smoke assertion.
- README/env-summary note that each required var may come from the sops file.

## Out of scope

- `secrets.file` inside the cluster config YAML. Credentials resolve at layer
  build, before the config positional is parsed (`main.ts` provides layers
  around `Command.run`), so the path must be known at process start. Revisit
  only if layer construction is ever deferred to command runtime.
- Writing/rotating provider credentials (the existing sink stays as-is).
- Key management (age key resolution is delegated entirely to sops:
  `SOPS_AGE_KEY_FILE` etc., same trust model as the encrypt sink).
- `--show-env` changes beyond what falls out for free (presence checks go
  through `Config`, so they see sops-provided values automatically).
