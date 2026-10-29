# Research: bunny.net as a kumulo provider

Researched 2026-10-29 from bunny.net primary sources. Items marked
**UNVERIFIED** need a live API key to confirm (see plan T0.1).

## What bunny.net can and cannot provide

| kumulo provider kind | bunny.net | Notes |
| --- | --- | --- |
| DNS (`dns.module`) | **Yes** | Bunny DNS, full Core API coverage. |
| Object storage (`object_storage.module`) | **Partly** | Storage zones with S3 API in *public preview*; no versioning/SSE. |
| Cloud compute (servers, networks, LB, floating IPs, firewalls) | No | No VMs, private networks or L4 load balancers. |
| Managed Kubernetes distro | No | None offered. |
| Block volumes / CSI | No | Only Magic Containers app volumes (10 MB/s, no CSI). |
| Secrets | No | Edge Scripting secrets are script-scoped. |
| CDN + WAF in front of ingress | **Yes**, new kind | Pull zone (origin = ingress IP, custom hostnames, free TLS) + Shield. |

Magic Containers is a gVisor-sandboxed container PaaS (20 apps/account,
8 CPU/32 GiB per pod); it cannot host a k3s node.
Sources: https://bunny.net/docs/llms.txt, https://bunny.net/docs/magic-containers/limits.md

## API platform

- Core API: `https://api.bunny.net`, header `AccessKey: <account key>`.
  Account keys have full account access; no scoped keys documented. Terraform
  uses `BUNNYNET_API_KEY` and rejects team-member keys.
  https://bunny.net/docs/account/api-keys.md,
  https://bunny.net/docs/integrations/terraform/authentication.md
- OpenAPI 3.0.0 spec covering DNS and storage-zone management (~500 KB):
  https://core-api-public-docs.b-cdn.net/docs/v3/public.json.
  Integer enums with `x-enumNames`; request models are all-nullable with
  `additionalProperties: false`; 401/404/500 responses have no body schema.
