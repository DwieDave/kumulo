# UpCloud provider check against the UpCloud API docs

Date: 2026-10-29. Scope: `packages/upcloud/{client,distro-uks,volumes,storage}` plus the CLI code that drives them (`packages/cli/src/upcloud/*`).

The client is hand-written, so nothing like `codegen:check` catches drift from the real API. This table lists every difference that looks risky to deploy as-is. It compares the code with the UpCloud API docs and uses the official Go SDK (`UpCloudLtd/upcloud-go-api`) as the tie-breaker where the docs are silent. Nothing here was probed against the live API.

**Confidence**
- **Docs:** the API docs say it explicitly. The high-severity rows and the object-storage pagination, zones and `deleted` rows were re-checked by hand against the doc pages.
- **SDK:** only UpCloud's Go SDK shows it.
- **Code:** the risk lies in kumulo's own logic, not in an API mismatch.
- **Inferred:** the docs are silent, and one live call would settle it.

Paths are relative to `packages/`.

## High

| # | Area | Finding | Code | Docs / SDK | Deploy impact | Fix | Confidence | Status |
|---|---|---|---|---|---|---|---|---|
| H1 | UKS upgrade | `strategy` is sent as a string (`"manual"`). The API expects an object: `{"type":"manual"}` | `upcloud/client/src/client/uks.ts:72`, `upcloud/distro-uks/src/distro/upgrade-cluster.ts:27` | Upgrade cluster example: `"strategy": {"type": "manual"}`; types `manual` / `rolling-update` | Every `kumulo upgrade --yes` sends an invalid body. Expect a 400/422, or a `rolling-update` silently treated as manual | Send `strategy: { type }` | Docs | T3, T5 |
| H2 | UKS cluster PATCH | The PATCH leaves out `control_plane_ip_filter` when the config has none. The ownership label hashes the whole config, so **any** edit (e.g. a pool count) triggers this PATCH | `upcloud/distro-uks/src/distro/ensure-cluster.ts:80-89`, `ownership.ts:17-20` | Modify cluster: `control_plane_ip_filter` is Required, and "`null` is not accepted in `PATCH` request" | Apply fails before node pools reconcile for every cluster without an IP filter | Always send the filter: the live value, or `["0.0.0.0/0"]` | Docs | T4 |
| H3 | Object storage | The IAM user never gets a policy. The client has no policy endpoints at all | `upcloud/storage/src/provider/object-storage-provider.ts:139-186`, `upcloud/client/src/client/object-storage.ts` | "Attach user policy" `POST …/users/{username}/policies`. UpCloud's restrict-user-access guide says a new user without a policy is refused | Credentials written to sops get AccessDenied on every S3 call. Re-runs don't fix it, because `ensureCredentials` is skipped once the creds file exists (`cli/src/upcloud/storage.ts:87`) | Attach a policy idempotently (`ECSS3FullAccess` or a bucket-scoped one) on every run | Docs (guide) + code | T11, T12 |
| H4 | Transport | Every method, including `POST` creates, is retried up to 5× on 5xx. The OpenStack transport limits this to idempotent methods | `upcloud/client/src/transport/http-client.ts:8,33` (compare `openstack/client/src/transport/http-client.ts:9-12`) | Docs say a 500 is "a temporary cloud service problem" and give no idempotency keys. The SDK doesn't retry | A 5xx after a committed create duplicates billable disks, networks, routers, services or access keys. Label and name lookups then pick one at random, and the rest leak | Retry POST only on 429 | Inferred (code behaviour is certain) | T1 |

## Medium

