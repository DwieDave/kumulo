# @kumulo/cdn-bunny

CDN provider for bunny.net. It manages one pull zone with its origin, cache mode and hostnames, requests free certificates, and converges Shield (WAF, DDoS, bot detection, rate limits, access lists) by name. Ids are tracked in `<cluster>.cdn.yaml`. Shield has no delete call, so removing the CDN resets Shield to the basic plan with WAF off.

Part of [kumulo](../../README.md) — a CLI that provisions and manages
Kubernetes clusters on OVH from a single YAML config. This package is
published from that workspace and is normally consumed through the `kumulo`
CLI rather than directly.

```sh
bun add @kumulo/cdn-bunny
```

See the [root README](../../README.md) for configuration, commands and
examples, and the [changelog](../../CHANGELOG.md) for release notes.
