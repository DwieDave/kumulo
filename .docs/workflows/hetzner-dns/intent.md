# Intent: `dns-hetzner` — Hetzner DNS via cluster config

Status: DRAFT — pending human approval.

## Problem

kumulo's `DnsProvider` port (`packages/core/src/ports/dns-provider.ts`) has one live
backend today, `dns-ovh`. Clusters whose zone is hosted at Hetzner instead of OVH have
no way to get `dns.module` reconciliation (create/update the `api_server`/`ingress`
records, TXT-tag ownership, tag-scoped delete) — DNS for those clusters is either
hand-driven outside kumulo or silently left unmanaged (`module: none`).

## Critical fact that changes the premise (verify before scoping further)

The task as originally framed ("target `dns.hetzner.com`, static `Auth-API-Token`
header") describes an API that **no longer exists**. Hetzner shut it down on a public
timeline:

- New-zone creation on the old DNS Console/API disabled **2025-11-10**.
- Old DNS Console & API went **read-only 2026-05-20**, then **fully removed
  2026-05-27** — `dns.hetzner.com` now 301-redirects to `console.hetzner.com`.
  ([status.hetzner.com incident](https://status.hetzner.com/incident/c2146c42-6dd2-4454-916a-19f07e0e5a44))
- DNS is now merged into the **Hetzner Cloud API** (`api.hetzner.cloud/v1`), GA since
  **2025-11-10** ([docs.hetzner.cloud/changelog](https://docs.hetzner.cloud/changelog)).
  Auth is standard hcloud: `Authorization: Bearer <token>` (a project-scoped static
  token minted in the Cloud Console) — **not** `Auth-API-Token`. Old DNS-Console
  tokens do not work against it
  ([docs.hetzner.com migration guide](https://docs.hetzner.com/networking/dns/migration-to-hetzner-console/features-and-differences/)).
- The data model changed from OVH-shaped (flat records-by-numeric-id) to **RRsets**:
  a resource keyed by `(zone, rr_name, rr_type)` holding a `records: [{value}, ...]`
  array, a TTL, optional change-protection, and labels.
- Rate limit is the standard hcloud limit: 3600 req/hour per project, refill 1
  req/sec, `RateLimit-Limit`/`RateLimit-Remaining`/`RateLimit-Reset` response
  headers, 429 on breach. (The older "300 req/min" figure some posts cite is for
  the dead API — not carried forward here.)

**This plan targets DNS zones/RRsets inside the Hetzner Cloud API — the only
live option.** `HETZNER_DNS_TOKEN` therefore holds a Cloud API project token
(broader scope than DNS alone; Hetzner's console does let you scope a token to
specific resources including zones, but the env var's *semantic* contents are a
general hcloud bearer token either way).

## Intent

Add `packages/dns-hetzner`, a `DnsProvider` implementation against Hetzner Cloud
API DNS zones/RRsets, selected via `dns.module: hetzner` in `ClusterConfig`. Same
lifecycle contract as `dns-ovh`: idempotent `ensureRecords`/`removeClusterRecords`,
TXT-tag ownership convention, wired into the k3s reconcile path
(`packages/cli/src/k3s/reconcile.ts`) the same way `dns.module: ovh` is today.

## Motivating observations

- `DnsProvider` is a small, backend-agnostic port; `dns-ovh` is the concrete
  precedent for shape, size, and test-contract reuse
  (`packages/dns-ovh/test/provider/contract.ts`'s `runDnsProviderContractSuite`
  is explicitly written to run unmodified against any implementation).
- Hetzner Cloud API tokens are static and long-lived — no OAuth2 exchange/cache
  machinery is needed (`provider-ovh`'s ~130-line `auth/{port,client,live}.ts` has
  no Hetzner equivalent to build).
- `dns.module` already has an unimplemented placeholder (`"designate"`) that
  silently degrades to the no-op provider at all three CLI wiring sites in
  `reconcile.ts` — a real "loud failures, never silent skips" violation this
  feature must not repeat for `"hetzner"`.

## Non-goals (this feature)

- Multi-value RRset management (Hetzner-side round-robin sets kumulo didn't
  create) — see D2 (OPEN) in requirements.md for the exact boundary.
- Non-DNS Hetzner Cloud API resources (servers, load balancers, volumes) — token
  scope reuse stops at DNS.
- Fixing the pre-existing `dns.module: "designate"` silent-noop gap beyond making
  the *new* fallback loud for every module (a one-line side effect of R6, not a
  dedicated designate implementation).
- ovh-mks distro wiring — like `dns-ovh`, only the k3s reconcile path
  (`packages/cli/src/k3s/reconcile.ts`) currently composes `DnsProvider` at all;
  no ovh-mks DNS wiring exists to extend.
- Migrating existing `dns-ovh` zones to Hetzner, or any cross-provider DNS
  migration tooling.