| # | Area | Finding | Code | Docs / SDK | Deploy impact | Fix | Confidence | Status |
|---|---|---|---|---|---|---|---|---|
| M1 | UKS IP filter | `[]` means deny-all, but the config accepts it and drift treats `[]` the same as unset | `upcloud/distro-uks/src/config.ts:126`, `ensure-cluster.ts:82` | "To deny access from all sources, use `[]`"; null = no filtering | `control_plane_ip_filter: []` locks kumulo itself out of the control plane (kubeconfig, DNS, volumes). A live deny-all shows no drift | Keep null and `[]` distinct; reject `[]` or warn on it | Docs | T4 |
| M2 | UKS node groups | `kubelet_args` is decoded as `string[]`, but the API returns `{key,value}` objects | `upcloud/client/src/client/node-groups.ts:36` | Node group examples: `"kubelet_args": [{"key":"log-flush-frequency","value":"5s"}]` | If any node group in the cluster has kubelet args (e.g. set via Terraform or the console), the list fails to decode. Plan, apply and status all break | `Array(Struct({key, value}))` | Docs + SDK | T3 |
| M3 | Object storage | List calls send no `limit`/`offset`. The default page is 10 | `upcloud/client/src/client/object-storage.ts:140,154` | List services / list bucket metrics: `limit` 0-100, default 10 | With more than 10 services, `<cluster>-objsto` isn't found: re-create fails on the unique name and teardown leaks the service. With more than 10 buckets, deletes no-op and creates repeat | Page with `limit=100&offset=n` | Docs | T11 |
| M4 | Object storage | `ensureBucket` runs with `concurrency: 4`, and each call does its own list-then-create of the service | `cli/src/upcloud/storage.ts:78-81`, `object-storage-provider.ts:58-78` | Service name "must be unique within customer account" | The first apply with 2+ buckets races the creates and fails (400), or makes duplicate services | Ensure the service once, before the bucket loop | Code | T12 |
| M5 | Object storage | Teardown force-deletes the service when every *configured* bucket is `retain: false`, ignoring buckets outside the config | `cli/src/upcloud/storage.ts:115-128` | `force`: "deletion process starts even if service is not empty … objects cannot be restored" | Buckets created in the console, over S3, or by an older config are destroyed with their data | List all buckets first and refuse if any are unconfigured or non-empty, or delete without `force` | Docs | T13 |
| M6 | Object storage | The only data-loss guard on bucket delete is the `total_objects` metric. The `ResourceConflict` (409) fallback can never fire | `object-storage-provider.ts:130-136` | Delete bucket: "will remove all objects from the bucket permanently and cannot be reversed". Only 404 is documented | If the metric lags behind recent uploads, data is deleted permanently | Check emptiness via S3 ListObjectsV2 `max-keys=1` | Docs (lag inferred) | deferred |
| M7 | Object storage | `BucketMetrics.deleted` is required, but the documented responses don't include it | `upcloud/client/src/client/object-storage.ts:44-49` | List/create bucket examples: `name`, `total_objects`, `total_size_bytes` only. The SDK has `Deleted bool` | If the live API omits it, every bucket operation fails to decode | `optionalKey`, default false | Docs vs SDK disagree; inferred | T11 |
| M8 | Object storage | Region `zones` is decoded as `string[]`, but the API returns `[{name}]` | `upcloud/client/src/client/object-storage.ts:70-74` | List regions: `"zones": [{"name": "fi-hel1"}, …]` | The doctor's region check (`cli/src/doctor/upcloud/storage.ts:30-34`) always fails | `Array(Struct({name}))` | Docs + SDK | T11 |
| M9 | Network / router | Lookup is by name only, across all zones. No ownership labels are set, although requirements D10 says they should be | `upcloud/distro-uks/src/distro/network.ts:14-26,52-63,85-100` | `GET /1.3/network` lists all zones (`?zone=` narrows it). Names aren't unique. Labels and `?label=` filter are supported | Same-named clusters in two zones share a network, so UKS create fails with a zone mismatch. Delete can remove a user's own empty `<name>-network`/`-router` | Label on create; list by `zone` + label | Docs | T9 |
| M10 | Volumes | The volume lookup lists every storage in the account (templates, backups, other zones) and filters on labels only | `upcloud/volumes/src/provider.ts:20-25,79-80`, `upcloud/client/src/client/storage.ts:62` | `/1.3/storage/private/normal`, `?label=` filter; the base list includes `backup`/`template` types | A PV can bind to a disk in another zone. If backups inherit labels, a backup UUID could be bound or deleted | Use `/storage/private/normal?label=…` and check `zone` | Docs (backup labels inferred) | T10 |
| M11 | Teardown | Network and router delete run once, right after the cluster leaves the list, with no retry on `NETWORK_NOT_EMPTY`. Node-group deletes and scales aren't awaited, and `terminating` groups still count as existing | `upcloud/distro-uks/src/distro/delete.ts:9-29`, `network.ts:85-100`, `ensure-nodepools.ts:49-65` | Network delete: 409 `NETWORK_NOT_EMPTY`. Router: `ROUTER_CHANGE_CONFLICT`, "try again later". Cluster and node-group DELETE return 202. Terraform waits for both | Delete errors out and leaves the network and router behind (open question Q10). The next plan can show a false replace for a terminating group | Bounded retry on 409, wait for node-group 404, skip `terminating` | Docs (timing inferred) | T7, T9 |
| M12 | UKS network | The CIDR validator misses the UKS reserved ranges | `upcloud/distro-uks/src/config.ts:19-25` | Data-plane docs: control plane 172.31.240.0/24, services 10.128.0.0/12, pods 192.168.0.0/16, forwarder 10.33.128.0/22, plus a per-zone utility /16 (e.g. de-fra1 10.4.0.0/16) | Common picks like `192.168.0.0/24` pass validation. The network and router get built, then the cluster create fails or routing breaks, and the CIDR can't be changed after creation | Add the ranges to the validator | Docs | T8 |
| M13 | UKS node groups | Worker-pool `labels` are hashed but never sent | `upcloud/distro-uks/src/distro/ensure-nodepools.ts:20-36` | Node-group `labels` become node labels | nodeSelectors never match. Plan shows NoOp (silent drift) | Merge the user labels into the payload | Code | T6 |
| M14 | UKS node groups | A taint string like `dedicated=gpu:NoExecute` becomes `{key: <whole string>, value: "", effect: "NoSchedule"}` | `ensure-nodepools.ts:31`, `config.ts:75` | Taint: `key`, `value`, `effect` ∈ NoExecute / NoSchedule / PreferNoSchedule | The API rejects it, or applies the wrong taint and ignores the user's effect | Parse `key[=value]:Effect` | Docs | T6 |
| M15 | UKS version | The live `version` is never compared with the config. Upgrade uses `config.version` as current | `upcloud/distro-uks/src/distro/cluster-drift.ts`, `cli/src/upcloud/reconcile.ts:288` | Version changes only via `POST /upgrade`. A manual upgrade requires re-creating the node groups | Editing `version` plans as NoOp. After a manual upgrade the nodes stay on the old kubelet, and nothing suggests a replace | Add the version to drift; consider adding it to the pool hash | Code + docs | T5 |
| M16 | UKS polling | The first 404 right after create aborts the wait | `upcloud/distro-uks/src/distro/ensure-cluster.ts:60-70`, `ensure-nodepools.ts:67-77`, `status.ts:19-22` | SDK `WaitForKubernetesClusterState`: "Ignore first two 404 responses … false NOT_FOUND right after cluster has been created" | The first apply fails at random; a re-run recovers | Tolerate early 404s in create polls | SDK | T7 |
| M17 | UKS encryption | `storage_encryption` is mapped as "key present = encrypted". A `null` value would fail decoding | `ensure-cluster.ts:23`, `upcloud/client/src/client/uks.ts:24` | Valid values: `data-at-rest`, `none` | If the API returns `"none"`, every plan and apply refuses with false drift. If it returns `null`, every cluster get or list fails | `=== "data-at-rest"`; `NullOr(String)` | Inferred | T3, T5 |
| M18 | UKS states | The cluster state enum is closed and lacks `terminated`. One unknown state breaks the whole list | `upcloud/client/src/client/uks.ts:9` | Docs list pending/running/terminating/failed/unknown. The SDK also has `terminated` | If a just-deleted cluster shows as `terminated`, delete polls, `findClusterByName` and apply all fail; the network and router leak | Add `terminated`; decode unknown states leniently | SDK (inferred) | T3 |
| M19 | Errors | 403 is always reported as "token lacks permission". Storage and network limit errors are 403 | `upcloud/client/src/errors/index.ts:46` | Create storage: 403 `*_STORAGE_LIMIT_REACHED`, `NETWORK_LIMIT_REACHED`; body `{"error":{"error_code",…}}` | Users rotate tokens instead of raising quota | On 403, map `*_LIMIT_REACHED` to `QuotaExceeded` | Docs | T2 |
| M20 | Transport | No per-request timeout (OpenStack uses 30 s) | `upcloud/client/src/transport/http-client.ts` | Docs silent | A stalled connection hangs apply or delete; `ensureNetwork` and deletes have no outer timeout | Add a request timeout | Inferred | T1 |

