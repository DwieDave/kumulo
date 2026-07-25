# @kumulo/secrets-sops

Writes cluster credentials (kubeconfig, S3 keys) to a SOPS-encrypted file.

Part of [kumulo](../../README.md) — a CLI that provisions and manages
Kubernetes clusters on OVH from a single YAML config. This package is
published from that workspace and is normally consumed through the `kumulo`
CLI rather than directly.

```sh
bun add @kumulo/secrets-sops
```

## Reading credentials: sops `ConfigProvider`

`sopsConfigProvider({ file, spawner })` serves Effect `Config` keys from a
sops-encrypted YAML file — the reverse direction of the credentials sink. The CLI
installs it behind the environment provider when `--secrets-file` /
`KUMULO_SECRETS_FILE` is set, so real env vars always win and the file only
fills gaps.

Top-level keys are the exact env-var names and values must be strings:

```yaml
OVH_CLIENT_SECRET: ...
HCLOUD_TOKEN: ...
```

Unknown keys are ignored; a non-string value is a decode error. `sops --decrypt`
is spawned lazily and at most once per process, plaintext is read from its stdout
and never written to disk, and a failed decrypt surfaces the file path plus sops'
stderr instead of looking like an absent key. The `spawner` is supplied by the
caller — this package touches no runtime directly.

See the [root README](../../README.md) for configuration, commands and
examples, and the [changelog](../../CHANGELOG.md) for release notes.
