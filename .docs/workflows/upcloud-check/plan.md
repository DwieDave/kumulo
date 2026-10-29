# UpCloud provider fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the risky differences between the UpCloud provider and UpCloud's API that are listed in `findings.md`, so that apply, upgrade, teardown and object storage behave as the docs say.

**Architecture:** Each fix stays in the package that owns the code:
- `client` (wire shapes, transport, errors);
- `distro-uks` (cluster, node groups, network);
- `volumes`;
- `storage` (object storage);
- `cli/src/upcloud` (orchestration and plan).

No new packages, and no new dependencies.

**Tech Stack:** TypeScript, Effect v4 (`effect/Schema`, `effect/http`), `@effect/vitest`, bun.

**Spec:** `.docs/workflows/upcloud-check/findings.md`. Row IDs (H1, M3, …) refer to that table. API facts quoted below were checked against the doc pages on 2026-10-29.

## Global Constraints

- **Wire format:** must follow the UpCloud API docs. Where the docs are silent, follow the Go SDK `UpCloudLtd/upcloud-go-api`.
- **Retries:** POST requests are never retried on 5xx, only on 429.
- **Existing clusters:** clusters created before this change must still converge. Nothing may be duplicated, replaced or deleted just because it lacks a label or hash that this plan introduces.
- **`uksPoolHash` output:** must not change for any existing pool config. A changed hash plans a replace of every node pool.
- **Dependencies:** none added.
- **Tests:** every test uses the existing in-memory fakes:
  - `packages/upcloud/client/test/client/*`
  - `packages/upcloud/distro-uks/test/distro/fake-uks-server.ts`
  - `packages/upcloud/volumes/test/fake-storage-server.ts`
  - `packages/upcloud/storage/test/provider/fake-object-storage-server.ts`

  Extend these fakes as needed. No test may call the network.
- **Commits:** messages follow the repo's conventional style (`fix(upcloud): …`). No co-author trailers.
- **CI:** after every task, `bun run ci` must pass from the repo root.

## Review Focus

1. **A cluster created before this change.** Its router and network have no labels, and its pools have no user labels. Apply must adopt them by the old name and add labels. It must not create a second router or network, and it must not plan a replace. Covered by tests in Task 9 and Task 6.
2. **A config without `control_plane_ip_filter`, against a cluster whose filter was set in the console.** Apply must leave the live filter alone, not wipe it or open it. Covered by a test in Task 4.
3. **An account with resources kumulo doesn't own:**
   - another cluster's node group with `kubelet_args`;
   - a storage in another zone with matching labels;
   - more than 10 object storage services.

   Lists must still decode, and lookups must ignore those resources. Covered by tests in Tasks 3, 10 and 11.
4. **Re-running apply after the sops credentials file exists.** The user must still end up with the policy attached. Covered by a test in Task 12.
5. **A taint written in the old bare form (`gpu`).** It must produce exactly the payload it produced before (`{key:"gpu", value:"", effect:"NoSchedule"}`), and the pool hash must not change. Covered by a test in Task 6.

## Deferred (not in this plan)

- **M6, bucket-delete data-loss guard via S3 `ListObjectsV2`.** This needs a SigV4 S3 client, which kumulo doesn't have. Task 13 adds the API-side mitigations. A real S3 check is a separate plan.
- **L12, `utility_network_access` defaulting to true in the hash.** Changing the hash breaks the global constraint above. Revisit it when the field is exposed in config.

---

### Task 1: Transport: safe retries, request timeout, Retry-After (H4, M20, L4)

**Files:**
- Modify: `packages/upcloud/client/src/transport/http-client.ts`
- Test: `packages/upcloud/client/test/transport/http-client.test.ts`

**Interfaces:**
- Produces: `DEFAULT_REQUEST_TIMEOUT: Duration.Input = "30 seconds"`; `UpcloudHttpClientOptions.requestTimeout?: Duration.Input`; `retryAfterCapSeconds = 60`. All are exported from the package barrel next to `transportMaxRetries`.

- [ ] **Step 1: Write failing tests** in `http-client.test.ts`:
  - `"does not retry a POST on 5xx"`: base returns 503. `client.execute(HttpClientRequest.post("/1.3/storage"))` gives `response.status === 503` and `calls === 1`.
  - `"retries a POST on 429"`: 429, 429, then 201 gives status 201 and `calls === 3`.
  - `"still retries GET/PUT/PATCH/DELETE on 5xx"`: for each method, persistent 503 gives `calls === 6`.
  - `"waits Retry-After seconds on 429"`: the first response is 429 with header `retry-after: 2`, then 200. Run under `TestClock`, advance 1 second and assert `calls === 1`, then advance 1 second more and assert `calls === 2`.
  - `"fails with a timeout when the server never answers"`: the base is `HttpClient.make(() => Effect.never)` with `requestTimeout: "1 second"`. Under `TestClock`, advance 1 second. The execute fails with an `HttpClientError` whose reason is `TransportError`.
