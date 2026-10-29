# @kumulo/bunny

Hand-written bunny.net API client shared by the other bunny packages. It covers the Core API (DNS zones and records, storage zones, pull zones and hostnames) and the Shield API, authenticates with the `AccessKey` header from a redacted `BUNNYNET_API_KEY`, decodes every response with Schema, and retries 429 and 5xx responses with jittered exponential backoff.

Part of [kumulo](../../../README.md) — a CLI that provisions and manages
Kubernetes clusters on OVH from a single YAML config. This package is
published from that workspace and is normally consumed through the `kumulo`
CLI rather than directly.

```sh
bun add @kumulo/bunny
```

See the [root README](../../../README.md) for configuration, commands and
examples, and the [changelog](../../../CHANGELOG.md) for release notes.
