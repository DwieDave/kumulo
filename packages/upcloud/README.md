# @kumulo/upcloud

Hand-written UpCloud API client: Managed Kubernetes (UKS) clusters and node
groups, plus the SDN network and router resources a UKS cluster needs.

Part of [kumulo](../../README.md) — a CLI that provisions and manages
Kubernetes clusters on OVH, Hetzner, OpenStack and UpCloud from a single YAML
config. This package is published from that workspace and is normally
consumed through the `kumulo` CLI rather than directly.

```sh
bun add @kumulo/upcloud
```

## Why hand-written (D1)

Every other provider client in this workspace (`@kumulo/hetzner`,
`@kumulo/dns-hetzner`, `packages/openstack`'s generated clients,
`tools/ovh2openapi`) is generated from a vendor-published OpenAPI spec via
`@effect/openapi-generator`. UpCloud publishes no such spec — its API
reference is hand-maintained prose, not a machine-readable document — so
this package is hand-written against that documentation instead, and is
**deliberately exempt from `codegen:check`**: it is simply absent from
`tools/codegen/services.json`, the registry that drives regeneration and
staleness checking, so there is nothing for that check to compare against.

## D15 — a narrow dependency-cruiser exception

`@kumulo/distro-upcloud-uks` depends on this package, which is an edge
`no-sibling-package-imports` forbids as written (non-core siblings may not
depend on each other). `.dependency-cruiser.cjs` relaxes that rule for
*incoming* edges into `@kumulo/upcloud` only — this package is treated like
`@kumulo/core` from the outside. Its own *outgoing* imports stay fully
governed by the original rule: `@kumulo/upcloud` may still import
`@kumulo/core` and nothing else, keeping it a dependency leaf. See D15 in
`.docs/workflows/upcloud-uks/requirements.md`.

See the [root README](../../README.md) for configuration, commands and
examples, and the [changelog](../../CHANGELOG.md) for release notes.
