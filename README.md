# kumulo

A CLI that provisions and manages Kubernetes clusters from a single YAML
config — either a self-managed `k3s` cluster on plain cloud instances (OVH
or Hetzner), or OVH's managed Kubernetes service (`ovh-mks`).

## Install

Requires [Node](https://nodejs.org) >= 22.

```sh
npm install -g @kumulo/cli
kumulo --help
```

For development, [Bun](https://bun.sh) >= 1.3 is the workspace toolchain; run
the CLI straight from source:

```sh
bun install
bun run packages/cli/src/main.ts <command> <config-path>
```

## Quickstart

Every command reads a cluster from one YAML config. See
[`examples/k3s.yaml`](examples/k3s.yaml),
[`examples/k3s-hetzner.yaml`](examples/k3s-hetzner.yaml) and
[`examples/ovh-mks.yaml`](examples/ovh-mks.yaml) for full, schema-valid
examples — copy one and edit `name`, `auth.region`, `ssh.public_key_path`,
and `worker_pools` for your cluster.

Credentials are read from the environment, not the config file:

| Var | Used for |
|---|---|
| `OVH_CLIENT_ID`, `OVH_CLIENT_SECRET`, `OVH_SERVICE_NAME` | `ovh-mks` cluster API calls |
| `OS_AUTH_URL`, `OS_USERNAME`, `OS_PASSWORD`, `OS_PROJECT_NAME`, `OS_REGION_NAME` (or `OS_CLOUD` + `clouds.yaml`) | Cinder volumes (both distros) |
| `HCLOUD_TOKEN`, `HETZNER_DNS_TOKEN` | `k3s` clusters with `provider: hetzner` |

They can also come from a sops-encrypted file — see
[`packages/cli/README.md`](packages/cli/README.md).

```sh
# See what would change, without touching anything
dist/kumulo apply examples/ovh-mks.yaml --dry-run

# Apply it
dist/kumulo apply examples/ovh-mks.yaml --yes

# Check on it
dist/kumulo status examples/ovh-mks.yaml

# Grab the kubeconfig
dist/kumulo kubeconfig examples/ovh-mks.yaml > kubeconfig.yaml

# Grow/shrink a worker pool: edit worker_pools[].count in the config, then
dist/kumulo scale examples/ovh-mks.yaml --yes

# Tear it down (retained volumes survive, see volumes.managed[].retain)
dist/kumulo delete examples/ovh-mks.yaml --yes
```

## Command reference

| Command | Notes |
|---|---|
| `apply <config>` | Plan + apply (or `--dry-run` to just print the plan). Re-running converges — safe to interrupt. |
| `scale <config>` | Same reconcile as `apply`; use after editing `worker_pools[].count`. |
| `status <config>` | Cluster inventory + health. |
| `kubeconfig <config>` | Prints the cluster's kubeconfig to stdout. |
| `delete <config>` | Tears the cluster down; volumes marked `retain: true` in `volumes.managed[]` are kept. |
| `upgrade <config>` | Renders SUC upgrade Plans for `k3s`; drives the OVH API directly for `ovh-mks`. |
| `volumes list <config>` / `volumes adopt <config>` | Inspect or re-bind retained Cinder volumes into a (re)created cluster. |

The config path is a positional argument on every command. Shared flags:
`--yes, -y` (skip the confirmation prompt), `--dry-run` (print the plan,
change nothing), `--show-env` (print the provider env-var summary),
`--secrets-file <path>` (sops-encrypted credentials, see
[`packages/cli/README.md`](packages/cli/README.md)). Run
`dist/kumulo <command> --help` for a command's own flags.

## Config reference

The full schema lives in [`packages/core/src/config/schema.ts`](packages/core/src/config/schema.ts)
(source of truth) and is described in [`.docs/design/kumulo-design.md`](.docs/design/kumulo-design.md)
§5. The two files under [`examples/`](examples/) are decoded against that
schema in CI (`examples/decode.test.ts`), so they never drift out of date.

## Development

```sh
bun run ci   # typecheck + test + dep-lint + oxlint + codegen:check, everything this repo gates on
```

See [`.docs/workflows/kumulo-cli-build/`](.docs/workflows/kumulo-cli-build)
for the design, requirements, and task-by-task build log.
