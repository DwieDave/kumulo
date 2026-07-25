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
