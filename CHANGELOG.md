# Changelog

All notable changes to kumulo are documented here. Format:
[Keep a Changelog](https://keepachangelog.com); semantics:
[SemVer](https://semver.org).

## [Unreleased]

### Added

- `dns.module: none` takes `records`, in the managed modules' shape (names
  relative to `zone`, `@` for the apex, target `api_server`, `ingress`, `cdn`
  or a literal IP or hostname). `records` needs `zone`. `apply` then prints
  exactly those records, resolved, with their full names, and no suggested
  rows. `delete` lists their names to remove by hand. kumulo still calls no
  DNS provider and writes no ownership TXT.

### Fixed

- `dns.module: none` printed nothing on an `apply` whose plan had nothing to
  do, because the addresses were only resolved inside the distro's apply.
  Every `apply` that is not a dry run now resolves them read-only afterwards
  (k3s: the cloud inventory; ovh-mks: the cluster's API endpoint and the
  ingress floating IP in `<cluster>.outputs.yaml`; upcloud-uks: the
  kubeconfig; CDN: `<cluster>.cdn.yaml`) and prints the table.

## [0.4.0] - 2026-11-22

### Added

- `dns.module: none` prints the DNS records to create by hand. `apply` ends
  with one row per address it resolved for the cluster (`api_server`, plus
  `ingress` and `cdn` where the cluster has them): target, a suggested name
  (`api.<cluster>.<zone>`, `*.<cluster>.<zone>`, the CDN's hostnames), the
  record type the value needs (A, AAAA or CNAME) and the value. kumulo still
  calls no DNS provider. The new optional `dns.zone` fills in the suggested
  names; without it they keep a literal `<zone>`. `delete` prints a reminder
  to remove the records by hand.

### Changed

- `upcloud-uks` with `dns.module: none` now fetches the kubeconfig on every
  `apply`, to resolve the API server's hostname.
- The bunny CDN rule that a `cdn.hostnames` entry at the `dns.zone` apex needs
  `dns.module: bunny` no longer applies to `none`, whose zone only names the
  records you enter yourself.

## [0.3.0] - 2026-11-21

One package name is new on npm with this release: `@kumulo/dns-cloudflare`.

### Changed (behaviour, migration notes)

- DNS, every module: the ownership TXT `kumulo.cluster=<cluster>` moves off
  the record's own name to `_kumulo.<name>` (`_kumulo._wildcard.<parent>` for
  `*.<parent>`, `_kumulo` for the apex). A name with a CNAME may hold no other
  record (RFC 1034 §3.6.2), so a provider that enforces that refused the TXT
  beside a CNAME target, as for an UpCloud load balancer hostname. A TXT at
  `*.c1` was also a wildcard TXT answering for every name under `c1`.
  Migration is automatic: the next `apply` writes the new TXT, then deletes
  the old one; `delete` removes records marked either way. kumulo 0.2 run
  against a migrated zone reports a conflict and changes nothing.

### Added

- DNS records via Cloudflare (`@kumulo/dns-cloudflare`, `dns.module: cloudflare`),
  on the API v4 with an API token in `CLOUDFLARE_API_TOKEN` (Zone:Read and
  DNS:Edit). A, AAAA and CNAME records are written with `proxied: false`.
  `dns.ttl` is 1 (automatic) or 60 to 86400. `apply` and `delete` stop
  before touching the cluster when the token cannot see the zone.
- `kumulo doctor` runs DNS checks after the distro's: for `cloudflare` and
  `godaddy`, whether the token can read the zone and whether the domain's
  nameservers point at that provider.

## [0.2.0] - 2026-11-20

0.1.1 was the first npm publish, made by hand. Nine package names are new on
npm with this release:
`@kumulo/upcloud`, `@kumulo/distro-upcloud-uks`, `@kumulo/storage-upcloud`,
`@kumulo/volumes-upcloud`, `@kumulo/dns-godaddy`, `@kumulo/bunny`,
`@kumulo/dns-bunny`, `@kumulo/storage-bunny` and `@kumulo/cdn-bunny`.

### Changed (behaviour, migration notes)

- Provider HTTP retries: bunny `PUT` (including DNS add-record) is no longer
  retried, and `Retry-After` / `RateLimit-Reset` waits are capped at 60s.
- OVH DNS: FQDN record names are normalised to relative `subDomain`s (apex is
  the empty subDomain). Existing records written with an FQDN name are matched
  by the relative name and may be updated once on the next apply.
- Cluster names must be DNS labels (lowercase letters, digits, hyphens, at
  most 63 characters). Configs with uppercase or underscore names now fail
  to decode; rename the cluster.
- Outputs files (`*.buckets.*`, `*.outputs.*`) are written atomically via a
  temp file and rename, mode 0600.
- The bunny `CdnOutputsInvalid` error tag is now `OutputsInvalid`.
- Kubeconfig bearer tokens are `Redacted` in `@kumulo/core`.
- `upcloud-uks`: a DNS record with `target: ingress` fails to decode, naming
  `dns.records[i].target`. It used to be written as a CNAME to the literal word
  `ingress`. Use a literal IP or hostname (the address of the cluster's
  LoadBalancer Service).
- `upcloud-uks`: the plan lists one `dns/<zone>/<name>` row per DNS record, as
  on `k3s` and `ovh-mks`, so `--dry-run` shows them and an apply whose only
  change is a DNS record now writes it. Before, such an apply planned nothing
  and returned without touching the zone. DNS rows are always `Create`: the
  plan does not read the zone, apply converges it.

### Added

- `upcloud-uks` distro: UpCloud Managed Kubernetes clusters with an SDN
  network and router, node groups, block volumes (`@kumulo/volumes-upcloud`)
  and Managed Object Storage buckets (`@kumulo/storage-upcloud`), on the
  `@kumulo/upcloud` API client. Authenticated with `UPCLOUD_API_TOKEN`.
- `kumulo doctor <config>` runs the distro's preflight checks against its
  provider and exits 20 when one fails.
- `@kumulo/bunny`: bunny.net Core and Shield API client with Schema-decoded responses and retry on 429/5xx.
- `@kumulo/dns-bunny`: `dns.module: bunny`, including PullZone records for CDN apex hostnames and `target: cdn`.
- `@kumulo/storage-bunny`: `object_storage.module: bunny`, one S3-type storage zone per bucket with per-bucket credentials in the sops sink.
- `@kumulo/cdn-bunny` and a new `CdnProvider` core port: optional `cdn` block (`module: bunny`) with pull zone, hostnames, free certificates and Shield (WAF, DDoS, bot detection, rate limits, access lists). Ids are written to `<cluster>.cdn.yaml`.
- `BUNNYNET_API_KEY` credential and the `examples/k3s-bunny.yaml` and `examples/ovh-mks-bunny-cdn.yaml` configs.
- DNS records via GoDaddy (`@kumulo/dns-godaddy`, `dns.module: godaddy`),
  authenticated with a personal access token in `GODADDY_API_TOKEN`. TTL must
  be at least 600 and the apex cannot hold a CNAME.
- Cluster addons: provider addons (OpenStack CCM and Cinder CSI, Hetzner CCM
  and CSI) live in the provider packages, Cilium and the system upgrade
  controller in `@kumulo/distro-k3s`; `@kumulo/core` applies them.
- `ovh-mks`: optional `network` block (`cidr`, `nodes_subnet`,
  `load_balancers_subnet`) — kumulo creates the private network and both
  subnets and hands their ids to MKS at cluster creation. Absent means the
  previous behaviour, OVH's default public addressing. Requires a project
  vRack, checked before anything is created.
- `ovh-mks`: optional `ingress` block (`flavor_id`) — one empty public Octavia
  load balancer with a floating IP, for an in-cluster Service to adopt by id
  (`loadbalancer.openstack.org/load-balancer-id`). Its listeners, pools and
  members belong to the cloud-controller-manager; kumulo never touches them or
  reports them as drift. Only valid alongside `network`.
- `<cluster>.outputs.yaml` gained `ingress.load_balancer_id` and
  `ingress.floating_ip` beside the volume ids. Ids and addresses only — the
  file is not encrypted.
- DNS records with `target: ingress` resolve to that floating IP, for both plan
  and apply. `target: api_server` is unchanged, and an unrecognised target
  still passes through literally.
- `delete` tears down the load balancer, the floating IP and the network after
  the cluster. A network is never retained; `retain` on volumes and buckets is
  unchanged.

### Changed

- **BREAKING:** `addons.cinder_csi` and `addons.hcloud_csi` are replaced by one
  provider-neutral `addons.csi { enabled, default_volume_type? }`. Migrate on
  Hetzner by deleting `cinder_csi` and renaming `hcloud_csi` to `csi`; on
  OpenStack (ovh, generic) delete `hcloud_csi` and rename `cinder_csi` to `csi`
  (`default_volume_type` is now optional; omitting it uses the cloud's default
  volume type). A config without `csi` is rejected with a pointer to the new
  block.
- Built on Effect 4.1.0 (was 4.0.0-beta.102), vitest 5, oxlint 1.90 and bun
  1.4.4. Generated OpenAPI clients are regenerated with the 4.1 generator and
  keep their previous closed struct types.
- `kumulo.schema.json` inlines its definitions instead of using `$ref`s; the
  accepted config is unchanged.
- Lint now also runs the vendored anti-slop rules
  ([dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop)), including the
  Effect rule group.
- UpCloud: `control_plane_ip_filter` is left unmanaged when omitted, and `[]`
  (deny all) is rejected because it would lock kumulo out of the control plane.
- UpCloud: the node-pool taint syntax is `key[=value][:Effect]`.
- UpCloud: pool labels are applied to new node groups. Existing groups need a
  replace to get them.
- UpCloud: cluster names must be 3-55 characters (`[a-z0-9-]`), versions have
  no `v` prefix, and the UKS reserved CIDRs are rejected.
- UpCloud object storage: users get the `ECSS3FullAccess` policy.
- UpCloud teardown refuses to remove an object storage service that holds
  unmanaged buckets.

### Removed

- `@kumulo/addons`. Its addons moved into the provider and distro packages
  (see `addons.csi` above).
- The single-file executable build. The CLI runs on node from
  `@kumulo/cli`'s `dist/main.mjs`.

### Fixed

- UpCloud: no retry of POST on 5xx, request timeout, `Retry-After` honoured,
  and `*_LIMIT_REACHED` 403s reported as quota errors.
- UpCloud UKS: wire shapes (upgrade strategy object, `kubelet_args`, lenient
  states), IP filter on every PATCH, version drift, upgrade ordering and wait,
  early 404s, fail-fast on `failed`, and awaited node-group deletes.
- UpCloud networks, routers and volumes are scoped by label and zone, and
  teardown retries conflicts.
- UpCloud object storage: paginated lists, region and bucket schemas, one
  service ensure, stopped and deleting states, and credentials refreshed on
  every run.
- `--yes`, `--dry-run` and `--show-env` failed with "Missing required flag"
  when omitted under Effect 4.1; they default to off again.
- `ensureNetwork`'s existing-network path re-reads the network's subnets
  instead of returning without them, so a re-apply and a first apply agree.
- DNS: the CLI never wrote the `kumulo.cluster=<tag>` ownership TXT record, so
  a second apply saw its own records as foreign and `delete` removed nothing.
- DNS: a record whose target changed kind (`CNAME` ⇄ `A`) left the stale rrset
  in place beside the new one. Fixed in both the OVH and Hetzner adapters.

## [0.1.1] - 2026-07-27

### Added

- Initial public release of the `kumulo` CLI and the `@kumulo/*` packages.
- `k3s` distro: self-managed cluster on OVH Cloud instances (cloud-init,
  SSH bootstrap, control-plane/worker install).
- `ovh-mks` distro: OVH Managed Kubernetes clusters and node pools.
- Cinder volumes and PVC rendering (`@kumulo/volumes-cinder`).
- OVH object storage buckets (`@kumulo/storage-ovh`).
- DNS records via OVH (`@kumulo/dns-ovh`) and Hetzner (`@kumulo/dns-hetzner`).
- Cluster addons: Cilium, Cinder CSI, cloud-conf secret (`@kumulo/addons`).
- SOPS-encrypted credential sink (`@kumulo/secrets-sops`).
- Single-file executable build (`bun run build:binary`).