## Low

| # | Area | Finding | Code | Docs / SDK | Deploy impact | Fix | Confidence | Status |
|---|---|---|---|---|---|---|---|---|
| L1 | Volumes | `size` is sent as a JSON number | `upcloud/client/src/client/storage.ts:66` | Example `"size": "10"`; SDK `json:"size,string"` | If numbers are rejected, every volume create fails with `SIZE_INVALID` | Send a string, or probe once | Inferred | T10 |
| L2 | Volumes | `encrypted?: boolean` would be sent as a JSON boolean (unused today) | `upcloud/client/src/client/storage.ts:42` | `yes` / `no` | It breaks as soon as it's used | Type it as `"yes" \| "no"` | Docs | T10 |
| L3 | Volumes | Delete 409 is assumed to mean "attached". `STORAGE_STATE_ILLEGAL` (backuping or maintenance) is also a 409 | `upcloud/volumes/src/provider.ts:83` | Delete storage: must be `online` and detached; both errors are 409 | Wrong diagnosis; the detach-check logic (D9) can't tell them apart | Parse `error_code` or poll to `online` | Docs | T10 |
| L4 | Transport | `Retry-After` is ignored; the retry budget is about 6 s total | `upcloud/client/src/transport/http-client.ts:10-14` | Rate limits undocumented | Sustained throttling surfaces as `RateLimited` | Honour `Retry-After` | Inferred | T1 |
| L5 | Decoding | Closed enums for storage `state`, network `dhcp`/`family` on account-wide lists | `upcloud/client/src/client/storage.ts:13`, `network.ts:15,18` | They match the docs today; the SDK decodes leniently | A new value anywhere in the account blocks every apply | Decode as `String`, narrow where used | Inferred | T3, T10 |
| L6 | UKS config | Cluster name rules aren't enforced, and the failure comes after the network is built | `core/src/config/schema.ts:271` | "3-55 lowercase letters, numbers & -. Cannot start or end with -" | Late, confusing failure after the router and network exist | Add a UKS name pattern | Docs | T8 |
| L7 | UKS node groups | `storage: {tier}` sent on create (unreachable: config never sets it) | `ensure-nodepools.ts:33`, `upcloud/client/src/client/node-groups.ts:24,59` | `storage` is a template UUID; tier and size go in `custom_plan`/`cloud_native_plan` | Every create with storage fails once it's exposed | Send a UUID or a plan object | Docs + SDK | T3 |
| L8 | UKS config | `UksVersion` allows a `v` prefix | `upcloud/distro-uks/src/config.ts:62` | API uses bare `1.31` | `v1.31` is likely a 422 on create | Drop the `v?` | Inferred | T8 |
| L9 | UKS upgrade | NEXT_MINOR takes `availableUpgrades[0]`; nothing waits for `running` after an upgrade | `upcloud/distro-uks/src/distro/upgrade.ts:20`, `upgrade-cluster.ts` | Order of `versions` is undefined; upgrade returns 202 | Possibly skips a minor; a following apply races a non-running cluster | Pick the lowest minor above current; wait after upgrade | Inferred | T5 |
| L10 | UKS polling | `failed` isn't terminal; the polls spin until the 10-minute timeout | `ensure-cluster.ts:65`, `ensure-nodepools.ts:72` | `failed`: "internal system failure" | Slow, misleading failure | Fail fast on `failed` | Docs | T7 |
| L11 | UKS labels | `isValidLabel` allows a leading or trailing `-`/`_` | `upcloud/distro-uks/src/distro/ownership.ts:13` | "Cannot start or end with - or _" | Not hit by today's generated values | Tighten the regex | Docs | T8 |
| L12 | UKS defaults | `uksPoolHash` treats an unset `utility_network_access` as false; the API default is true | `upcloud/distro-uks/src/distro/nodegroup-diff.ts:21` | "Defaults to true" | Causes a spurious replace once the field is exposed | Default it to true | Docs | deferred |
| L13 | Object storage | The S3 endpoint is picked with `type === "public"`, which also matches static-website endpoints | `object-storage-provider.ts:19-20` | Static-website endpoints are `type: public`, `mode: static-website` and give no S3 API access | Can write a non-S3 host into the creds | Also require `mode === "api"` | Docs | T11, T12 |
| L14 | Object storage | Buckets added after the first apply never reach the creds file | `cli/src/upcloud/storage.ts:87` | — | Silent drift in sops | Rewrite the bucket entries every run | Code | T12 |
| L15 | Object storage | A `stopped` or `delete-*` service is polled for 20 minutes waiting for `running` | `object-storage-provider.ts:47,65,77` | Operational states include `stopped` and `delete-*` | Long hang, misleading "certificate" message | Fail fast; PATCH `configured_status: started` | Docs | T12 |
| L16 | Object storage | A bucket with `deleted: true` is re-created immediately | `object-storage-provider.ts:87` | Bucket deletion is async (`cleanup-deleted-buckets`; SDK `WaitForManagedObjectStorageBucketDeletion`) | Create fails while the old bucket is still being deleted | Wait until the name is gone | Inferred | T12 |

