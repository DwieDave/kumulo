# Plan: `dns-godaddy` — GoDaddy DNS via cluster config

Status: IMPLEMENTED on branch `feat/godaddy-dns`. Findings and sources: `research.md`.

## Scope

Add `dns.module: godaddy` for all three distros. The new package is
`@kumulo/dns-godaddy`, at `packages/godaddy/dns`. It is DNS only: GoDaddy has
no compute, storage or CDN that kumulo could use.

```yaml
dns:
  module: godaddy
  zone: example.com
  ttl: 600          # GoDaddy's minimum; lower values are rejected at config time
  records:
    - { name: api, target: api_server }
    - { name: "@", target: ingress }
```

Credentials come from `GODADDY_API_TOKEN`, a Personal Access Token with the
`domains.dns:update` scope.

Out of scope:
- the v1 API and `sso-key` keys (D1);
- nameserver changes;
- zone creation (the domain must already be in the GoDaddy account);
- MX, SRV and CAA records (kumulo never writes them).

## Decisions

- **D1 — Target the v3 API with PATs only.**
  - `sso-key` is deprecated for Domains through 2026 and doesn't work with v3.
  - v3 also has the right record model: individual records with ids. With v1
    we'd have to rewrite every value at a name to change one.
  - Supporting both doubles the client and test surface for an auth scheme on
    its way out.
- **D2 — One self-contained package**, `packages/godaddy/dns`
  (`@kumulo/dns-godaddy`).
  - Copy the `packages/hetzner/dns` template: hand-written client, transport
    and provider, depending only on `@kumulo/core`.
  - A `packages/godaddy/client` package isn't needed, because nothing else
    would share it. If GoDaddy ever gains a second module, split it out then,
    the way bunny's was.
  - The client is hand-written because only four operations are used. The v3
    spec is vendored only to test against (T2.5).
- **D3 — Keep the TXT ownership contract** (`kumulo.cluster=<tag>`) unchanged,
  so the shared DNS contract suite runs unmodified.
- **D4 — Converge record by record, like dns-bunny.**
  - kumulo keeps one value per (name, kind). For each name, `ensureRecords`:
    - creates a missing record;
    - replaces it by id when its `data` or `ttl` differs;
    - deletes surplus same-kind duplicates it owns;
    - on a kind change (CNAME ⇄ A), deletes the old record *before* creating
      the new one, because a CNAME can't coexist with other types.
  - It only ever writes or deletes A, AAAA, CNAME and its own ownership TXT. It
    never touches NS, SOA, MX, CAA, SRV or foreign TXT records such as SPF.
  - The apex: GoDaddy uses `@`; kumulo config names it `@`. Normalize `""`,
    `@` and the zone name to `@`.
- **D5 — Read the zone in as few calls as possible.** The rate limit is tight
  (~600 requests per 23 minutes per token).
  - Each reconcile lists the zone once: `pageSize=100`, following
    `links[rel=next]`. It then works from that snapshot instead of listing per
    name.
  - Writes run one at a time.
  - On 429 the transport waits for `Retry-After` or `retryAfterSec` before
    retrying, up to a cap. It does not throttle ahead of time from
    `RateLimit-Remaining`; one snapshot plus serial writes keeps a cluster
    apply far below the documented window.
- **D6 — Retries and idempotency.**
  - Every POST, PUT and DELETE carries an `Idempotency-Key` (a UUID). It is
    generated **once per logical write** and reused on every retry, so a
    retried create can't double-write if GoDaddy honours the key.
  - 429 is retried for every method.
  - 5xx is retried only for GET, PUT-by-id and DELETE, which are safe to repeat
    by design. A POST that hits 5xx is not retried. Instead the next reconcile
    lists the zone again and converges, so a lost create can't duplicate a
    record.
