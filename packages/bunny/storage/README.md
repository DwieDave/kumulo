# @kumulo/storage-bunny

Object storage provider for bunny.net. Each bucket is one S3-type storage zone, tracked by id in `<cluster>.buckets.yaml`. Zone names are globally unique and checked at plan time, and a zone with files in it is never deleted. The bunny S3 API is a public preview: no versioning, no server-side encryption, no lifecycle rules, and a limit of 500 requests per second per zone.

Part of [kumulo](../../../README.md) — a CLI that provisions and manages
Kubernetes clusters on OVH from a single YAML config. This package is
published from that workspace and is normally consumed through the `kumulo`
CLI rather than directly.

```sh
bun add @kumulo/storage-bunny
```

See the [root README](../../../README.md) for configuration, commands and
examples, and the [changelog](../../../CHANGELOG.md) for release notes.
