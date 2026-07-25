# @kumulo/cli

The `kumulo` command-line interface: plan, apply and delete Kubernetes clusters from a single YAML config.

Part of [kumulo](../../README.md) — a CLI that provisions and manages
Kubernetes clusters on OVH from a single YAML config. This package is
published from that workspace and is normally consumed through the `kumulo`
CLI rather than directly.

```sh
bun add @kumulo/cli
```

## Credentials from a sops file

Provider credentials (`OVH_CLIENT_ID`, `OVH_CLIENT_SECRET`, `OVH_SERVICE_NAME`,
`HCLOUD_TOKEN`, `HETZNER_DNS_TOKEN`, the OpenStack `OS_*` keys) can come from a
sops-encrypted YAML file instead of the shell environment:

```sh
kumulo apply cluster.yaml --secrets-file secrets.enc.yaml
# or
KUMULO_SECRETS_FILE=secrets.enc.yaml kumulo apply cluster.yaml
```

The flag wins over the env var; relative paths resolve against the current
directory. With neither set, nothing changes — credentials come from the
environment as before.

Top-level keys in the file are the **exact env-var names**, values are strings:

```yaml
OVH_CLIENT_ID: ...
OVH_CLIENT_SECRET: ...
HCLOUD_TOKEN: ...
```

Keys the run does not need are ignored, so one file can serve several clusters.

**Precedence:** real environment variables always win; the file only fills gaps,
silently and without a warning. `sops --decrypt` therefore runs at most once per
process, and only when some credential is missing from the environment — a fully
populated environment never spawns `sops`. Key material is sops' business
(`SOPS_AGE_KEY_FILE` and friends); a file that cannot be decrypted fails the
command with the file path and sops' own stderr rather than reporting a missing
variable.

See the [root README](../../README.md) for configuration, commands and
examples, and the [changelog](../../CHANGELOG.md) for release notes.
