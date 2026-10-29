# @kumulo/dns-bunny

DNS provider for bunny.net zones. The zone must already exist. It keeps one value per name and kind, writes the `kumulo.cluster=<tag>` TXT ownership record, and creates a PullZone record (type 7) for a CDN hostname at the zone apex.

Part of [kumulo](../../README.md) — a CLI that provisions and manages
Kubernetes clusters on OVH from a single YAML config. This package is
published from that workspace and is normally consumed through the `kumulo`
CLI rather than directly.

```sh
bun add @kumulo/dns-bunny
```

See the [root README](../../README.md) for configuration, commands and
examples, and the [changelog](../../CHANGELOG.md) for release notes.