- [ ] **Step 2: Run** `bun x vitest run packages/upcloud/client/test/transport/http-client.test.ts` and confirm the new tests FAIL.
- [ ] **Step 3: Implement.**
  - **Retry gating:** `_isRetryable(method: string, status: number): boolean` returns true for any method on 429. On 5xx it returns true only for methods in `_idempotent = new Set(["GET","HEAD","PUT","PATCH","DELETE","OPTIONS"])`. UpCloud's PATCHes are full-value updates, so retrying them is safe.
  - **Retry-After:** before each retry on a 429 whose `retry-after` parses as an integer, sleep `min(value, retryAfterCapSeconds)` seconds instead of the exponential delay.
  - **Timeout:** wrap each attempt in `Effect.timeoutOrElse` with `requestTimeout ?? DEFAULT_REQUEST_TIMEOUT`. On timeout, fail with `HttpClientError({ reason: new TransportError({ request, description: "UpCloud request timed out" }) })`. This mirrors the OpenStack transport (`packages/openstack/client/src/transport/http-client.ts`).
- [ ] **Step 4: Run** the same command and confirm everything PASSES.
- [ ] **Step 5: Commit** `fix(upcloud): never retry POST on 5xx, add request timeout and Retry-After`.

### Task 2: Classify quota errors returned as 403 (M19)

**Files:**
- Modify: `packages/upcloud/client/src/errors/index.ts`
- Test: `packages/upcloud/client/test/errors/index.test.ts`

**Interfaces:**
- Produces: `upcloudErrorCode(body: string): string | undefined`, exported. It reads `error.error_code` from the classic body `{"error":{"error_code","error_message"}}`. It returns `undefined` for anything else, including RFC 7807 problem bodies.

- [ ] **Step 1: Write failing tests:**
  - `statusError` with status 403 and body `{"error":{"error_code":"STORAGE_LIMIT_REACHED","error_message":"x"}}` gives `_tag === "QuotaExceeded"` and `resource === ctx.kind`. Do the same for `NETWORK_LIMIT_REACHED`.
  - `statusError` with 403 and body `{"error":{"error_code":"INSUFFICIENT_PERMISSIONS"}}` gives `AuthenticationFailed`, as it does today.
  - `upcloudErrorCode("not json")` gives `undefined`.
- [ ] **Step 2: Run** `bun x vitest run packages/upcloud/client/test/errors` and confirm the tests FAIL.
- [ ] **Step 3: Implement.** In `statusError`, the 403 branch checks `upcloudErrorCode(c.body)?.endsWith("_LIMIT_REACHED")` and returns `QuotaExceeded` when it matches. Every other 403 keeps returning `AuthenticationFailed`.
- [ ] **Step 4: Run** the tests and confirm they PASS. **Step 5: Commit** `fix(upcloud): report *_LIMIT_REACHED 403s as quota errors`.

### Task 3: UKS and node-group wire schemas (H1 client side, M2, M18, L7, L5 for UKS, M17 decode)

**Files:**
- Modify: `packages/upcloud/client/src/client/uks.ts`
- Modify: `packages/upcloud/client/src/client/node-groups.ts`
- Test: `packages/upcloud/client/test/client/uks.test.ts`
- Test: `packages/upcloud/client/test/client/node-groups.test.ts`

**Interfaces:**
- Produces:
  - `UksCluster.state: string`, decoded leniently. `UksState` stays exported as the known-literal schema, with `"terminated"` added.
  - `UksCluster.storage_encryption: optionalKey(NullOr(String))`.
  - `NodeGroup.state: optionalKey(String)`. `NodeGroupState` stays exported.
  - `NodeGroupKubeletArg = Struct({ key: String, value: String })`, and `NodeGroup.kubelet_args: optionalKey(Array(NodeGroupKubeletArg))`.
  - `NodeGroupCreateInput.kubelet_args?: ReadonlyArray<NodeGroupKubeletArg>`.
  - `NodeGroupCreateInput.storage?: string`. This is the storage template UUID; `NodeGroupStorage` is removed from the input.
  - `UksUpgradeRequest = { readonly version: string; readonly strategy?: { readonly type: "manual" | "rolling-update" } }`.
  - `UksClient.upgrade(uuid, body: UksUpgradeRequest)`.

- [ ] **Step 1: Write failing tests:**
  - **`kubelet_args`:** a node-group list response containing `"kubelet_args":[{"key":"log-flush-frequency","value":"5s"}]` decodes, and the value round-trips.
  - **Unknown state:** a cluster list containing one cluster with `"state":"terminated"` and one with `"state":"some-future-state"` decodes to two clusters.
  - **Null encryption:** a cluster with `"storage_encryption": null` decodes.
  - **Upgrade body:** `upgrade(uuid, { version: "1.31", strategy: { type: "rolling-update" } })` sends exactly `{"version":"1.31","strategy":{"type":"rolling-update"}}`. Assert with `capturedJson`.
