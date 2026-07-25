# Requirements

## Functional

- FR1: With `distro: ovh-mks` + `dns.module: hetzner`, `apply` ensures the
  configured DNS records in the Hetzner zone.
- FR2: `api_server` record targets resolve per distro:
  - k3s → A record pointing at `infra.lbVip` (unchanged behavior).
  - ovh-mks → CNAME record pointing at the hostname of
    `ManagedClusterInfo.apiEndpoint`.
- FR3: `delete` removes cluster-owned DNS records on both distros.
- FR4: Config validation rejects `dns.module` values the CLI does not wire for the
  chosen distro (`ovh`/`designate` stay k3s-only; `hetzner` and `none` valid for
  both distros) with a clear error message.
- FR5: `plan` output includes DNS record actions for both distros.

## Non-functional

- NFR1: k3s DNS behavior is unchanged (pure refactor on that path).
- NFR2: No new dependencies; reuse `dns-hetzner` package and existing Effect layers.
- NFR3: Functions stay small; target type is a discriminated union
  (`{ kind: "ip" | "hostname"; value: string }`) with pattern matching, not flags.
- NFR4: Property tests where practical (target mapping, validation filter);
  otherwise minimal unit tests.

## Design decisions

- D1: Shared module `packages/cli/src/dns.ts` holds `reconcileDns`,
  `removeDns`, and `dnsProviderLayerFor` (moved from `k3s/reconcile.ts`).
- D2: `DnsTarget` union decides record type: `ip` → A, `hostname` → CNAME.
- D3: MKS hostname derived via `new URL(info.apiEndpoint).hostname`; empty
  `apiEndpoint` is a reconcile error, not a silent skip.
- D4: Validation implemented as one additional cross-field filter in
  `packages/core/src/config/schema.ts` alongside the existing five.
