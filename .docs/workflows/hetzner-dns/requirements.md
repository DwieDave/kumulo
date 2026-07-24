# Requirements: `dns-hetzner` — Hetzner DNS via cluster config

Status: DRAFT — awaiting human approval.

## Functional requirements

- **R1 — Config schema.** `DnsModule` (`packages/core/src/config/schema.ts:24`)
  gains the literal `"hetzner"`: `Schema.Literals(["ovh", "designate", "none",
  "hetzner"])`. No other schema change — `zone`/`ttl`/`records` are reused as-is.
- **R2 — Core port reuse.** `dns-hetzner` implements the existing `DnsProvider`
  port verbatim (`packages/core/src/ports/dns-provider.ts`) — no port change, no
  new error type. `DnsError = ResourceNotFound | ResourceConflict |
  AuthenticationFailed` is the full error surface (same constraint `dns-ovh`
  works under).
- **R3 — Client.** Hand-written thin HTTP client (`packages/dns-hetzner/src/client`)
  over Hetzner Cloud API: `GET /zones/{id_or_name}` (resolve zone name →
  numeric id + confirm existence), `GET /zones/{id_or_name}/rrsets/{rr_name}/{rr_type}`
  (read one), `PUT /zones/{id_or_name}/rrsets/{rr_name}/{rr_type}` (create-or-replace
  the full record set), `DELETE /zones/{id_or_name}/rrsets/{rr_name}/{rr_type}`,
  `GET /zones/{id_or_name}/rrsets` (list, for `removeClusterRecords`'s ownership
  scan). No zone create/delete, no `add_records`/`remove_records`/`change_ttl`
  action endpoints (PUT-the-whole-set covers kumulo's single-value semantics,
  see D2) — see D1.
- **R4 — `ensureRecords`.** Create-or-update every `DesiredRecord` to its target,
  same TXT-ownership-guard contract as `dns-ovh`
  (`packages/dns-ovh/src/provider/dns-provider.ts`): a same-name TXT record in
  the batch is claimed as the ownership record; any pre-existing non-TXT RRset
  at that name not already owned by this batch's tag, or a foreign-tag TXT
  ownership RRset, refuses with `ResourceConflict` rather than overwriting.
  Record kind (A/AAAA/CNAME/TXT/...) inferred client-side the same way
  `dns-ovh/src/provider/ownership.ts::recordKind` does (IPv4/IPv6-regex or not).
- **R5 — `removeClusterRecords`.** List RRsets in the zone, delete only those at
  names whose TXT ownership RRset carries this cluster's tag — same scan-then-delete
  shape as `dns-ovh`'s `removeClusterRecords`.
- **R6 — CLI wiring, loud on unhandled modules.** `packages/cli/src/k3s/reconcile.ts`
  replaces its three `config.dns.module === "ovh"` / `!== "ovh"` inline checks
  (`_reconcileDns`, `_dnsLayer`, `deleteK3sEffect`) with one small
  `module → DnsProvider Layer` dispatch function, reused at all three sites:
  `"ovh"` → `k3sDnsProviderLayer()`, `"hetzner"` → the new
  `k3sHetznerDnsProviderLayer()`, `"none"` → `dnsNoopLive`
  (`packages/core/src/dns-noop`), any other value (today only `"designate"`) →
  fail `ConfigInvalid` rather than silently degrading to the no-op provider.
  This is the loud-failure fix the research brief flagged; it also closes the
  pre-existing `"designate"` silent-noop gap as a side effect, without
  implementing designate.
- **R7 — Env.** `HETZNER_DNS_TOKEN` read via `requiredRedactedEnv("HETZNER_DNS_TOKEN")`
  (`packages/cli/src/mks/env.ts`, already exported/reused cross-package), sent
  as `Authorization: Bearer <token>` via `HttpClientRequest.bearerToken` +
  `HttpClientRequest.prependUrl("https://api.hetzner.cloud/v1")` on a wrapped
  `HttpClient.HttpClient` — mirrors `ovhHttpClientLayer`'s request-wrapping
  shape (`packages/provider-ovh/src/auth/client.ts`) but with **no** auth
  port/service, no token cache, no `Layer.effect` fetch step: the token is
  static, read once at Layer construction.
