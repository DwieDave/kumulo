# Research: GoDaddy DNS as a kumulo DNS module

Researched 2026-10-29 from GoDaddy's developer portal, the vendored OpenAPI
specs, and the lego and external-dns GoDaddy providers. Items marked
**UNVERIFIED** were not confirmed by a primary source or a live call.

Vendored specs (gitignored, for implementers):
`.references/godaddy/domains-v3.json` and `.references/godaddy/domains-v1.json`,
from https://developer.godaddy.com/openapi/domains-v3.json and
https://developer.godaddy.com/openapi/domains-v1.json (OpenAPI 3.1; index at
https://developer.godaddy.com/llms.txt).

## Which API

| | v3 (target) | v1 (legacy) |
| --- | --- | --- |
| Auth | `Authorization: Bearer <PAT>` | `Authorization: sso-key KEY:SECRET` |
| Status | Current; launched with the new developer portal on 2026-07-14 | `sso-key` is "deprecated for Domains (through 2026)" and does not work with v3 |
| Record model | Individual records with a server-assigned `recordId` | rrset-like: `PUT /records/{type}/{name}` replaces every value at that name and type |
| Base URL | `https://api.godaddy.com/v3/domains` | `https://api.godaddy.com/v1/domains` |

Sources: https://developer.godaddy.com/llms.mdx/api-users/auth,
https://developer.godaddy.com/docs/api-users/changelog/developer-portal-launch,
https://developer.godaddy.com/doc/endpoint/domains.

**Personal Access Tokens (PATs).**
- Created at https://developer.godaddy.com/personal-access-token. The token is
  shown once, and it can be revoked instantly.
- Expiry: 7, 30, 60 or 90 days, or 1 year.
- Scopes: `domains.domain:read` for reads; `domains.dns:update` for creating,
  replacing and deleting DNS records. A write scope also allows reads.

## v3 DNS endpoints

These sit under `/v3/domains`. There is no "get zone" endpoint for DNS.

| Op | Call | Success |
| --- | --- | --- |
| List | `GET /zones/{zone}/dns-records?type=&name=&page=&pageSize=` | 200 `{items, links[{rel,href}], totalItems?, totalPages?}` |
| Create | `POST /zones/{zone}/dns-records` (one record) | 201 + `Location` header |
| Replace by id | `PUT /zones/{zone}/dns-records/{recordId}` (full replace) | 200 |
| Delete by id | `DELETE /zones/{zone}/dns-records/{recordId}` | 204 |

**List parameters.**
- `type` and `name` filters are ANDed.
- Pages are 1-based: `pageSize` 1–100 (default 25); follow `links[rel=next]`.

**Replace.** The replace-by-id endpoint was added 2026-08-17
(https://developer.godaddy.com/docs/api-users/changelog/domains-replace-dns-record).
Fields left out of the body reset to their defaults.

**DNSRecord fields.**
- `name`: relative to the zone, `@` for the apex, 1–255 characters.
- `type`: one of A, AAAA, CAA, CNAME, MX, NS, SOA, SRV, TXT. NS and SOA are
  read-only.
- `data`: 1–512 characters.
- `ttl`: **600–86400**.
- `recordId`: read-only.
- Optional: `priority`, `service`, `protocol`, `port`, `weight`, `flag`, `tag`.

**Behaviour.**
- Changes are applied synchronously.
- A CNAME at the apex is rejected with **422**
  (https://developer.godaddy.com/llms.mdx/api-users/troubleshoot/dns).
- Writing NS or SOA records gives **409** `dns_record_not_mutable`.

## Errors and rate limits

**Error body.** `{ code, message?, fields?: [{ path, code, message }] }`. A 429
uses `ErrorLimit`, which adds `retryAfterSec` and mirrors it in the
`Retry-After` header. Source: https://developer.godaddy.com/docs/api-users/errors.

**Status codes.**

| Status | Meaning |
| --- | --- |
| 400 | Malformed request; includes a TTL below 600 |
| 401 | Credential missing, expired or revoked |
| 403 | Missing scope **or** account not eligible. The docs say to check `code` but don't list the values (**UNVERIFIED**). The classic eligibility body is `{"code":"ACCESS_DENIED","message":"Authenticated user is not allowed access"}`. |
| 404 | Unknown zone or record |
| 409 | Record can't be changed |
| 422 | Business rule violated, e.g. CNAME at the apex |
| 429 | Rate limited |

**Rate limits.**
- Limits apply per credential across all endpoints. Every response carries
  `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset`.
- Documented value: **600 requests per ~23-minute window**; it "may change".
  The getstarted page says 60/min.
- Source: https://developer.godaddy.com/docs/api-users/rate-limits.

**Idempotency.** The v3 launch notes say mutating requests need an
`Idempotency-Key` header (16–64 characters, UUID recommended). The DNS
operations in the spec don't list it (**UNVERIFIED** whether DNS enforces it).

**Pricing.** Nothing indicates a per-call charge for DNS operations.

## Account eligibility

**2024 rule** (quoted by lego, https://go-acme.github.io/lego/dns/godaddy/):
- The DNS and management APIs need 10+ domains or a Discount Domain Club
  Premier plan.
- Calls that fail the rule get 403 `ACCESS_DENIED`.

**2026-04 relaxation** (support quote,
https://community.letsencrypt.org/t/godaddy-api-access-policy-update/246372):
- The DNS and management APIs need any one of:
  - 1+ domain at GoDaddy;
  - Discount Domain Club Pro;
  - $20+/month of eligible purchases.
- The Availability API still needs 50+ domains.
- The current portal wording matches: "Account holds at least one domain, OR
  is on a plan that grants management access"
  (https://developer.godaddy.com/llms.mdx/api-users/auth).
- The rule rests on a forum quote of support; it is **UNVERIFIED** that it is
  live for every account.

**OTE test environment.** Support said in both 2024 and 2026 that OTE
(`api.ote-godaddy.com`) is unaffected by the eligibility rules. Whether PATs
work against OTE is **UNVERIFIED**.

**Workarounds** used by other tools' users:
- ask GoDaddy API support to allow-list the account;
- meet the threshold;
- move the zone's nameservers to another DNS provider.

## Reference behaviour from other tools (v1)

- **lego:** GET, then PUT the full list for a name and type, because a v1 PUT
  replaces every value. It deletes only when no values remain, and floors the
  TTL at 600.
- **external-dns:** writes the apex as `@`, floors the TTL at 600, groups
  records by name and type, and sleeps on 429 using `Retry-After`.
- Neither supports v3 yet.