- [ ] **Step 2: Run** `bun x vitest run packages/upcloud/client/test/client` and confirm the tests FAIL.
- [ ] **Step 3: Implement** the schema and type changes in the Interfaces block. Fix any compile errors in `distro-uks` that follow from `state: string` by comparing against literals, which still works. The `storage` and `upgrade` call sites are fixed in Tasks 5 and 6. For now, make them compile:
  - `ensure-nodepools.ts`: `storage: pool.storage`.
  - `upgrade-cluster.ts`: `strategy: { type: upgradeStrategy }`.
- [ ] **Step 4: Run** `bun x vitest run packages/upcloud` and `bun run typecheck`; both must PASS.
- [ ] **Step 5: Commit** `fix(upcloud): match UKS wire shapes (kubelet_args, upgrade strategy, lenient states)`.

### Task 4: Cluster PATCH always carries the IP filter; `[]` is not "unset" (H2, M1)

**Files:**
- Modify: `packages/upcloud/distro-uks/src/distro/ensure-cluster.ts:76-91`
- Modify: `packages/upcloud/distro-uks/src/config.ts:126`
- Test: `packages/upcloud/distro-uks/test/distro/lifecycle.test.ts`
- Test: `packages/cli/test/config/*` (the existing UpCloud config test file)

**Interfaces:**
- Produces: `desiredIpFilter({ config, live }: { config?: ReadonlyArray<string>; live?: ReadonlyArray<string> | null }): ReadonlyArray<string>`, exported from `ensure-cluster.ts`. It returns `config` if set, otherwise `live` if it is non-null, otherwise `["0.0.0.0/0"]`.

The rule: when the config has no `control_plane_ip_filter`, kumulo doesn't manage the filter. To open access explicitly, the config must say `["0.0.0.0/0"]`.

- [ ] **Step 1: Write failing tests:**
  - `"a label-only patch still sends control_plane_ip_filter"`: create a cluster with no filter, then change a pool count so the ownership hash drifts. Every PATCH body recorded by the fake has the `control_plane_ip_filter` key, with value `["0.0.0.0/0"]`. Extend `fake-uks-server.ts` so that a PATCH without the key returns 400 `INVALID_REQUEST`, matching the docs.
  - `"a config without a filter keeps a live filter"` (Review Focus 2): the fake cluster has the live filter `["10.0.0.0/8"]` and the config has none. The PATCH sends `["10.0.0.0/8"]`, and no filter drift is computed. The PATCH is triggered by labels only.
  - **Config decode:** `control_plane_ip_filter: []` fails with a message containing `"[] denies all access"`.
- [ ] **Step 2: Run** `bun x vitest run packages/upcloud/distro-uks packages/cli/test/config` and confirm the tests FAIL.
- [ ] **Step 3: Implement.**
  - Filter drift is computed only when `config.control_plane_ip_filter !== undefined`, comparing it with `cluster.control_plane_ip_filter`, where `null` is distinct from `[]`.
  - The PATCH body always uses `desiredIpFilter`.
  - In the config schema, add `Schema.isMinLength(1)` to the array with the message `"must not be empty: [] denies all access to the control plane; omit the field to leave the filter unmanaged, or use [\"0.0.0.0/0\"] to allow all"`.
- [ ] **Step 4: Run** the tests and confirm they PASS. **Step 5: Commit** `fix(upcloud-uks): always send control_plane_ip_filter on cluster PATCH`.

### Task 5: Encryption mapping, version drift, upgrade target and wait (M17, M15, H1 call site, L9)

**Files:**
- Modify: `packages/upcloud/distro-uks/src/distro/ensure-cluster.ts:14-26,93-103`
- Modify: `packages/upcloud/distro-uks/src/distro/cluster-drift.ts`
- Modify: `packages/upcloud/distro-uks/src/distro/upgrade.ts`
- Modify: `packages/upcloud/distro-uks/src/distro/upgrade-cluster.ts`
- Modify: `packages/cli/src/upcloud/plan.ts:55-85`
- Modify: `packages/cli/src/upcloud/reconcile.ts:268-295`
- Test: `packages/upcloud/distro-uks/test/distro/cluster-drift.test.ts`
- Test: `packages/upcloud/distro-uks/test/distro/upgrade.test.ts`
- Test: `packages/cli/test/upcloud/plan.test.ts`

**Interfaces:**
- Produces:
  - `UksClusterInfo.version: string`.
  - `versionDrift({ live, desired }: { live: string; desired: string }): VersionDrift`, where `VersionDrift = Data.TaggedEnum<{ None: {}; Behind: { live: string; desired: string }; Ahead: { live: string; desired: string } }>`. `Behind` means the live version is lower than the config.
  - `compareMinor(a: string, b: string): number`, which compares `major.minor` numerically.
  - `resolveUpgradeTarget` picks the lowest available version that is greater than `currentVersion`.
  - `upgradeCluster` takes `currentVersion` from the live cluster and waits for the cluster state `running` after the POST, with a 30-minute timeout and a 10-second interval.

