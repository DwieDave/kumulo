# Plan: bunny.net provider — DNS, object storage, CDN + Shield

Status: DRAFT — awaiting human approval. Findings and sources: `research.md`.

## Scope

Cover everything bunny.net can provide to kumulo. bunny has no compute,
managed Kubernetes or block storage, so it fills three slots:

| Slot | Config | Package |
| --- | --- | --- |
| DNS | `dns.module: bunny` | `@kumulo/dns-bunny` |
| Object storage | `object_storage.module: bunny` | `@kumulo/storage-bunny` |
| CDN/TLS/WAF front for the cluster ingress (new kind) | `cdn.module: bunny` (+ `cdn.shield`) | `@kumulo/cdn-bunny` |

All three share one hand-written API client package, `@kumulo/bunny`.
No new `Provider` literal is needed. Every distro can use DNS and storage.
The CDN works on every distro, with these origins:

| Distro | Origin |
| --- | --- |
| ovh-mks | `origin: ingress` is automatic (Octavia floating IP) |
| k3s | explicit `origin.url` |
| upcloud-uks | explicit `origin.url` |

Out of scope:
- Magic Containers.
- DNS zone creation and registrar delegation.
- Custom (uploaded) TLS certificates.
- Shield custom WAF rules beyond rate limits. The model is extensible later.

## Decisions

### Shared

- **D1 — One hand-written leaf client package, `@kumulo/bunny`.**
  - We need about 35 operations across the Core API (DNS, storage zones, pull
    zones) and the Shield API.
  - The specs are huge, encode enums as integers (`x-enumNames`), and use
    all-nullable request models, so codegen would produce mostly unused code.
  - Integer enums become `Schema.Literals` with one bidirectional codec per
    enum, kept in one module.
  - This follows the `@kumulo/upcloud` → `storage-upcloud` precedent: add
    `bunny` to the root build `leaf` list and to the `.dependency-cruiser.cjs`
    allowed `to` paths.
- **D2 — One credential, `BUNNYNET_API_KEY`.** It is an account key, the same
  variable the official Terraform provider reads, and is read with
  `requiredRedactedEnv`. It is listed in `env-summary.ts` for each bunny module
  that is enabled.
- **D3 — Ownership.** bunny resources have no tags or labels.
  - DNS uses the existing TXT ownership record (see D4).
  - Storage zones and pull zones are tracked through outputs files that hold
    their numeric ids:
    - `<cluster>.buckets.yaml` for storage zones;
    - a new `<cluster>.cdn.yaml` for the pull zone, shield zone and rule ids.
  - A name collision with something not in the outputs file is a
    `ResourceConflict`, never adopted.
  - The CDN gets its own outputs file because the shared `outputs.yaml`
    mutators rebuild the object field by field and would silently drop a new
    `cdn` key.

### DNS

- **D4 — Keep the TXT ownership contract** (`kumulo.cluster=<tag>`), so the
  shared DNS contract suite runs unmodified. Records we create also get
  `Comment: "managed by kumulo (<tag>)"` for humans; it is never read for
  decisions.
- **D5 — bunny stores individual records, not record sets.** kumulo keeps one
  value per (name, kind). `ensureRecords` lists the records at a name, then:
  - adds a missing record;
  - updates a record by id when its value or TTL differs;
  - deletes surplus same-kind duplicates it owns;
  - deletes the old kind when the kind changes.
  The apex may come back as `""` or `"@"`; normalize both.
- **D6 — The zone must already exist.** Look it up with `GET /dnszone?search=`
  plus an exact `Domain` match. A missing zone gives `ResourceNotFound`.
  `NameserversDetected: false` is a plan warning, not an error.

### Object storage

- **D7 — One bucket is one S3-type storage zone.** The bucket schema is
  `{ name, region, tier?, retain }`.
  - `region` must be one of the eight S3 regions.
  - `tier` is `standard` (HDD) or `edge` (SSD).
  - `versioning` and `encryption` are not accepted, because bunny can't honour
    them.
  - Plan runs `checkavailability` because zone names are globally unique.
  - The README states that the S3 API is a public preview, capped at
    500 req/s, with no lifecycle rules.