- No official TypeScript management SDK ("We currently do not maintain an
  official API library").
- Errors on 400: `ApiErrorData { ErrorKey, Field, Message }`.
- Rate limits for the Core API: **UNVERIFIED** (not documented; treat 429
  defensively).
- Terraform provider (reference implementation):
  https://github.com/BunnyWay/terraform-provider-bunnynet

## DNS

Endpoints (Core API):

| Op | Method/path | Notes |
| --- | --- | --- |
| List zones | `GET /dnszone?search=&page=&perPage=` | perPage ≤ 1000 |
| Get zone | `GET /dnszone/{id}` | includes `Records`, `NameserversDetected` |
| List records | `GET /dnszone/{zoneId}/records?type=&search=` | `{Items, CurrentPage, TotalItems, HasMoreItems}` |
| Add record | `PUT /dnszone/{zoneId}/records` | 201, returns record incl. `Id` |
| Update record | `POST /dnszone/{zoneId}/records/{id}` | 204, no body |
| Delete record | `DELETE /dnszone/{zoneId}/records/{id}` | |

- Record types are integers: 0 A, 1 AAAA, 2 CNAME, 3 TXT (plus MX 4,
  Redirect 5, Flatten 6, PullZone 7, SRV 8, CAA 9, PTR 10, Script 11, NS 12,
  SVCB 13, HTTPS 14, TLSA 15).
- **Individual records, not rrsets**: each value has its own `Id`; there is no
  upsert. Adapters must list → match on (name, type) → add/update/delete by id.
- Apex name: Terraform uses `""`; a scan schema uses `"@"`. Which one the
  record API returns is **UNVERIFIED** — normalize both.
- Records carry a free-text `Comment` field (API/dashboard only).
- TTL unit/minimum **UNVERIFIED**.
- Default nameservers `kiki.bunny.net` / `coco.bunny.net`; the zone exposes
  `NameserversDetected` for a delegation check.
- Limits: 5,000 records per zone, 500 zones per account
  (https://bunny.net/docs/dns/limits.md).
- Pricing: first 20M standard queries free, then $0.10/M; $1/month account
  minimum.

## Storage

Management (Core API): `GET/POST /storagezone`, `GET/POST/DELETE /storagezone/{id}`,
`POST /storagezone/checkavailability`, `POST /storagezone/{id}/resetPassword`,
`GET /storagezone/regions`.

- Create body: `Name`, `Region`, `ReplicationRegions[]`, `ZoneTier`
  (Standard HDD / Edge SSD), `StorageZoneType` (S3 or not, **fixed at
  creation**). Name, region, tier and type cannot be updated.
- Zone names: ≥ 4 chars, letters/digits/dashes, **globally unique**.
- Response includes `Id` (int), `Password`, `ReadOnlyPassword`,
  `S3Hostname`, `StorageUsed`, `FilesStored` — the password is readable on
  every GET (not create-only).
- `DELETE` defaults `deleteLinkedPullZones=true` — always pass `false`.
  Whether deleting a non-empty zone is refused is **UNVERIFIED**.
- Zones have no labels/tags, so cluster ownership cannot be stored on them.

S3 compatibility (https://bunny.net/docs/storage/s3.md):

- Status: **public preview**. Only on zones created as S3 type.
- Endpoint `https://<region>-s3.storage.bunnycdn.com`; regions DE, NY, SG,
  UK, SE, LA, JH, SYD.
- Credentials: Access Key ID = zone name, Secret = zone password (read-only
  password also usable). **One credential pair per zone**, not per user.
- Supported: object CRUD, ranged GET, DeleteObjects, CopyObject (≤ 5 GB),
  ListObjects v1/v2, multipart, presigned URLs.
- Not supported: versioning, object lock, lifecycle, SSE/SSE-C, ACLs,
  tagging, CORS config.
- Limits: 500 req/s and 1 Gbps per zone.
- Pricing: Standard $0.01/GB (1 region), Edge $0.02/GB per region; no request
  or CDN-egress fees; $1/month minimum.

Fit for in-cluster workloads: basic Loki/Thanos/Velero writes work; anything
relying on lifecycle rules (e.g. Loki compactor retention via bucket
lifecycle) or versioning will not. Preview status is the main risk.

## CDN pull zones

Core API, `AccessKey` auth. Sources: core spec above, https://bunny.net/docs/cdn/*,
Terraform `internal/api/pullzone*.go`.

| Op | Call | Notes |
| --- | --- | --- |
| Create | `POST /pullzone` | only `Name` required; 201 with full zone |
| Get / list | `GET /pullzone/{id}`, `GET /pullzone?search=` | search is substring — match `Name` exactly |
| Update | `POST /pullzone/{id}` | full vs partial update **UNVERIFIED** — GET, merge owned fields, POST |
| Delete | `DELETE /pullzone/{id}` | 204; 404 = gone |
| Hostnames | `POST addHostname`, `DELETE removeHostname` | `{Hostname}` |
| Free TLS | `GET /pullzone/loadFreeCertificate?hostname=` | synchronous; 400 until the CNAME resolves to bunny → retry with backoff |
| Force SSL | `POST /pullzone/{id}/setForceSSL` | `{Hostname, ForceSSL}` |
| Name check | `POST /pullzone/checkavailability` | |

- Origin: `OriginType=0` (OriginUrl), `OriginUrl` may be a raw IP with an
  explicit scheme (`https://203.0.113.10`). `AddHostHeader=true` forwards the
  visitor's Host (and SNI) — required for a Host-routed ingress.
  `VerifyOriginSSL=false` for IP origins without a matching cert.
  `EnableWebSockets`, `OriginConnectTimeout`, `OriginResponseTimeout`.
- Caching for dynamic apps: `EnableSmartCache=true` caches only static
  extensions and never HTML/JSON/XML; otherwise bunny follows origin
  `Cache-Control`. Avoid `CacheControl*Override` and `DisableCookies`.
- Hostnames: system `<name>.b-cdn.net` (`IsSystemHostname`); ≤ 10 custom
  hostnames per zone; a hostname can belong to only one pull zone. DNS must be
  a CNAME to `<name>.b-cdn.net` — no A records. Apex needs Bunny DNS record
  type 7 (PullZone, `PullZoneId`).
- Names: letters and digits only, globally unique. No tag/label field.
- `Type`: 0 Premium/Standard (119 PoPs), 1 Volume (10 PoPs). Standard
  $0.01/GB EU/NA; Volume $0.005/GB.
- Limits: 500 pull zones per account.

## Shield (WAF / DDoS / rate limits / access lists / bot detection)

Base `https://api.bunny.net/shield`, `AccessKey` auth, spec
https://api.bunny.net/shield/docs/v1/swagger.json.

- Plans: Basic, Advanced, Business, Enterprise (`planType` 0–3). Basic:
  baseline WAF, DDoS, IP/ASN access lists, 2 rate-limit rules. Custom WAF rules
  and more rate-limit rules need Advanced+. Actual limits are returned at
  runtime (`rateLimitRulesLimit`, `customWafRulesLimit`, `customEntryLimit`).
- Shield zone: `POST /shield/shield-zone {pullZoneId, shieldZone}`; separate
  `shieldZoneId`; look up with `GET /shield/shield-zone/get-by-pullzone/{id}`;
  update with `PATCH /shield/shield-zone`. **No delete** — Terraform resets
  to defaults (basic, WAF off). New zones start in learning mode.
- `shieldZone` fields: `planType`, `learningMode`, `wafEnabled`,
  `wafExecutionMode` (0 Log, 1 Block), `wafDisabledRules[]`,
  `wafLogOnlyRules[]`, `wafRealtimeThreatIntelligenceEnabled`,
  `dDoSShieldSensitivity` (0 Off … 3 High, 4 Challenge, 5 ChallengeInteractive),
  `dDoSChallengeWindow`.
- Rate limits: `/shield/rate-limit` CRUD, list `/shield/rate-limits/{zone}`;
  `requestCount`, `timeframe` ∈ {1,10,60,300,900,3600}s, `blockTime` ∈
  {30,60,300,900,1800,3600}s, `counterKeyType` (0 IP, 1 Host, 2 Country, …),
  `actionType` (1 RateLimit, 2 Log, 3 Challenge), plus a match condition
  (`variableTypes`, `operatorType`, `value`).
- Custom WAF rules: `/shield/waf/custom-rule` CRUD (Advanced+).
- Access lists: `/shield/shield-zone/{id}/access-lists` (`{name, type, content}`,
  newline-separated entries; type 0 IP, 1 CIDR, 2 ASN, 3 Country, 4 Org,
  5 JA4); action set separately via `PATCH access-lists/configurations/{id}`
  (`{isEnabled, action}`: 1 Allow, 2 Block, 3 Challenge, 4 Log, 5 Bypass).
- Bot detection: `GET/PATCH /shield/shield-zone/{id}/bot-detection`
  (`executionMode` 0 LogOnly / 1 Challenge; sensitivities 0–3). Returns 202
  `invalid_plan_type.bot_detection` when the plan lacks it.
- Rule ids are server-assigned integers → converge by unique rule name.
- Errors: `GenericRequestResponse {success, message, errorKey, statusCode}`;
  some writes return 202.
