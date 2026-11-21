# @kumulo/dns-cloudflare

DnsProvider implementation backed by the Cloudflare API v4.

Part of [kumulo](../../../README.md) — a CLI that provisions and manages
Kubernetes clusters from a single YAML config. This package is published from
that workspace and is normally consumed through the `kumulo` CLI rather than
directly.

```sh
bun add @kumulo/dns-cloudflare
```

## Usage

Set `dns.module: cloudflare` and export `CLOUDFLARE_API_TOKEN`, an API token
with the permissions Zone:Read and DNS:Edit on the zone (dash.cloudflare.com,
My Profile, API Tokens). `CLOUDFLARE_API_BASE_URL` is optional and overrides
`https://api.cloudflare.com/client/v4`.

```yaml
dns:
  module: cloudflare
  zone: example.com
  ttl: 300
  records:
    - name: "*.prod"
      target: 203.0.113.10
```

- `dns.ttl` is 1 (Cloudflare's "automatic") or 60 to 86400.
- A, AAAA and CNAME records are written with `proxied: false`. An owned record
  someone switched to proxied is switched back on the next apply.
- Each name gets an ownership TXT `"kumulo.cluster=<cluster>"` at `_kumulo.<name>`
  (`_kumulo._wildcard.<parent>` for `*.<parent>`, `_kumulo` for the apex), so a
  CNAME keeps its name to itself.
- A CNAME at the apex is allowed; Cloudflare flattens it.
- The zone is looked up by name with `GET /zones?name=`. A token that cannot
  see it fails the preflight before anything is created.

`kumulo doctor` checks that the token sees the zone and that the domain is
delegated to the nameservers Cloudflare assigned to it.

The client follows the trimmed OpenAPI spec in `specs/cloudflare-dns-v4.json`.
Refresh it with `bun run specs:update:cloudflare` from the repo root.

See the [root README](../../../README.md) for configuration, commands and
examples, and the [changelog](../../../CHANGELOG.md) for release notes.