- **D8 — Credentials are per bucket.** bunny's S3 credentials are the zone
  name plus the zone password, so there is one pair per zone.
  - `S3Credentials` in core gains an optional per-bucket credential list.
  - The sops entries become
    `s3.buckets.N.{name,region,endpoint,accessKey,secretKey}`.
  - Existing providers are unchanged.
- **D9 — Deletion safety.**
  - Always pass `deleteLinkedPullZones=false`.
  - `FilesStored > 0` gives `BucketNotEmpty` before any delete call.
  - A zone with `retain: true` is never deleted.

### CDN and Shield

- **D10 — A new core port, `CdnProvider`**, mirroring the other ports: a
  `Context.Service` with a `CdnError` union built from the standard tagged
  errors plus `CapabilityMissing`.
  - Operations:
    - `ensureEdge(spec): EdgeInfo` — pull zone, origin settings, cache mode
      and hostnames.
    - `ensureCertificates(ref, hostnames)` — polls until issued or a timeout.
    - `ensureSecurity(ref, policy)` — Shield.
    - `describeEdge(ref)` — for plan drift and status.
    - `deleteEdge(ref)`.
  - A `cdnNoopLive` covers `cdn.module: none`.
  - The port's spec types are provider-neutral: origin, hostnames, cache mode
    (`smart | origin`), WAF mode, DDoS level, rate limits, access lists and bot
    detection. They are shaped so another CDN could implement them later.
- **D11 — Config: a new optional `cdn` block** on all three distros, with
  `module: none` as the default:

  ```yaml
  cdn:
    module: bunny
    name: stagingeu              # letters+digits, globally unique
    tier: standard               # standard | volume
    origin: ingress              # or { url: https://203.0.113.10 }
    verify_origin_tls: false
    websockets: true
    cache: smart                 # smart (static only) | origin (Cache-Control)
    hostnames:                   # ≤ 10
      - app.example.com
      - api.example.com
    force_ssl: true
    shield:                      # optional; absent = Shield untouched/reset
      plan: basic                # basic | advanced | business | enterprise
      waf: { enabled: true, mode: log }          # log | block
      ddos: { sensitivity: medium }              # off | low | medium | high | challenge
      bot_detection: { mode: log, sensitivity: low }
      rate_limits:
        - { name: login, path_prefix: /login, requests: 20, window: 60, block_for: 300, key: ip }
      access_lists:
        - { name: office, type: cidr, action: allow, entries: [198.51.100.0/24] }
  ```

  Cross-field checks live in each distro's config, with a hand-written mirror
  in `scripts/generate-schema.ts`:
  - `origin: ingress` is valid only for ovh-mks with an `ingress` block. Other
    distros require `origin.url`.
  - Shield rate limits must fit the plan. Basic allows two; the provider
    re-checks against the limits the API returns and fails with
    `CapabilityMissing`.
- **D12 — Pull zone settings.**
  - Owned fields:
    - origin: `OriginType=0`, `OriginUrl`, `AddHostHeader=true` (the ingress
      routes by Host), `VerifyOriginSSL`, `EnableWebSockets`;
    - cache: `EnableSmartCache`, `EnableHostnameVary=true`;
    - zone: `Type`;
    - always forced: `DisableCookies=false`.
  - Everything else is left at bunny's defaults.
  - Updates do GET, merge only the owned fields, then POST, because it is
    unverified whether bunny's update is partial.
- **D13 — DNS integration: a new `target: cdn`** resolves to
  `<name>.b-cdn.net` and becomes a CNAME. Apex hostnames are allowed only with
  `dns.module: bunny`; dns-bunny then writes record type 7 (PullZone) with the
  pull zone id. Any other DNS module with an apex CDN hostname fails config
  validation.