- **R8 — Test contract reuse.** `packages/dns-hetzner/test` runs
  `runDnsProviderContractSuite` (`packages/dns-ovh/test/provider/contract.ts`)
  unmodified against an in-memory fake `ContractHarness` implementation of the
  Hetzner RRset model (all 6 existing cases: create+TXT, update, refuse-foreign,
  refuse-foreign-kind, refuse-foreign-owner-TXT, tag-scoped delete).
- **R9 — Examples/docs.** `HETZNER_DNS_TOKEN` documented alongside
  `OVH_CLIENT_ID`/`OVH_CLIENT_SECRET` wherever env vars are enumerated for
  operators (README/CLI env doc, whichever `dns-ovh`'s vars are already listed
  in). No `examples/*.yaml` file needs a `module: hetzner` variant to prove the
  literal decodes — a schema decode test covers it (existing examples stay
  `ovh`/`none`, matching precedent that adding a module literal doesn't
  obligate an example rewrite, see `"designate"`).

## Non-functional requirements

- **N1 — Idempotent re-runs.** `ensureRecords` is a converge-from-any-state
  operation: re-running with the same desired records against an
  already-correct backend is a no-op (PUT is compared against current RRset
  value before sending, mirroring `dns-ovh`'s `existingRecord.target !== target`
  guard — not an unconditional PUT every run).
- **N2 — Resilience.** Bounded retry-on-429/5xx at the `HttpClient` wrapping
  layer: `Schedule.exponential("200 millis", 2).pipe(Schedule.jittered)`, max 5
  attempts — same constants as `packages/openstack/src/transport/http-client.ts`.
  New territory for `DnsProvider` (`dns-ovh` has none); justified by Hetzner's
  documented, always-present `RateLimit-*` headers and a project-wide shared
  3600/hr budget. No header-based backoff-pacing (reading
  `RateLimit-Remaining`/`RateLimit-Reset` to pre-empt 429s) — the retry-after-429
  loop already handles the failure case; header inspection is speculative
  scope this feature doesn't need (ponytail: reactive retry only, add
  proactive pacing if 429s are observed in practice despite the retry).
- **N3 — Loud tagged-error failures.** Every failure path maps to a `DnsError`
  member (`AuthenticationFailed` for 401/403, `ResourceNotFound` for 404,
  `ResourceConflict` for 409 and as the fallback for anything else including
  retry-exhausted 429/5xx — same status→tag table shape as
  `dns-ovh/src/provider/errors.ts`, `ponytail:`-flagged where the mapping is a
  deliberate fallback, not a real distinction). R6 covers config-level
  loudness (unhandled `dns.module` values).
- **N4 — Plan/diff scope note.** DNS records are not part of kumulo's
  create/scale plan diff today for *any* provider (`dns-ovh` included — grep of
  `packages/cli/src/{mks,k3s}/plan.ts` confirms no `dns` references); `dns-hetzner`
  does not add plan-diff visibility for DNS records either, consistent with the
  existing precedent. Extending plan rendering to cover DNS is out of scope
  here (would be a `dns-ovh`+`dns-hetzner` cross-cutting feature, not specific
  to this package).
- **N5 — Per-resource logging.** Each create/update/delete RRset call logs at
  the same granularity `dns-ovh` does today (implicit per-Effect-span logging,
  no bespoke logging code added).
- **N6 — Retain semantics: not applicable.** DNS records have no `retain` flag
  in `ClusterConfig` (unlike volumes/buckets) — `removeClusterRecords` deletes
  every tag-owned record unconditionally, same as `dns-ovh` today. No retain
  behavior to add.
- **N7 — Effect Config + Redacted secrets.** `HETZNER_DNS_TOKEN` is read only
  via `Config.redacted` (R7); never logged, never appears in error messages,
  never round-trips through a plain `string` outside the request-header
  boundary that unwraps it.