- [ ] **Step 1: Write failing tests:**
  - **Encryption:** `_toInfo` maps `storage_encryption: "none"` to `storageEncryption: false`, `"data-at-rest"` to `true`, and `null` or absent to `false`. Test this through `findClusterByName` on the fake.
  - **Ordering:** `resolveUpgradeTarget({ strategy: "NEXT_MINOR", currentVersion: "1.30", availableUpgrades: ["1.32", "1.31"] })` gives `Upgrade({ version: "1.31" })`.
  - **`compareMinor`:** `compareMinor("1.9", "1.10") < 0`.
  - **Plan, behind:** the live version is `1.30` and the config says `1.31`. The cluster row is `Update` with a reason containing `"run kumulo upgrade"`.
  - **Plan, ahead:** the live version is `1.31` and the config says `1.30`. The cluster row is `ReplaceNeedsConfirm` with a reason containing `"UKS cannot downgrade"`.
  - **Apply, ahead:** `ensureCluster` on the same versions fails with `ResourceConflict`.
  - **Apply, behind:** `ensureCluster` logs a warning but succeeds. Apply doesn't upgrade.
  - **Upgrade:** after `upgradeCluster`, the fake has recorded `GET` polls until `running`, and the POST body has `strategy.type === "manual"` when the config omits `upgrade_strategy`.
- [ ] **Step 2: Run** `bun x vitest run packages/upcloud/distro-uks packages/cli/test/upcloud` and confirm the tests FAIL.
- [ ] **Step 3: Implement.**
  - `storageEncryption: cluster.storage_encryption === "data-at-rest"`.
  - Add `version` to the inventory and to `UksClusterInfo`.
  - `reconcile.ts` passes `currentVersion: info.version`.
  - After a `manual` upgrade, print: `Node groups keep their old kubelet until replaced: re-create each pool to finish the upgrade.`
- [ ] **Step 4: Run** the tests and confirm they PASS. **Step 5: Commit** `fix(upcloud-uks): detect version drift, order upgrades, wait after upgrade`.

### Task 6: Node-group payload: user labels and parsed taints (M13, M14)

**Files:**
- Modify: `packages/upcloud/distro-uks/src/distro/ensure-nodepools.ts:20-36`
- Modify: `packages/upcloud/distro-uks/src/config.ts:70-77`
- Test: `packages/upcloud/distro-uks/test/distro/lifecycle.test.ts`
- Test: `packages/upcloud/distro-uks/test/distro/nodegroup-hash.test.ts`

**Interfaces:**
- Produces:
  - `parseTaint(spec: string): { key: string; value: string; effect: "NoSchedule" | "PreferNoSchedule" | "NoExecute" }`, exported from `ensure-nodepools.ts`. The grammar is `key[=value][:Effect]`, and a missing effect means `NoSchedule`.
  - `UksTaint` (config schema): a string matching `^[^=:\s]{1,255}(=[^:\s]{0,255})?(:(NoSchedule|PreferNoSchedule|NoExecute))?$`.

- [ ] **Step 1: Write failing tests:**
  - **Old bare form** (Review Focus 5): `parseTaint("gpu")` gives `{key:"gpu", value:"", effect:"NoSchedule"}`.
  - **Full form:** `parseTaint("dedicated=gpu:NoExecute")` gives `{key:"dedicated", value:"gpu", effect:"NoExecute"}`.
  - **Config decode:** a taint of `"a:Bogus"` fails.
  - **Hash unchanged:** `uksPoolHash` for a pool with `taints: ["gpu"]` and `labels` equals the value pinned in `nodegroup-hash.test.ts` (add a golden value if none exists).
  - **Labels sent:** a pool with `labels: [{key:"role", value:"gpu"}]` is created with a labels array that contains `role=gpu` and the three `kumulo-*` labels.
  - **Reserved prefix:** a config pool label with a `kumulo-` key prefix fails decode with `"kumulo- label keys are reserved"`.
- [ ] **Step 2: Run** `bun x vitest run packages/upcloud/distro-uks` and confirm the tests FAIL.
- [ ] **Step 3: Implement.** `_createPayload` sends `labels: [...userLabels, ..._labels(...)]` and `taints: pool.taints?.map(parseTaint)`. Add the config checks.
- [ ] **Step 4: Run** the tests and confirm they PASS. **Step 5: Commit** `fix(upcloud-uks): send pool labels and parse taint effect`.

### Task 7: UKS polling: early 404s, failed state, node-group delete and scale waits (M16, L10, M11 node-group part)

**Files:**
- Modify: `packages/upcloud/distro-uks/src/distro/status.ts`
- Modify: `packages/upcloud/distro-uks/src/distro/ensure-cluster.ts:60-70`
- Modify: `packages/upcloud/distro-uks/src/distro/ensure-nodepools.ts:49-77`
- Test: `packages/upcloud/distro-uks/test/distro/lifecycle.test.ts`

