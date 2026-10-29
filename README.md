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
[`examples/k3s-godaddy.yaml`](examples/k3s-godaddy.yaml),
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
| `GODADDY_API_TOKEN`, optional `GODADDY_API_BASE_URL` | `dns.module: godaddy` |
| `UPCLOUD_API_TOKEN` | `upcloud-uks` cluster API calls |

They can also come from a sops-encrypted file — see
[`packages/cli/README.md`](packages/cli/README.md).

## GoDaddy DNS

Set `dns.module: godaddy` to manage records in a zone hosted at GoDaddy
(see [`examples/k3s-godaddy.yaml`](examples/k3s-godaddy.yaml)). The zone must
already exist in the account; kumulo does not create it.

**Token.** Create a personal access token (PAT) at
https://developer.godaddy.com/personal-access-token. Give it the scope
`domains.dns:update` and pick an expiry (7, 30, 60 or 90 days, or 1 year).
The token is shown once. Export it as `GODADDY_API_TOKEN`. `GODADDY_API_BASE_URL`
is optional and overrides `https://api.godaddy.com`. When the token expires,
requests fail with 401; create a new one.

**Limits.**
- `dns.ttl` must be at least 600 seconds (GoDaddy's minimum; the maximum is 86400).
- A CNAME cannot sit on the zone apex. Use an A record there.
- The rate limit is about 600 requests per 23 minutes, shared by everything
  using the same token. kumulo reads the zone once per run, writes one record
  at a time, and waits out `Retry-After` on 429.

**Account eligibility and 403.** GoDaddy only allows DNS API calls from some
accounts. Reports from 2024 require 10+ domains or a Discount Domain Club
Premier plan. A 2026 support quote relaxes this to one or more domains, a
Discount Domain Club Pro plan, or $20+/month of eligible purchases. A 403 means
either the token lacks `domains.dns:update` or the account is not eligible
(typically `ACCESS_DENIED`). Fix the scope first. If the scope is right, ask
GoDaddy API support to allow-list the account, or meet the threshold.

**Fallback.** If the account cannot get API access, point the zone's
nameservers at another DNS provider (OVH, Hetzner or bunny.net) at the
registrar, and set `dns.module` to that provider.

**OTE.** GoDaddy's test environment is `https://api.ote-godaddy.com`, set
through `GODADDY_API_BASE_URL`. Support says OTE is not subject to the
eligibility rules, but it is not known whether PATs work there.

**Unverified assumptions.** These come from research and were not confirmed
against the live API:
- whether the DNS endpoints enforce `Idempotency-Key`;
- how TXT record data must be quoted;
- the exact set of 403 error codes;
- that the 2026 eligibility relaxation applies to every account.

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
§5. The files under [`examples/`](examples/) are decoded against that
schema in CI (`examples/decode.test.ts`), so they never drift out of date.

### bunny.net (DNS, object storage, CDN)

bunny.net has no compute or managed Kubernetes, so it fills three slots, each
selected with `module: bunny`: `dns`, `object_storage` and `cdn`. All three
authenticate with one account key in `BUNNYNET_API_KEY` (the variable the
official Terraform provider reads). Complete configs:
[`examples/k3s-bunny.yaml`](examples/k3s-bunny.yaml) and
[`examples/ovh-mks-bunny-cdn.yaml`](examples/ovh-mks-bunny-cdn.yaml).

**DNS.** The zone must already exist in bunny; kumulo does not create zones or
change registrar nameservers. If the zone does not yet report bunny
nameservers, `plan` warns. Ownership uses the same TXT record as the other
DNS modules.

**Object storage.** A bucket is one S3-type storage zone:
`{ name, region, tier?, retain }`, with `region` one of `DE NY SG UK SE LA JH SYD`
and `tier` `standard` (HDD) or `edge` (SSD). Names are globally unique and
checked at plan time. bunny's S3 API is a public preview, so `versioning` and
`encryption` are not accepted, there are no lifecycle rules, and each zone is
limited to 500 requests per second. A zone that holds files is never deleted,
and `retain: true` keeps it regardless.

**CDN.** One pull zone fronts the cluster. `origin: ingress` works only on
`ovh-mks` with an `ingress` block; `k3s` and `upcloud-uks` need
`origin: { url: ... }`. Add `target: cdn` to a DNS record to point it at
`<name>.b-cdn.net` as a CNAME. A hostname at the zone apex needs
`dns.module: bunny`, which writes a PullZone record instead.

*Certificates.* After the pull zone and DNS exist, kumulo asks bunny for a free
certificate per hostname. bunny only issues one once the hostname resolves to
bunny, so kumulo retries with backoff for up to 10 minutes. If a hostname never
resolves, the edge keeps serving plain HTTP, `apply` reports the failing
hostnames, and nothing is rolled back; fix DNS and run `apply` again. `force_ssl`
is switched on only after the certificate is issued.

*Shield.* The optional `cdn.shield` block sets plan, WAF, DDoS, bot detection,
rate limits and access lists. Rate limits and access lists are matched by name,
so names must be unique. Plans are gated: `basic` allows two rate limits, and
bot detection on a plan that lacks it fails with an error naming the plan
needed. A plan change shows as an update with a cost note. bunny has no Shield
delete call, so `delete` resets the zone to the basic plan with WAF off instead
of removing it.

**Known assumptions.** There was no run against a live account; behaviour comes
from bunny's OpenAPI specs and the official Terraform provider. These points
are unconfirmed and handled defensively: the apex record name may come back as
`""` or `"@"` (both are accepted), pull zone updates read the zone, merge the
fields kumulo owns and write it back in case updates are not partial, 429 and
5xx responses are retried, and a 404 on delete counts as already gone. Report
any divergence you see.

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