- **N8 — Codegen regen-noop gate: not applicable.** No generated client (D1) —
  nothing to register in `codegen:check`.
- **N9 — Repo conventions.** Functions ≤ 20–30 lines; dependency-cruiser
  barrel-only imports; oxlint/typecheck/vitest green; Effect `Effect<A,E,R>`
  kept intact end to end (no `as never`).

## Design choices

- **D1 — Hand-written thin client, not codegen (approved by justification
  below, needs human sign-off).** `dns-ovh`'s *generated* client is 199 lines
  for 6 operations even with real codegen tooling and an aggressively
  allowlist-trimmed first-party spec; `dns-hetzner` needs a similar-sized
  surface (5 endpoints, R3) with **no confirmed official OpenAPI spec** to
  trim — only a third-party, explicitly "unofficial" community spec
  (`MaximilianKoestler/hcloud-openapi`, ~1.1–2.9MB) that would need vendoring,
  pinning, and a new `services.json` entry for a handful of calls. The generic
  OpenStack-style pipeline (`tools/codegen` + `services.json`, community-spec
  precedent already exists via `gtema/openstack-openapi`) is the closer fit
  *if* codegen is wanted, but the ops count here doesn't clear the bar that
  justified it for OpenStack's 6-service, dozens-of-operations surface.
  Recommendation: hand-written typed fetch wrappers (mirrors
  `dns-ovh/src/client/dns.ts`'s thin-reexport role, minus a generated file
  behind it), Schema-decoded responses using the project's existing
  `Schema`-over-`HttpClient` pattern. Revisit codegen if Hetzner ever
  publishes an official spec or the endpoint surface grows materially.
- **D2 (OPEN — needs human decision) — Single-value RRsets only.**
  `DesiredRecord.target` (`packages/core/src/domain/types.ts:104`) is one value
  per record; Hetzner's RRset model natively supports multiple `records[]`
  values per `(name, type)`. Recommendation: `dns-hetzner` only ever writes a
  single-value `records: [{value: target}]` array (PUT replaces the whole set,
  R3) and treats a **foreign multi-value RRset it didn't create** as owned-or-conflict
  by the same TXT-ownership-guard rule as any other foreign record (R4) — it
  never merges into an existing multi-value set. This mirrors OVH behavior
  1:1 and needs no new `DesiredRecord` shape. Flag as OPEN because it's a new
  data-model question `dns-ovh` never had to answer; the alternative (exposing
  multi-value RRsets through the port) would require a `DnsProvider`/`DesiredRecord`
  shape change affecting `dns-ovh` too — out of scope unless the human wants it.
- **D3 — Static bearer token, no auth service (approved).** No `HetznerAuth`
  port/service parallel to `provider-ovh`'s `OvhAuth` — Hetzner Cloud API
  tokens are static and long-lived (R7); building token-cache/refresh
  machinery "for consistency" with OVH would be unrequested abstraction for a
  mechanism that doesn't exist on this backend.
- **D4 — Retry-on-429/5xx at transport layer (approved).** Reuses
  `openstack/http-client.ts`'s exact schedule constants (N2) rather than
  inventing new ones — no justification to diverge.
- **D5 — Errors fold to `ResourceConflict` fallback (approved, consistency
  choice).** `DnsError`'s three-member union has no rate-limit/5xx-specific
  tag; `dns-hetzner` reuses `dns-ovh`'s exact fallback-to-`ResourceConflict`
  pattern (N3) rather than proposing a `DnsError` union change — keeps both
  DNS providers' error surface identical for CLI/caller code that pattern-matches
  on `DnsError`.

Note: `HETZNER_DNS_TOKEN` and the k3s feature's `HCLOUD_TOKEN` are both hcloud
project API tokens against `api.hetzner.cloud/v1`; a single token can serve both.
They stay separate env vars so DNS-only and k3s-only setups don't over-scope, but
users may set both to the same value.