- **D14 — Apply ordering, per distro:**
  1. infra / cluster / ingress;
  2. **pull zone + hostnames** — the origin IP is known by now;
  3. **DNS** — needs the `cdn` target;
  4. **certificates**: `loadFreeCertificate` per hostname, retried with
     exponential backoff until DNS resolves (default timeout 10 min), then
     `setForceSSL`;
  5. **Shield**;
  6. storage and outputs.

  Delete ordering:
  1. remove DNS;
  2. reset Shield — bunny has no Shield delete, so reset to the basic plan
     with WAF off, as Terraform does;
  3. delete the pull zone (404 counts as gone);
  4. the cluster.

  A certificate failure leaves the edge working on HTTP and reports the
  failing hostnames. It does not roll back.
- **D15 — Shield converges by name.** Rule and access-list ids are integers
  assigned by the server, so rate-limit and access-list names must be unique
  within a cluster.
  - Access-list entries are compared after sorting and dedupe.
  - The list action is set through the separate `configurations` endpoint.
  - A 202 `invalid_plan_type.*` from bot detection becomes
    `CapabilityMissing`, which names the plan needed.
  - A plan change is shown as an `Update` row with a cost note, because it
    affects billing.

## Milestones

Once M1 lands, the three tracks below can run in parallel.

- **DNS:** M2 → M3.
- **Storage:** M4 → M5.
- **CDN:** M6 → M7 → M8 → M9. M9 also needs M2, because of the apex record in
  D13.

M10 closes everything out.

### Milestone 0 — dropped

No trial run against a live account. Fakes are built from the vendored OpenAPI
specs (`.references/bunny/core.json`, `.references/bunny/shield.json`) and the
official Terraform provider's behaviour (`.references/bunny/terraform-provider`).
Every UNVERIFIED item in `research.md` is handled defensively in code (normalize
apex `""`/`"@"`, GET-merge-POST pull zone updates, retry on 429/5xx, treat 404 on
delete as gone) and listed in the README as a known assumption.

### Milestone 1 — `@kumulo/bunny` client package

- T1.1 Create the package scaffold, using `packages/dns-hetzner` as the
  template:
  - add `bunny` to the root build `leaf` list;
  - add `bunny/` to the allowed `to` paths in `.dependency-cruiser.cjs`.
- T1.2 Transport: a Core API client and a Shield API client. Both use the
  `AccessKey` header from a `Redacted` key and retry on 429 and 5xx with
  jittered exponential backoff. Test the retry behaviour.
- T1.3 Enum codecs, `src/enums.ts`: DNS record type, storage zone tier and
  type, pull zone type and origin type, and the Shield enums (plan, WAF mode,
  DDoS sensitivity, rate-limit timeframe, block time and counter key,
  access-list type and action, bot detection). Round-trip property tests.
- T1.4 Clients, one Schema-decoded module each:
  - `client/dns.ts`;
  - `client/storage.ts`;
  - `client/pullzone.ts`, which handles hostnames, `loadFreeCertificate`,
    `setForceSSL` and `checkavailability`;
  - `client/shield.ts`, which handles zones, rate limits, access lists and
    their configurations, and bot detection.
- T1.5 Error mapping, `src/errors.ts`:
  - Decode both error shapes: Core `ApiErrorData` and Shield
    `GenericRequestResponse`.
  - Map statuses:
    - 401/403 → `AuthenticationFailed`;
    - 404 → `ResourceNotFound`;
    - 409, or a duplicate `ErrorKey` → `ResourceConflict`;
    - 429 → `RateLimited`;
    - 202 `invalid_plan_type.*` → `CapabilityMissing`;
    - other statuses → `ProviderApiError`;
    - decode failures → `ResponseDecodeError`.
- T1.6 Fake bunny server, `test/fake-bunny.ts`: an in-memory implementation of
  every endpoint above, shaped from the OpenAPI response schemas.

### Milestone 2 — `@kumulo/dns-bunny`

- T2.1 Package and provider: `ensureRecords` and `removeClusterRecords` per
  D4–D6, exported as `bunnyDnsProviderLive`.
- T2.2 Copy the DNS contract suite from dns-hetzner and run it unmodified on
  the fake server. Add tests for:
  - no writes on a second apply;
  - `""` and `"@"` both meaning the apex;
  - duplicates collapsing to one record;
  - foreign or other-cluster TXT records giving `ResourceConflict`;
  - the PullZone record for an apex `cdn` target (D13).

