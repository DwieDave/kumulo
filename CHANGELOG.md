# Changelog

All notable changes to kumulo are documented here. Format:
[Keep a Changelog](https://keepachangelog.com); semantics:
[SemVer](https://semver.org).

## [Unreleased]

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

### Fixed

- `ensureNetwork`'s existing-network path re-reads the network's subnets
  instead of returning without them, so a re-apply and a first apply agree.
- DNS: the CLI never wrote the `kumulo.cluster=<tag>` ownership TXT record, so
  a second apply saw its own records as foreign and `delete` removed nothing.
- DNS: a record whose target changed kind (`CNAME` ⇄ `A`) left the stale rrset
  in place beside the new one. Fixed in both the OVH and Hetzner adapters.
