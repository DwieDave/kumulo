# kumulo

A CLI that provisions and manages Kubernetes clusters from a single YAML
config — either a self-managed `k3s` cluster on plain cloud instances (OVH
or Hetzner), or a provider's managed Kubernetes service: OVH (`ovh-mks`) or
UpCloud (`upcloud-uks`).

## Install

Requires [Node](https://nodejs.org) >= 22.

```sh
npm install -g @kumulo/cli
kumulo --help
```

The CLI runs on both Node >= 22 and [Bun](https://bun.sh) >= 1.3 — it picks
its HTTP client from the runtime it finds itself on (`src/runtime-http.ts`).
Bun is the workspace toolchain for development; run the CLI straight from
source with either:

```sh
bun install
bun run packages/cli/src/main.ts <command> <config-path>
node packages/cli/dist/main.mjs <command> <config-path>   # after `bun run build`
```

## Quickstart

Every command reads a cluster from one config file — YAML or JSON. See
[`examples/k3s.yaml`](examples/k3s.yaml),
[`examples/k3s-hetzner.yaml`](examples/k3s-hetzner.yaml),
[`examples/ovh-mks.yaml`](examples/ovh-mks.yaml) and
[`examples/upcloud-uks.json`](examples/upcloud-uks.json) for full, schema-valid
examples — copy one and edit `name`, `auth.region`, `ssh.public_key_path`,
and `worker_pools` for your cluster.

Credentials are read from the environment, not the config file:

| Var | Used for |
|---|---|
| `OVH_CLIENT_ID`, `OVH_CLIENT_SECRET`, `OVH_SERVICE_NAME` | `ovh-mks` cluster API calls |
| `OS_AUTH_URL`, `OS_USERNAME`, `OS_PASSWORD`, `OS_PROJECT_NAME`, `OS_REGION_NAME` (or `OS_CLOUD` + `clouds.yaml`) | Cinder volumes (both distros); the `ovh-mks` `network`/`ingress` blocks |
| `HCLOUD_TOKEN`, `HETZNER_DNS_TOKEN` | `k3s` clusters with `provider: hetzner` |
| `UPCLOUD_API_TOKEN` | `upcloud-uks` cluster API calls |

They can also come from a sops-encrypted file — see
[`packages/cli/README.md`](packages/cli/README.md).

Build once — the CLI runs on node, and `dist/main.mjs` carries its own
`#!/usr/bin/env node` shebang, so `./packages/cli/dist/main.mjs` works too:

```sh
bun run build            # every package in dependency order, cli last
```

`bun run --cwd packages/cli build` alone is not enough: the CLI bundles with
every `@kumulo/*` package external, so they must be built first.

```sh
# See what would change, without touching anything
node packages/cli/dist/main.mjs apply examples/ovh-mks.yaml --dry-run

# Apply it
node packages/cli/dist/main.mjs apply examples/ovh-mks.yaml --yes

# Check on it
node packages/cli/dist/main.mjs status examples/ovh-mks.yaml

# Grab the kubeconfig
node packages/cli/dist/main.mjs kubeconfig examples/ovh-mks.yaml > kubeconfig.yaml

# Grow/shrink a worker pool: edit worker_pools[].count in the config, then
node packages/cli/dist/main.mjs scale examples/ovh-mks.yaml --yes

# Tear it down (retained volumes survive, see volumes.managed[].retain)
node packages/cli/dist/main.mjs delete examples/ovh-mks.yaml --yes
```

## Command reference

| Command | Notes |
|---|---|
| `apply <config>` | Plan + apply (or `--dry-run` to just print the plan). Re-running converges — safe to interrupt. |
| `scale <config>` | Same reconcile as `apply`; use after editing `worker_pools[].count`. |
| `status <config>` | Cluster inventory + health. |
| `kubeconfig <config>` | Prints the cluster's kubeconfig to stdout. |
| `delete <config>` | Tears the cluster down; volumes marked `retain: true` in `volumes.managed[]` are kept. |
| `upgrade <config>` | Renders SUC upgrade Plans for `k3s`; drives the OVH or UpCloud API directly for `ovh-mks`/`upcloud-uks`. |
| `volumes list <config>` / `volumes adopt <config>` | Inspect or re-bind retained Cinder volumes into a (re)created cluster. |

The config path is a positional argument on every command. Shared flags:
`--yes, -y` (skip the confirmation prompt), `--dry-run` (print the plan,
change nothing), `--show-env` (print the provider env-var summary),
`--secrets-file <path>` (sops-encrypted credentials, see
[`packages/cli/README.md`](packages/cli/README.md)). Run
`node packages/cli/dist/main.mjs <command> --help` for a command's own flags.

## Config reference

The full schema lives in [`packages/core/src/config/schema.ts`](packages/core/src/config/schema.ts)
(source of truth) and is described in [`.docs/design/kumulo-design.md`](.docs/design/kumulo-design.md)
§5. The two files under [`examples/`](examples/) are decoded against that
schema in CI (`examples/decode.test.ts`), so they never drift out of date.

### Private network and ingress (`ovh-mks`)

An MKS cluster can own the private network it runs on and a public load
balancer in front of its workloads. Both blocks are optional; omitting them is
the previous behaviour — OVH's default public addressing and no load balancer.

```yaml
network:
  cidr: 10.0.0.0/16
  nodes_subnet: 10.0.1.0/24            # must sit inside cidr
  load_balancers_subnet: 10.0.2.0/24   # must sit inside cidr
ingress: {}                            # optional flavor_id: <octavia-uuid>
```

`network` requires a vRack on the project — kumulo checks for one and fails
with the remedy rather than creating a network the cluster cannot use. MKS
takes networking at cluster creation and never again, so changing or adding
these blocks on a live cluster is refused with a message that says *recreate*.
`ingress` is only valid alongside `network`: the load balancer's VIP has to sit
on `load_balancers_subnet`.

kumulo creates the load balancer **empty** and allocates its floating IP.
An in-cluster Service adopts it by id via
`loadbalancer.openstack.org/load-balancer-id`, and the
cloud-controller-manager owns the listeners, pools and members from then on —
kumulo neither creates, prunes nor reports them as drift. That split is what
lets DNS be written in the same `apply` that creates the cluster: a record with
`target: ingress` resolves to the floating IP kumulo allocated, with no polling
for in-cluster state. (`target: ingress` on a config without an `ingress` block
still passes through literally, as any unrecognised target does.)

The ids a consumer needs are written to `<cluster>.outputs.yaml` beside the
volume ids:

```yaml
cluster: staging-eu
volumes:
  - name: staging-eu-data
    id: 6f1c…
    retain: false
ingress:
  load_balancer_id: 2b7e…   # annotate a Service with this
  floating_ip: 51.0.0.10    # what `target: ingress` records point at
```

That file is not encrypted and carries ids and addresses only, never
credentials. `delete` tears down the load balancer, the floating IP and the
network in that order; unlike volumes and buckets a network is never retained,
since it is fully reproducible from the config.

## Development

```sh
bun run ci   # typecheck + test + dep-lint + oxlint + codegen:check, everything this repo gates on
```

See [`.docs/workflows/kumulo-cli-build/`](.docs/workflows/kumulo-cli-build)
for the design, requirements, and task-by-task build log.