## Verified as matching

- **Base, auth, envelopes:**
  - Base URL is `https://api.upcloud.com/1.3` with Bearer auth.
  - Network and router use the double-wrapped `{networks:{network:[]}}` envelope.
  - Storage uses `{storages:{storage:[]}}`; zones use `{zones:{zone:[]}}`.
  - UKS and object storage (`/1.3/object-storage-2`) return bare JSON.
- **UKS endpoints:** all paths and methods match, including plans, kubeconfig, available-upgrades and per-node delete. The node-group PATCH accepts `{count}` only. The node-group state enum, label key/value limits and creation-time-only fields match.
- **Object storage:**
  - Create service needs `name`, `region` and `configured_status`.
  - Deletes return 204 and are followed by a 404 poll.
  - The access-key secret is returned only on create, which matches kumulo's rotate-when-the-file-is-missing approach.
- **Storage:** create returns 201, modify (PUT) returns 202, and `DELETE ?backups=delete` returns 204. Polling a new disk until `online` is correct.
- **Errors:** 404 codes make `ignoreMissing` safe. 402 maps to `QuotaExceeded`.

## Not verified

- No live API calls were made. One probe each would settle M7, M17, M18, L1 and the backup-label question in M10.
- UKS StorageClass names `upcloud-block-storage-<tier>` (`upcloud/volumes/src/manifests.ts:5`).
- UpCloud has no public OpenAPI spec (`upcloudltd.github.io/upcloud-openapi-spec` returns 404).

## Sources

- https://developers.upcloud.com/1.3/20-managed-kubernetes/
- https://developers.upcloud.com/1.3/21-managed-object-storage/
- https://developers.upcloud.com/1.3/13-networks/
- https://developers.upcloud.com/1.3/9-storages/
- https://developers.upcloud.com/1.3/2-architecture/
- https://developers.upcloud.com/1.3/24-api-tokens/
- https://upcloud.com/docs/products/managed-kubernetes/data-plane/
- https://upcloud.com/docs/guides/restrict-user-access-managed-object-storage/
- https://github.com/UpCloudLtd/upcloud-go-api (`upcloud/kubernetes.go`, `service/kubernetes.go`, `managed_object_storage.go`, `storage.go`, `request/storage.go`, `client/client.go`)
- https://github.com/UpCloudLtd/terraform-provider-upcloud (`internal/service/kubernetes/`)
