# kumulo

A CLI that provisions and manages Kubernetes clusters on OVH from a single
YAML config — either a self-managed `k3s` cluster on plain OVH Cloud
instances, or OVH's managed Kubernetes service (`ovh-mks`).

## Install

Requires [Bun](https://bun.sh) >= 1.3.

```sh
bun install
bun run build:binary   # -> dist/kumulo, a single-file executable
```

`dist/kumulo` has no runtime dependencies (Bun is compiled in) — copy it
anywhere and run it.

For development, run the CLI directly without compiling:

```sh
bun run packages/cli/src/main.ts <command> --config <path>
```

## Quickstart

Every command reads a cluster from one YAML config. See
[`examples/k3s.yaml`](examples/k3s.yaml) and
[`examples/ovh-mks.yaml`](examples/ovh-mks.yaml) for full, schema-valid
examples — copy one and edit `name`, `auth.region`, `ssh.public_key_path`,
and `worker_pools` for your cluster.

Credentials are read from the environment, not the config file:

| Var | Used for |
|---|---|
| `OVH_CLIENT_ID`, `OVH_CLIENT_SECRET`, `OVH_SERVICE_NAME` | `ovh-mks` cluster API calls |
| `OS_AUTH_URL`, `OS_USERNAME`, `OS_PASSWORD`, `OS_PROJECT_NAME`, `OS_REGION_NAME` (or `OS_CLOUD` + `clouds.yaml`) | Cinder volumes (both distros) |

```sh
# See what would change, without touching anything
dist/kumulo create --config examples/ovh-mks.yaml --dry-run

# Apply it
dist/kumulo create --config examples/ovh-mks.yaml --yes

# Check on it
dist/kumulo status --config examples/ovh-mks.yaml

# Grab the kubeconfig
dist/kumulo kubeconfig --config examples/ovh-mks.yaml > kubeconfig.yaml

# Grow/shrink a worker pool: edit worker_pools[].count in the config, then
dist/kumulo scale --config examples/ovh-mks.yaml --yes

# Tear it down (retained volumes survive, see volumes.retained[].retain)
dist/kumulo delete --config examples/ovh-mks.yaml --yes
```

`ovh-mks` is the fully wired live path today. `distro: k3s` configs decode
and dry-run plan (`create --dry-run`), but the self-managed apply pipeline
(SSH bootstrap, etcd HA, addons) lands in a later milestone — running
`create --yes`/`delete`/`status` against a `k3s` config currently fails with
a clear "not wired yet" error rather than doing something partial.

## Command reference

| Command | Notes |
|---|---|
| `create` | Plan + apply (or `--dry-run` to just print the plan). Re-running converges — safe to interrupt. |
| `scale` | Same reconcile as `create`; use after editing `worker_pools[].count`. |
| `status` | Cluster health + configured worker pool sizes (`ovh-mks` only). |
| `kubeconfig` | Prints the cluster's kubeconfig to stdout. |
| `delete` | Tears the cluster down; volumes marked `retain: true` in `volumes.retained[]` are kept. |
| `upgrade` | Renders SUC upgrade Plans for `k3s`; drives the OVH API directly for `ovh-mks`. |
| `volumes list` / `volumes adopt` | Inspect or re-bind retained Cinder volumes into a (re)created cluster. |

Shared flags on every command: `--config, -c <path>` (required), `--yes, -y`
(skip the confirmation prompt), `--dry-run` (print the plan, change
nothing). Run `dist/kumulo <command> --help` for a command's own flags.

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