- **D7 — Error mapping** (`src/provider/errors.ts`, modelled on dns-ovh's):

  | Response | Maps to | Notes |
  | --- | --- | --- |
  | 401 | `AuthenticationFailed` | hint: token missing, expired or revoked |
  | 403 | `AuthenticationFailed` | carries GoDaddy's `code` and message, plus a hint covering both causes (D9) |
  | 404 | `ResourceNotFound` | "zone not in this GoDaddy account" |
  | 409 | `ResourceConflict` | |
  | 422 | `ProviderApiError` | carries the code |
  | 429 | `RateLimited` | carries `retryAfter` |
  | other | `ProviderApiError` | |
  | undecodable body | `ResponseDecodeError` | |
  | no response | `HttpTransportError` | |

  The 403 hint names both causes: the scope is missing, or the account isn't
  eligible for the DNS API (needs at least one domain or a qualifying plan).
- **D8 — Config rules**, all in core with hand-written mirrors in
  `scripts/generate-schema.ts`:
  - `dns.module: godaddy` requires `dns.ttl` ≥ 600.
  - An apex record whose target resolves to a CNAME is rejected with
    `dns.module: godaddy`, because GoDaddy rejects apex CNAMEs with 422. The
    apex CDN target is already restricted to bunny DNS.
  - Messages name the rule, e.g. "GoDaddy requires ttl ≥ 600".
- **D9 — Preflight before creating infrastructure.**
  - The problem: DNS converges late in apply, after the cluster exists. An
    ineligible account or missing scope would only surface after paying for
    infra.
  - The fix: add a `dnsPreflight(config)` step to the CLI apply flow, run
    after `requireCredentials` and before the plan is applied. For godaddy it:
    - lists one page of the zone (`pageSize=1`), proving the token, scope,
      eligibility and zone in one call;
    - for creates, can't check the write scope (`domains.dns:update`) with a
      read, so the plan output notes that it is assumed;
    - fails with the D7 errors and their hints.
  - Other DNS modules return `Effect.void` for now.
- **D10 — Credentials and environment.**
  - `GODADDY_API_TOKEN` is read with `requiredRedactedEnv`; it also works from
    `--secrets-file`.
  - An optional `GODADDY_API_BASE_URL` overrides the base, e.g.
    `https://api.ote-godaddy.com/v3/domains` for testing. Whether PATs work on
    OTE is unverified, so the README says so.
  - The token is `Redacted` and is never logged.

## Milestones

### Milestone 1 — Workspace registration

- T1.1 Scaffold `packages/godaddy/dns` from `packages/hetzner/dns`:
  package.json (`@kumulo/dns-godaddy`, same lockstep version), tsconfig.json,
  tsconfig.build.json, LICENSE, README, `src/index.ts` and a smoke test.
- T1.2 Register the folder:
  - add `packages/godaddy/*` to the root `workspaces.packages`;
  - add `@kumulo/dns-godaddy` mappings to `tsconfig.base.json` (src) and
    `tsconfig.build.base.json` (dist);
  - check that the provider-segment rules in `.dependency-cruiser.cjs` cover
    the new folder;
  - check that `scripts/workspace-packages.mjs` finds it for build, typecheck
    and release;
  - run `bun install`.
- T1.3 Add `@kumulo/dns-godaddy` to `packages/cli/package.json`.

### Milestone 2 — Client, transport, fake

- T2.1 Transport, `src/transport/http-client.ts`:
  - Bearer PAT auth and the base URL (default
    `https://api.godaddy.com/v3/domains`), prefixed only onto relative URLs,
    as in `@kumulo/bunny`.
  - Retries per D6, rate-limit handling per D5, and the per-write
    `Idempotency-Key`.
  - Tests: 429 with `Retry-After` and with `retryAfterSec`; no 5xx retry on
    POST; the idempotency key is reused across retries; the retry cap.
- T2.2 Client, `src/client/godaddy-dns.ts`: Schema-decoded `DnsRecord`
  (`recordId`, `name`, `type`, `data`, `ttl`) and the list envelope.
  Operations:
  - `listRecords({ zone })`, paging through `links[rel=next]`;
  - `createRecord`, which reads the id from the response body, falling back to
    the `Location` header;
  - `replaceRecord({ zone, recordId, record })`;
  - `deleteRecord`, which treats 404 as already gone.
- T2.3 Errors per D7, `src/provider/errors.ts`: decode the error and
  `ErrorLimit` bodies, with a test for each status and the 403 hint text.
- T2.4 Fake v3 server, `test/provider/fake-zone.ts`. It is an in-memory zone
  with opaque string ids, and it behaves like the spec:
  - pagination with `links`;
  - 400 for a TTL below 600;
  - 409 when NS or SOA records are written;
  - 422 for an apex CNAME;
  - 403 with a configurable code;
  - 429 with `Retry-After` after N requests, to exercise D5 and D6;
  - seeded NS, SOA, MX and SPF records, to prove they are never touched.
- T2.5 Spec conformance test. Vendor `domains-v3.json` into
  `packages/godaddy/dns/specs/` with a sha256 sidecar, and add a root
  `specs:update:godaddy` script modelled on hetzner's `update-specs.sh`. The
  test asserts that:
  - every method and path the client calls exists in the spec;
  - the client's record Schema accepts the spec's `DNSRecord` examples.
  This catches API drift without a live account.

### Milestone 3 — Provider

- T3.1 `src/provider/dns-provider.ts`: `ensureRecords` and
  `removeClusterRecords` per D3–D5, exported as `makeGodaddyDnsProvider` and
  `godaddyDnsProviderLive({ dns, ttl })`.
- T3.2 Copy `test/provider/contract.ts` from `packages/hetzner/dns` and run it
  unmodified against the fake. Add tests for:
  - no writes on a second apply;
  - an update on TTL drift;
  - a kind change deletes before it creates;
  - `""`, `@` and the zone name all mean the apex;
  - duplicates collapse to one record;
  - NS, SOA, MX and SPF are never touched;
  - a foreign record, or another cluster's TXT, gives `ResourceConflict`;
  - the request count for a 10-record cluster stays within budget, to guard
    D5.

### Milestone 4 — Config and CLI

- T4.1 Config:
  - add `"godaddy"` to the `Dns` literals in
    `packages/core/src/config/schema.ts`;
  - add the D8 checks with hand-written mirrors in `scripts/generate-schema.ts`;
  - run `bun run schema:generate`;
  - tests in `packages/cli/test/config/dns-distro.test.ts`, plus a new
    `godaddy` case file.
- T4.2 CLI wiring:
  - `k3sGodaddyDnsProviderLayer({ ttl })` in `packages/cli/src/k3s/env.ts`;
  - a `godaddy` branch in `dnsProviderLayerWith` in `packages/cli/src/dns.ts`;
  - the `DnsPlanInput` literal in `src/dns-plan.ts`;
  - `_dnsVars.godaddy = ["GODADDY_API_TOKEN"]` in `src/env-summary.ts`;
  - `GODADDY_API_TOKEN` in `test/commands/fake-credentials.ts`.
- T4.3 Preflight per D9:
  - `dnsPreflight(config)` in `src/dns.ts`, called from the apply flow in
    `src/commands.ts`, after `requireCredentials` and before
    `decidePlanAction`;
  - tests: 403 aborts apply before any infra call; `--dry-run` still shows the
    plan and reports the preflight failure; the other modules are unaffected.
- T4.4 CLI tests using the fake: an end-to-end DNS apply and delete through
  `dnsProviderLayerFor` for each distro; the TTL reaches the provider; and the
  env summary.

### Milestone 5 — Docs and gate

- T5.1 Docs and examples:
  - Root `README.md`, with a GoDaddy DNS section covering:
    - creating a PAT, its scope and its expiry;
    - the TTL ≥ 600 rule;
    - account eligibility and what a 403 means;
    - the OTE caveat;
    - moving the zone's nameservers elsewhere as a fallback.
  - `packages/cli/README.md` and the package README.
  - `CHANGELOG.md` [Unreleased].
  - `.docs/design/kumulo-design.md` §3.5 implementers table and Appendix A.
  - An example config, `examples/k3s-godaddy.yaml`, covered by
    `examples/cli-smoke.test.ts`.
- T5.2 Gate: `bun run ci` is green, with oxlint and dependency-cruiser clean.
- T5.3 Release: configure npm Trusted Publisher for `@kumulo/dns-godaddy` by
  hand.

Dependencies: M1 → M2 → M3 → M4 → M5. Within M2, T2.1–T2.3 and T2.4–T2.5 can
run in parallel. In M4, T4.1 must land before T4.2–T4.4.

## Risks

- **Account eligibility.** The 2026 relaxation (1+ domain) rests on a support
  quote. Older accounts may still hit 403 `ACCESS_DENIED`. Mitigated by the
  D9 preflight, the precise 403 hint, and README guidance.
- **Tight rate limit.** The documented limit is 600 per ~23 minutes, shared
  across everything that uses the same token. Mitigated by one zone snapshot
  per reconcile, serial writes, and honouring `Retry-After`.
- **Unverified API details:**
  - whether `Idempotency-Key` is enforced on DNS;
  - TXT quoting;
  - the exact 403 codes;
  - whether PATs work on OTE.
  Mitigated by defensive handling and by testing both forms in the fake (TXT
  sent unquoted, compared with quotes stripped). The README lists them as
  known assumptions.
- **PAT expiry.** Tokens last at most a year, so an expired token fails as 401
  with a hint to create a new one.