### Milestone 3 — DNS wiring

- T3.1 Add `"bunny"` to the `Dns` literals in
  `packages/core/src/config/schema.ts`, then run `bun run schema:generate`.
- T3.2 CLI wiring:
  - add `k3sBunnyDnsProviderLayer()` in `cli/src/k3s/env.ts`;
  - add a `bunny` branch to `dnsProviderLayerFor` in `cli/src/dns.ts`;
  - add the literal to `DnsPlanInput` in `cli/src/dns-plan.ts`;
  - add the key to `_dnsVars` in `cli/src/env-summary.ts`;
  - add the dependency to `cli/package.json`.
- T3.3 Tests:
  - `test/config/dns-distro.test.ts`;
  - `test/env-summary.test.ts`;
  - `test/commands/fake-credentials.ts`;
  - a k3s DNS plan test with bunny.

### Milestone 4 — `@kumulo/storage-bunny`

- T4.1 Core: add the optional per-bucket credentials to `S3Credentials`
  (D8), with a test that OVH and UpCloud output is unchanged.
- T4.2 Provider: an `ObjectStorageProvider` per D7–D9. It covers the diff, the
  outputs file, the ensure, delete and credentials operations, and the
  availability check.
- T4.3 Tests on the fake server:
  - create;
  - no changes on a second apply;
  - name collision gives `ResourceConflict`;
  - deleting a non-empty zone gives `BucketNotEmpty`;
  - `retain`;
  - a property test that the diff is idempotent.

### Milestone 5 — Storage wiring

- T5.1 Refactor first, as its own commit with OVH behaviour unchanged:
  - generalise `cli/src/storage/{env,reconcile}.ts` away from the hard-coded
    `module === "ovh"`;
  - extract `_credentialEntries`;
  - widen `wantsObjectStorage` in `distro/registry.ts`;
  - the delete path in `commands.ts` (about line 325) currently hard-codes
    `ovhObjectStorageProviderLive`; make it follow the configured module.
- T5.2 Schema:
  - add a `BunnyObjectStorage` member to `ObjectStorage` in core;
  - add the cross-field mirror in `scripts/generate-schema.ts`;
  - regenerate the schema.
- T5.3 CLI: dispatch to bunny, write the sops entries per D8, update
  `_objectStorageVars`, and add plan, apply, delete and status tests.

### Milestone 6 — CDN core and config

- T6.1 Port: `packages/core/src/ports/cdn-provider.ts`, the domain types in
  `domain/types.ts`, `cdnNoopLive`, and exports from the core index (D10).
- T6.2 Config:
  - add the `Cdn` union in `core/src/config/schema.ts`;
  - add `cdn` to each distro config (`distro-k3s`, `distro-ovh-mks`,
    `distro-upcloud-uks`) with the D11 cross-field checks;
  - add the mirrors in `scripts/generate-schema.ts`;
  - regenerate the schema.
- T6.3 Outputs: add `<cluster>.cdn.yaml` (pull zone id, system hostname,
  shield zone id, rule and list ids by name) with read/write helpers in
  `cdn-bunny`.
- T6.4 The `cdn` DNS target (D13). Add it to:
  - `DnsTargets` and `_resolveTarget` in `cli/src/dns.ts`;
  - `DnsPlanTargets` and `_kindOf`;
  - each distro's `_dnsTargets`;
  - `DesiredRecord` docs.
  Add tests for each distro.

### Milestone 7 — `@kumulo/cdn-bunny`: pull zone, hostnames, TLS

- T7.1 `ensureEdge`:
  - find the zone by the id in the outputs file, otherwise create it;
  - run the availability check first;
  - GET, merge and POST the owned settings (D12);
  - add and remove custom hostnames, never touching system ones.
- T7.2 `ensureCertificates` (D14): call `loadFreeCertificate` per hostname
  with no certificate, retrying with `Schedule` backoff and a configurable
  timeout, then `setForceSSL`. Return the per-hostname status.
