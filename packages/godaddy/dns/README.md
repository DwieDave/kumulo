# @kumulo/dns-godaddy

DnsProvider implementation backed by the GoDaddy Domains DNS API.

Part of [kumulo](../../../README.md) — a CLI that provisions and manages
Kubernetes clusters on OVH from a single YAML config. This package is
published from that workspace and is normally consumed through the `kumulo`
CLI rather than directly.

```sh
bun add @kumulo/dns-godaddy
```

## Usage

Set `dns.module: godaddy` and export `GODADDY_API_TOKEN`, a personal access
token with scope `domains.dns:update` from
https://developer.godaddy.com/personal-access-token. `GODADDY_API_BASE_URL` is
optional. TTLs must be at least 600, and a CNAME cannot sit on the apex. A 403
means a missing scope or an account GoDaddy does not allow to use the DNS API.
The root README's "GoDaddy DNS" section covers eligibility, OTE and the
nameserver fallback.

See the [root README](../../../README.md) for configuration, commands and
examples, and the [changelog](../../../CHANGELOG.md) for release notes.