**Interfaces:**
- Produces: `StatusPollOptions` gains two optional fields:
  - `tolerateNotFound?: number` (default 0): the number of leading `ResourceNotFound` failures to treat as "not ready".
  - `isFailed?: (status: Status) => boolean`: when true, the poll fails at once with `ProviderApiError({ operation: \`${kind} ${ref}\`, status: 0, body: \`entered state "failed"\` })`.

  `pollUntilGone(check, opts)` succeeds when `check` fails with `ResourceNotFound`.

- [ ] **Step 1: Write failing tests.** Extend the fake with options: `notFoundPollsAfterCreate`, `failClusterOnCreate` and a `terminating` dwell for deleted groups.
  - **Early 404s:** with 2 initial 404s after create, `ensureCluster` succeeds.
  - **Failed state:** with the cluster going to `failed`, `ensureCluster` fails with `ProviderApiError`, and the test does not advance the clock to the 10-minute timeout.
  - **Replace waits:** a pool replace waits until the old group returns 404 before returning.
  - **Terminating groups skipped:** while a deleted group is still `terminating`, the existing-group list that feeds the diff excludes it.
  - **Scale waits:** a scale waits for `running`.
- [ ] **Step 2: Run** `bun x vitest run packages/upcloud/distro-uks` and confirm the tests FAIL.
- [ ] **Step 3: Implement.**
  - Create polls use `tolerateNotFound: 2` and `isFailed: (s) => s.state === "failed"`.
  - Node-group delete is followed by `pollUntilGone` (3-second interval, 10-minute timeout).
  - Scale is followed by a running-poll.
  - `_toExisting` filters `state === "terminating"`.
- [ ] **Step 4: Run** the tests and confirm they PASS. **Step 5: Commit** `fix(upcloud-uks): tolerate early 404s, fail fast on failed, await node-group delete and scale`.

### Task 8: UKS config validation (M12, L6, L8, L11)

**Files:**
- Modify: `packages/upcloud/distro-uks/src/config.ts`
- Modify: `packages/upcloud/distro-uks/src/distro/ownership.ts:13`
- Test: the existing UpCloud config test file under `packages/cli/test/config/`
- Test: `packages/upcloud/distro-uks/test/distro/ownership.test.ts`

**Interfaces:**
- Produces:
  - `UKS_RESERVED_RANGES`: control plane `172.31.240.0/24`, services `10.128.0.0/12`, pods `192.168.0.0/16`, forwarder `10.33.128.0/22`.
  - `UKS_UTILITY_RANGES: Record<string, string>`, from https://upcloud.com/docs/products/managed-kubernetes/data-plane/:

    | Zone | Utility range |
    |---|---|
    | fi-hel1 | 10.1.0.0/16 |
    | uk-lon1 | 10.2.0.0/16 |
    | us-chi1 | 10.3.0.0/16 |
    | de-fra1 | 10.4.0.0/16 |
    | nl-ams1 | 10.5.0.0/16 |
    | fi-hel2 | 10.6.0.0/16 |
    | es-mad1 | 10.7.0.0/16 |
    | us-sjo1 | 10.8.0.0/16 |
    | us-nyc1 | 10.9.0.0/16 |
    | sg-sin1 | 10.10.0.0/16 |
    | pl-waw1 | 10.11.0.0/16 |
    | au-syd1 | 10.12.0.0/16 |
    | se-sto1 | 10.13.0.0/16 |
    | dk-cph1 | 10.14.0.0/16 |
    | no-svg1 | 10.15.0.0/16 |

  - `UksClusterName`: pattern `^[a-z0-9][a-z0-9-]{1,53}[a-z0-9]$`. This allows 3-55 characters with no leading or trailing hyphen. It overrides `name` in `UpcloudUksClusterConfig`.
  - `UksVersion`: pattern `^\d+\.\d+$` (no `v` prefix).

- [ ] **Step 1: Write failing tests:**
  - **Fixed ranges:** `network.cidr: "192.168.0.0/24"` fails with a message naming `"POD CIDR 192.168.0.0/16"`. So does `10.0.0.0/8`, which overlaps the service range.
  - **Zone utility range:** with zone `de-fra1`, `10.4.1.0/24` fails, but with zone `fi-hel1` the same CIDR passes. The utility range is checked at struct level, because it needs the zone.
  - **Valid CIDR:** `172.16.0.0/24` passes.
  - **Name:** `Prod_EU` and `ab` fail; `prod-eu` passes.
  - **Version:** `v1.31` fails.
  - **Label value:** `isValidLabel({key:"k", value:"-x"})` is false and `isValidLabel({key:"k", value:""})` is true.
- [ ] **Step 2: Run** the tests and confirm they FAIL.
- [ ] **Step 3: Implement.** Add the fixed ranges to `_UPCLOUD_EXCLUDED_RANGES`, keeping the existing message style and naming the range that overlaps. Add a struct-level check for the zone utility range. Unknown zones skip that check. The label value regex becomes `^([A-Za-z0-9]([A-Za-z0-9_-]{0,61}[A-Za-z0-9])?)?$`.
- [ ] **Step 4: Run** `bun run schema:generate`, then run the tests and confirm they PASS. **Step 5: Commit** `fix(upcloud-uks): validate reserved CIDRs, cluster name and version format` (include `kumulo.schema.json`).