- T7.3 `describeEdge` and `deleteEdge`. Also map plan drift: a changed origin,
  hostname set or settings gives `Update`; a changed `name` or `tier` gives
  `ReplaceNeedsConfirm`.
- T7.4 Tests on the fake server:
  - create;
  - no changes on a second apply;
  - adding and removing hostnames;
  - a certificate retried until DNS is ready, and a certificate timeout;
  - the 10-hostname limit;
  - a name collision.

### Milestone 8 — Shield

- T8.1 `ensureSecurity` (D15):
  - find or create the Shield zone for the pull zone;
  - patch the plan, WAF and DDoS settings with learning mode off;
  - patch bot detection;
  - converge rate limits and access lists by name, including list actions
    through `configurations`;
  - delete owned rules that are no longer configured.
- T8.2 Plan gating: check the configured rule counts against the limits
  returned in `ShieldZoneResponse` and the access-list limits. Map the 202
  plan errors to `CapabilityMissing`.
- T8.3 Reset on delete, or when `shield` is removed from the config: set the
  basic plan, WAF and DDoS off, and delete owned rules and lists.
- T8.4 Tests on the fake server: each feature, no changes on a second apply,
  rename (delete then create), plan gating, and reset.

### Milestone 9 — CDN CLI wiring

- T9.1 Layers:
  - `cdnProviderLayerFor(config)`, modelled on `dnsProviderLayerFor`;
  - add the key to the env-summary `_cdnVars`;
  - add it to `_requiredVars`.
- T9.2 Apply and delete steps in all three distro reconcilers, in the D14
  order:
  - `mks/reconcile.ts` uses the ingress floating IP;
  - `k3s/reconcile.ts` and `upcloud/reconcile.ts` use `origin.url`.
  Add `cdn/` to `appliedPrefixes` and wrap the step in `withRowProgress`.
- T9.3 Plan rows:
  - `cdn/<name>` for the zone;
  - `cdn/<name>/hostname/<h>`;
  - `cdn/<name>/shield` and `cdn/<name>/shield/{rate-limit,access-list}/<n>`.
  Rows come from the outputs file plus a live `describeEdge`, and are added
  next to the bucket rows in `commands.ts`. Add delete rows, and a CDN line
  in `status`.
- T9.4 Tests:
  - plan, apply and delete for each distro on the fakes;
  - an extension of the e2e `mks-lifecycle.test.ts`;
  - the config property tests in `test/config/`.

### Milestone 10 — Docs, examples, release

- T10.1 Docs:
  - root `README.md`: sections for the three modules, `BUNNYNET_API_KEY`,
    the S3 preview caveats, and the CDN certificate flow;
  - `packages/cli/README.md`;
  - `CHANGELOG.md`;
  - `.docs/design/kumulo-design.md`: add §3.5 DNS implementers (bunny and
    the missing hetzner), a new §3.x CDN port, and Appendix A.
- T10.2 Examples: add `examples/` configs for k3s + bunny DNS + CDN, and for
  ovh-mks with ingress + bunny CDN + Shield. They are covered by
  `examples/cli-smoke.test.ts`.
- T10.3 Gate: `bun run ci` is green.
- T10.4 Release: configure npm Trusted Publisher by hand for `@kumulo/bunny`,
  `@kumulo/dns-bunny`, `@kumulo/storage-bunny` and `@kumulo/cdn-bunny` before
  the next tag.

## Risks

- **bunny's S3 API is a public preview.** No versioning, SSE or lifecycle,
  and 500 req/s per zone. Documented and stated in the plan output.
- **Undocumented Core API rate limits.** Mitigated by the retry transport and
  by limiting concurrency to 4, as dns-ovh does.
- **Certificate issuance depends on DNS propagation**, which can be slow with
  a non-bunny DNS module. Mitigated by the retry with timeout, and by not
  rolling back on failure.
- **No Shield delete, and a plan change affects billing.** Mitigated by reset
  on delete and an explicit `plan` field.
- **Pull zone update semantics are unverified.** Mitigated by GET, merge,
  POST; covered by fake-server tests for both semantics.
