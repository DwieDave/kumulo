# Scope: `dns-hetzner` — Hetzner DNS via cluster config

Status: DRAFT — pending human approval.

## In scope

1. **Config**: `DnsModule` (`packages/core/src/config/schema.ts:24`) gains the
   literal `"hetzner"`:

   ```yaml
   dns:
     module: hetzner        # ovh | designate | none | hetzner
     zone: example.com
     ttl: 300
     records:
       - name: api.prod-eu
         target: api_server
       - name: "*.apps.prod-eu"
         target: ingress
   ```

   No new config fields beyond the literal — `zone`/`ttl`/`records` are already
   backend-agnostic on `ClusterConfig`.

2. **New package `packages/dns-hetzner`**, mirroring `dns-ovh`'s layout:
   - `client/` — thin HTTP client over Hetzner Cloud API's `/zones` +
     `/zones/{id_or_name}/rrsets*` endpoints (hand-written, see D1).
   - `provider/dns-provider.ts` — `ensureRecords`/`removeClusterRecords` against
     the RRset model, same TXT-tag ownership convention as `dns-ovh`.
   - `provider/errors.ts` — HTTP status → `DnsError` mapping.
   - `provider/ownership.ts` — reused convention (`kumulo.cluster=<tag>` TXT
     value), record-kind inference.
   - `test/` — the existing `runDnsProviderContractSuite` run against an
     in-memory fake Hetzner backend.

3. **Auth**: `HETZNER_DNS_TOKEN` read via `Config.redacted` (reusing
   `requiredRedactedEnv` from `packages/cli/src/mks/env.ts`), sent as
   `Authorization: Bearer <token>` on every request. No token-refresh/cache Layer
   (static token) — a real scope reduction vs. `provider-ovh`'s OAuth2 machinery.

4. **Transport**: retry-on-429/5xx wrapped `HttpClient.HttpClient`, mirroring
   `packages/openstack/src/transport/http-client.ts`'s shape (exp backoff +
   jitter, bounded retries) — new territory for `DnsProvider` (`dns-ovh` has no
   retry logic today).

5. **CLI wiring fix** (`packages/cli/src/k3s/reconcile.ts`): the three
   `config.dns.module === "ovh"` / `!== "ovh"` call sites (`_reconcileDns`,
   `_dnsLayer`, `deleteK3sEffect`) become a single module→Layer/behavior
   dispatch that (a) handles `"hetzner"` the same way it handles `"ovh"` today,
   and (b) fails loudly (`ConfigInvalid`) for any non-`"none"` module without a
   wired implementation, instead of silently falling through to the no-op
   provider. This also closes the pre-existing `"designate"` gap as a side
   effect, without implementing designate.

6. `examples/k3s.yaml` reviewed (stays `module: ovh` — a second example isn't
   required to prove the schema literal decodes; a schema decode test covers
   `module: hetzner` instead, see plan.md).

## Out of scope

- Multi-value RRset reconciliation — see D2 (OPEN).
- Zone creation/deletion (kumulo only manages records within an existing zone,
  same as `dns-ovh` — zone is assumed pre-provisioned).
- Non-DNS Hetzner Cloud resources.
- `dns.module: "designate"` implementation.
- ovh-mks distro DNS wiring (doesn't exist for any provider yet).
- Rotating/short-lived `HETZNER_DNS_TOKEN`; a static token is the only supported
  shape (matches how the Cloud Console issues them).

## Resolved (research-stage, needs human re-confirmation in Phase 1)

1. Target API is Hetzner Cloud API DNS zones/RRsets (`api.hetzner.cloud/v1`),
   not the retired `dns.hetzner.com` API — see intent.md's "critical fact."
2. Auth is `Authorization: Bearer <token>`, not `Auth-API-Token`.