### Task 9: Network and router ownership labels, zone scoping, teardown retries (M9, M11 network part)

**Files:**
- Modify: `packages/upcloud/client/src/client/network.ts`
- Modify: `packages/upcloud/distro-uks/src/distro/network.ts`
- Modify: `packages/upcloud/distro-uks/src/distro/delete.ts`
- Modify: `packages/cli/src/upcloud/plan.ts` (`networkExists`)
- Test: `packages/upcloud/client/test/client/network.test.ts`
- Test: `packages/upcloud/distro-uks/test/distro/lifecycle.test.ts`
- Test: `packages/cli/test/upcloud/delete-order.test.ts`

**Interfaces:**
- Produces:
  - **Network client:**
    - `NetworkClient.list(filter?: { zone?: string; labels?: ReadonlyArray<UpcloudLabel> })` sends `GET /1.3/network/?zone=…&label=k%3Dv`.
    - `NetworkClient.modify(uuid, body: { labels: ReadonlyArray<UpcloudLabel> })` sends `PUT /1.3/network/{uuid}` with `{"network":{…}}`.
    - `NetworkCreateInput.labels?`.
  - **Router client:**
    - `RouterClient.list(filter?: { labels?: … })`.
    - `RouterClient.modify(uuid, body: { name: string; labels: … })` sends `PATCH /1.3/router/{uuid}` with `{"router":{…}}`. The docs require `name` here.
    - The router create body accepts `labels`.
  - **Labels:** `uksNetworkLabels(clusterName)` = `[{key:"kumulo-cluster", value: clusterName}]`, exported from `distro-uks/src/distro/network.ts`.
  - **Lookup:** `findOwnedNetwork({ clients, clusterName, zone })` lists by zone and label. If nothing matches, it falls back to the legacy lookup: a network named `<cluster>-network` with no labels in that zone. It adopts that network by calling `modify` to add the labels. Routers work the same way, but without a zone.
- **Response schema:** `IpNetwork` keeps `dhcp` and `family` as `String` (L5). The create input uses a separate `IpNetworkInput` with literal types.

- [ ] **Step 1: Write failing tests:**
  - **Client:** `list({ zone: "de-fra1", labels: [{key:"kumulo-cluster", value:"c1"}] })` requests the URL with `?zone=de-fra1&label=kumulo-cluster%3Dc1`.
  - **Client:** a list containing a network with `family: "IPv7"` still decodes.
  - **Legacy adopt** (Review Focus 1): the fake holds an unlabelled `c1-network` in `de-fra1` and an unlabelled `c1-router`. After `ensureNetwork`, the fake still has exactly 1 network and 1 router, and both now carry `kumulo-cluster=c1`.
  - **Zone scoping:** a labelled `c1-network` in `fi-hel1` is not adopted for zone `de-fra1`. A new one is created.
  - **Delete keeps unowned resources:** `deleteNetwork` doesn't touch a network named `c1-network` that has a different `kumulo-cluster` label.
  - **Delete retries:** the fake returns 409 `NETWORK_NOT_EMPTY` twice, then 204. `deleteAll` succeeds and the router is deleted after the network.
- [ ] **Step 2: Run** the tests and confirm they FAIL.
- [ ] **Step 3: Implement.**
  - Create the network and router with labels.
  - The network and router deletes retry `ResourceConflict` on `Schedule.spaced("10 seconds")`, giving up after 5 minutes, and then surface the last conflict.
  - The CLI plan's `networkExists` uses `findOwnedNetwork`, in read-only mode (no adopt during plan).
- [ ] **Step 4: Run** the tests and confirm they PASS. **Step 5: Commit** `fix(upcloud-uks): own networks and routers by label and zone, retry teardown conflicts`.

### Task 10: Block storage and volumes (M10, L1, L2, L3, L5 storage)

**Files:**
- Modify: `packages/upcloud/client/src/client/storage.ts`
- Modify: `packages/upcloud/volumes/src/provider.ts`
- Test: `packages/upcloud/client/test/client/storage.test.ts`
- Test: `packages/upcloud/volumes/test/provider.test.ts`
- Fake: `packages/upcloud/volumes/test/fake-storage-server.ts`

**Interfaces:**
- Produces:
  - `StorageClient.list(filter?: { labels?: ReadonlyArray<UpcloudLabel> })` sends `GET /1.3/storage/normal?label=…`. The `normal` type excludes backups, templates and cdroms.
  - `StorageCreateInput.size: number` is serialised as a string. `StorageCreateInput.encrypted?: "yes" | "no"`.
  - `Storage.state` is decoded as `String`. `StorageState` stays exported.

