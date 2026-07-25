# Memories

- DNS record kind (A vs CNAME) is inferred by the providers from the target
  *value* (`recordKind` in dns-ovh/dns-hetzner); `DesiredRecord` has no type
  field — `DnsTarget.kind` only selects the substituted value.
- `dnsProviderLayerFor` requires `HttpClient`; provided once in `main.ts`.
  Tests use the `*Effect` variants (`applyMksEffect`/`deleteMksEffect`) with
  `dnsNoopLive`.
- Lint gates implementers missed: dep-cruiser forbids deep package imports
  (export from the package index instead); oxlint `no-multiple-function-params`
  forces single-object params in cli src.
- Plan DNS rows are always `Create` — no existing-record diffing until a
  DnsProvider list verb is wired into planning.