- [ ] **Step 1: Write failing tests:**
  - **Create body:** `create({ size: 10, … })` sends `"size":"10"`.
  - **List URL:** `list({ labels: [{key:"kumulo-cluster", value:"c1"}] })` requests `/1.3/storage/normal?label=kumulo-cluster%3Dc1`.
  - **Zone filter** (Review Focus 3): the fake has a correctly labelled disk in `fi-hel1`. `ensureVolume` with zone `de-fra1` creates a new disk instead of returning it.
  - **Cluster volumes:** `listClusterVolumes` excludes a labelled disk from another zone.
  - **Delete while busy:** the fake returns 409 while the disk is in `backuping`, and the disk becomes `online` after 2 polls. `deleteVolume` waits, retries once, and succeeds.
  - **Delete while attached:** for an attached, online disk, `deleteVolume` still fails with `ResourceConflict` (existing test).
- [ ] **Step 2: Run** the tests and confirm they FAIL.
- [ ] **Step 3: Implement.**
  - `_findByLabel` and `listClusterVolumes` call `list({ labels })` and filter on `zone === options.zone`. `listClusterVolumes` gains a `zone` parameter; thread it from `VolumeProviderLive` options.
  - `deleteVolume`: on `ResourceConflict`, `get` the disk. If `state !== "online"`, run `_awaitOnline` and retry the delete once. Otherwise surface the conflict.
- [ ] **Step 4: Run** the tests and confirm they PASS. **Step 5: Commit** `fix(upcloud-volumes): scope storage lookups to normal disks in the cluster zone`.

### Task 11: Object storage client (M3, M7, M8, L13 schema, H3 client side)

**Files:**
- Modify: `packages/upcloud/client/src/client/object-storage.ts`
- Modify: `packages/cli/src/doctor/upcloud/storage.ts:30-34`
- Test: `packages/upcloud/client/test/client/object-storage.test.ts`
- Fake: `packages/upcloud/client/test/client/fake-object-storage-server.ts`
- Fake: `packages/upcloud/storage/test/provider/fake-object-storage-server.ts`

**Interfaces:**
- Produces:
  - **Pagination:** `services.list()` and `buckets.list(serviceUuid)` page through with `?limit=100&offset=n` until a page returns fewer than 100 items. Their signatures don't change.
  - **Schema changes:**
    - `BucketMetrics.deleted: optionalKey(Boolean)`; callers treat a missing value as `false`.
    - `ObjectStorageRegion.zones: optionalKey(Array(Struct({ name: String })))`.
    - `ObjectStorageEndpoint.mode: optionalKey(String)`.
  - **User policies:**
    - `users.policies.list(serviceUuid, username)` sends `GET …/users/{u}/policies` and returns `Array<{ name: string; arn?: string }>`.
    - `users.policies.attach(serviceUuid, username, name)` sends `POST …/users/{u}/policies` with `{name}` and expects 200.

- [ ] **Step 1: Write failing tests:**
  - **Service pagination** (Review Focus 3): the fake holds 150 services. `services.list()` returns 150, and the fake saw requests at `offset=0` and `offset=100`.
  - **Bucket pagination:** the same for 101 buckets.
  - **Optional `deleted`:** a bucket response without `deleted` decodes.
  - **Region zones:** a regions response with `"zones":[{"name":"fi-hel1"}]` decodes.
  - **Attach:** `policies.attach(s, "u", "ECSS3FullAccess")` sends body `{"name":"ECSS3FullAccess"}`.
  - **Doctor:** the region check passes against the new zone shape.
- [ ] **Step 2: Run** the tests and confirm they FAIL. **Step 3: Implement**, and update the doctor to read `zones.map((z) => z.name)`.
- [ ] **Step 4: Run** the tests and confirm they PASS. **Step 5: Commit** `fix(upcloud): paginate object-storage lists, fix region and bucket schemas, add user policies`.

### Task 12: Object storage provider: policy, single service ensure, states, credentials refresh (H3, M4, L13, L14, L15, L16)

**Files:**
- Modify: `packages/upcloud/storage/src/provider/object-storage-provider.ts`
- Modify: `packages/cli/src/upcloud/storage.ts:72-92`
- Test: `packages/upcloud/storage/test/provider/object-storage-provider.test.ts`
- Test: a new `packages/cli/test/upcloud/object-storage-reconcile.test.ts`, using `packages/cli/test/cdn-fakes.ts` or the existing storage fakes as the pattern

**Interfaces:**
- Consumes: `users.policies.*` from Task 11.
- Produces:
  - `KUMULO_S3_POLICY = "ECSS3FullAccess"`. The service is per cluster, so full access is scoped to that cluster's buckets.
  - `ensureUserAccess(options)(clusterName): Effect<void, ObjectStorageError>`, exported. It ensures the user exists and the policy is attached, and it's idempotent.
  - `ensureService(options): Effect<ObjectStorageService, ObjectStorageError>`, now exported.
  - `ensureBucket` gains an optional `service?: ObjectStorageService` argument to skip the lookup.

- [ ] **Step 1: Write failing tests:**
  - **Policy attached:** after `ensureCredentials`, the fake user has policy `ECSS3FullAccess`. A second call doesn't POST it again.
  - **Re-run with creds file** (Review Focus 4): the creds file exists and the policy is missing. `reconcileUpcloudObjectStorage` attaches the policy, does not rotate the key, and rewrites the bucket entries in sops so that a newly added bucket appears.
  - **One service create:** a first apply with 3 buckets makes exactly one `POST /object-storage-2`.
  - **Endpoint mode:** with endpoints `[{type:"public", mode:"static-website"}, {type:"public", mode:"api"}]`, the bucket endpoint is the `api` domain.
  - **Stopped service:** the existing service has `configured_status: "stopped"`. The provider PATCHes it to `started` and then polls.
  - **Deleting service:** a service with `operational_state` starting with `delete-` fails at once with a clear `ProviderApiError`.
  - **Bucket still deleting:** a bucket named `b` exists with `deleted: true`, and the fake keeps it for 2 polls. `ensureBucket` waits until it is gone, then creates it.
- [ ] **Step 2: Run** the tests and confirm they FAIL.
- [ ] **Step 3: Implement.**
  - `reconcileUpcloudObjectStorage` calls `ensureService` once and passes it to every `ensureBucket`, still with `concurrency: 4`.
  - It then always calls `ensureUserAccess`.
  - It rotates the key and writes the secret only when the creds file is missing. It always rewrites the non-secret bucket and endpoint entries; use the sink's existing merge, or re-encrypt with the current secret if the sink cannot merge. Read `sops/credentials` before choosing, and keep the existing secret.
- [ ] **Step 4: Run** the tests and confirm they PASS. **Step 5: Commit** `fix(upcloud-storage): attach S3 policy, ensure the service once, handle stopped and deleting states`.

### Task 13: Object storage teardown guard (M5, M6 mitigation)

**Files:**
- Modify: `packages/cli/src/upcloud/storage.ts:103-135`
- Modify: `packages/upcloud/storage/src/provider/object-storage-provider.ts` (`deleteBucket`)
- Test: `packages/cli/test/upcloud/object-storage-reconcile.test.ts` (from Task 12)

**Interfaces:**
- Produces: `UnmanagedBucketsPresent`, a new `Data.TaggedError` in the CLI module with fields `{ service: string; buckets: ReadonlyArray<string> }`. It is part of the teardown error union.

- [ ] **Step 1: Write failing tests:**
  - **Unconfigured bucket:** the service holds the configured bucket `a` (`retain: false`) and the unconfigured bucket `manual`. Teardown deletes `a` and fails with `UnmanagedBucketsPresent({ buckets: ["manual"] })`, and the service is not deleted.
  - **Configured buckets only:** teardown deletes the service without `force`. The fake requires the user to be deleted first, so teardown deletes `<cluster>-kumulo` before the service.
  - **Fresh metrics:** `deleteBucket` re-reads the bucket metrics directly before the DELETE. It refuses when `total_objects > 0` and drops the dead `ResourceConflict` mapping.
- [ ] **Step 2: Run** the tests and confirm they FAIL.
- [ ] **Step 3: Implement.** The service delete order is:
  1. list all buckets (paginated, including unconfigured ones);
  2. refuse if any non-deleted bucket is unconfigured;
  3. delete the user;
  4. `services.delete(uuid)` without `force`;
  5. poll until the service is gone.

  Bucket deletion is asynchronous (`cleanup-deleted-buckets`), so retry the non-force delete on `ResourceConflict` with `Schedule.spaced("10 seconds")`, up to 10 minutes. Add a test where the fake returns 409 twice while deleted buckets are being cleaned up, then 204. If it still returns 409 after that, surface the error rather than escalating to `force`.
- [ ] **Step 4: Run** the tests and confirm they PASS. **Step 5: Commit** `fix(upcloud-storage): never force-delete an object storage service with unmanaged buckets`.

### Task 14: Changelog and findings status

**Files:**
- Modify: `CHANGELOG.md` (`[Unreleased]`)
- Modify: `.docs/workflows/upcloud-check/findings.md`

- [ ] **Step 1:** Add `### Changed` and `### Fixed` entries for the user-visible changes:
  - `control_plane_ip_filter` is unmanaged when omitted, and `[]` is rejected.
  - The taint syntax is `key[=value][:Effect]`.
  - Pool labels are applied to *new* node groups. Existing groups need a replace to get them.
  - Cluster names must be 3-55 characters (`[a-z0-9-]`), and versions have no `v` prefix.
  - UKS reserved CIDRs are rejected.
  - Object storage users get `ECSS3FullAccess`.
  - Teardown refuses to remove a service that holds unmanaged buckets.
- [ ] **Step 2:** Add a `Status` column to each table in `findings.md`. Mark each row with the fixing task, or `deferred` for M6 and L12.
- [ ] **Step 3:** Run `bun run ci` from the root and confirm it PASSES. Compare the `vitest` test count with the baseline (1734) plus the new tests.
- [ ] **Step 4: Commit** `docs(upcloud): changelog and findings status for the UpCloud fixes`.
