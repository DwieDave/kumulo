# Requirements: UpCloud Managed Kubernetes (UKS)

Status: DRAFT — pending human approval.

Companion to `intent.md` (why) and `scope.md` (what is in). This file is the
contract Phase 3's tasks link back to.

## Design decisions

Phase 1 decisions D1–D6 live in `scope.md` and are not repeated here.

- **D7 — Version vocabulary.** UKS is minor-only: the cluster carries
  `version: "1.31"` and `available-upgrades` returns `{"versions":["1.31"]}`.
  A third schema literal `UksVersion` (`^v?\d+\.\d+$`) joins `K3sVersion` and
  `PlainK8sVersion`. Drift is string equality; no truncation, no patch
  component that never leaves the config file.
- **D8 — Node group drift.** `PATCH node-groups/{name}` accepts `count` and
  nothing else. Everything else (`plan`, `labels`, `taints`, `ssh_keys`,
  `storage`, `anti_affinity`, `utility_network_access`) is creation-time. The
  `distro-ovh-mks` shape carries over verbatim: `uksPoolHash` over the
  immutable fields, `diffNodePools` → `toCreate | toUpdate | toReplace |
  toDelete`, and unconfirmed immutable drift is left strictly alone.
- **D9 — Replace order: create-then-delete.** Consequence: node group names
  are unique per cluster and cannot be renamed, so the live name is
  `<pool>-<hash8>` (the pool's own immutable-field hash) and the diff keys on
  the `kumulo-pool` label, not the API name. Two generations of a pool coexist
  for the length of the replace, and the operator is billed for both.
- **D10 — kumulo owns the network.** A `network:` block with a CIDR; kumulo
  creates the SDN network and its router, labelled with cluster ownership, and
  tears them down *after* the cluster on delete. No adoption of pre-existing
  networks in this cut.
- **D11 — Creation-time fields exposed.** `plan` (control plane tier,
  default `dev-md`), `control_plane_ip_filter`, `storage_encryption`, and
  `upgrade_strategy` (`manual | rolling-update`) all get config surface.
  `upgrade_strategy` is deliberately *not* named `strategy`: the CLI verb
  already has one (D12).
- **D12 — `LATEST_PATCH` is a no-op.** The CLI's
  `strategy: "LATEST_PATCH" | "NEXT_MINOR"` stays distro-agnostic. Under
  `upcloud-uks`, `LATEST_PATCH` always reports "already current" because the
  API exposes no patch granularity; `NEXT_MINOR` takes the first entry of
  `available-upgrades`.
- **D13 — Testing.** A `fake-uks-server.ts` drives all CI, mirroring
  `distro-ovh-mks`'s. A live smoke test exists but skips unless
  `UPCLOUD_API_TOKEN` is set.
- **D14 — Ownership stamping.** UKS labels are `[{key, value}]` with keys
  2–32 printable ASCII (no leading `_`) and values 0–63 of
  `[A-Za-z0-9-_]`. Core's `configHash` is 16 lowercase hex chars and
  `CONFIG_HASH_KEY` is `kumulo-config-hash` — both fit those rules with room
  to spare, so no encoding layer is needed.

- **D15 — `no-sibling-package-imports` gains one exception.** D2's layering
  (`distro-upcloud-uks` imports `@kumulo/upcloud`) is an error under
  `.dependency-cruiser.cjs`'s sibling rule as written. The rule is relaxed to
  allow that edge rather than folding the client into the distro package.
  The exception is narrow and conditional: `@kumulo/upcloud` must stay a
  **leaf** — it may import `@kumulo/core` and nothing else — so the rule
  treats it like core for *incoming* edges only, and its own outgoing edges
  stay governed by the original rule. Enforced by keeping `upcloud` in the
  rule's `from` pattern.

## Acceptance criteria

- **AC1** — A config with `provider: upcloud`, `distro: upcloud-uks` and one
  worker pool decodes, plans, and applies to a running UKS cluster whose
  kubeconfig answers `kubectl get nodes` with the declared node count.
- **AC2** — Re-running `plan` immediately after a successful `apply` shows no
  actions. (Idempotence — the property every existing distro is held to.)
- **AC3** — `delete` removes the cluster, then the router, then the network,
  and leaves nothing billable behind.
- **AC4** — Changing `worker_pools[].count` plans as an `Update` and applies
  without replacing nodes.
- **AC5** — Changing any immutable pool field plans as
  `ReplaceNeedsConfirm`; applying without `--replace <name>` performs nothing
  for that pool and exits non-zero.
- **AC6** — Changing `network`, `zone`, `plan` or `storage_encryption` on a
  live cluster is refused at plan time with an error naming the field, never
  silently applied.
- **AC7** — `upgrade --strategy NEXT_MINOR` moves the cluster to the first
  version from `available-upgrades`; `--strategy LATEST_PATCH` reports
  "already current" and changes nothing.
- **AC8** — A config with `worker_pools[].autoscaling.enabled` is rejected at
  plan time naming `upcloud-uks` (not k3s — the current message is hardcoded).
- **AC9** — `doctor` reports, individually: token valid, zone exists, control
  plane plan exists, node group plans exist, requested version supported.
- **AC10** — `kumulo.schema.json`, `examples/upcloud-uks.yaml` and the plan
  snapshot are regenerated and committed; `codegen:check` passes with
  `@kumulo/upcloud` excluded by an explicit, documented exemption.

## Functional requirements

### Client — `@kumulo/upcloud`

- **R1** — Bearer auth from `UPCLOUD_API_TOKEN` against
  `https://api.upcloud.com`. Basic auth is not supported.
- **R2** — UKS operations: cluster list/get/create/patch/delete,
  `available-upgrades`, `upgrade`, `kubeconfig`, `plans`; node group
  list/get/create/patch/delete and single-node delete.
- **R3** — Network operations: network list/get/create/delete, router
  list/get/create/delete.
- **R4** — Every response is `Schema`-decoded; a shape mismatch surfaces as
  `ResponseDecodeError`, never as a silent `undefined`.
- **R5** — HTTP status → core tagged error: 401/403 →
  `AuthenticationFailed`, 404 → `ResourceNotFound`, 409 →
  `ResourceConflict`, 402/quota → `QuotaExceeded`, 429 → `RateLimited`,
  other 4xx/5xx → `ProviderApiError`, transport → `HttpTransportError`.
  Retryability flows through core's existing `isRetryable`.
- **R6** — No secret (token, kubeconfig contents) is ever logged or included
  in an error message.

### Distro — `@kumulo/distro-upcloud-uks`

- **R7** — Implements `ManagedDistroShape` in full.
- **R8** — `ensureCluster` finds by name, creates when absent, waits for
  `running` via core's `pollUntil`, and reconciles the two patchable fields
  (`control_plane_ip_filter`, `labels`).
- **R9** — `clusterDrift` detects creation-time-only divergence (D8/AC6) and
  produces a refusal, not a mutation.
- **R10** — `ensureNodePools` applies the D8 diff, with the D9 ordering for
  replaces, and waits for each affected group to reach `running`.
- **R11** — Network and router are ensured before the cluster and deleted
  after it, ownership-stamped per D14.
- **R12** — `fetchKubeconfig` returns the parsed `kubeconfig` YAML from the
  API response.
- **R13** — `upgrade` resolves the target per D12 and posts it with the
  configured `upgrade_strategy`.

### Core and CLI

- **R14** — `Provider` += `"upcloud"`; `DistroKind` += `"upcloud-uks"`; a
  `UpcloudUksClusterConfig` variant joins the `ClusterConfig` union.
- **R15** — The config variant carries: `zone`, `version` (D7), optional
  `plan`, `network` (CIDR, validated to /8–/29 and outside UpCloud's excluded
  ranges 100.64.0.0/10, 127.0.0.0/8, 224.0.0.0/4, 169.254.0.0/16), optional
  `control_plane_ip_filter`, optional `storage_encryption`, optional
  `upgrade_strategy`, `worker_pools`, `volumes: none`, and `dns` per D4.
- **R16** — `isAuthMethodConsistentWithProvider` becomes a per-provider
  allowed-methods map (D5), with `hetzner` and `upcloud` → `["api_token"]`.
- **R17** — `distroCapabilities["upcloud-uks"] = { autoscaling: false,
  selectableCni: false }`, and `validateAutoscaling`'s message names the
  offending distro rather than hardcoding k3s.
- **R18** — A `upcloud-uks` `DistroEntry` in the CLI registry; `onDistro`'s
  branch becomes three-way and stays cast-free.
- **R19** — Doctor checks per AC9.
- **R20** — Node group names honour UpCloud's rules (1–63, lowercase,
  digits, `-`, no leading/trailing `-`) after the D9 suffix is appended —
  so the configured pool name is bounded to 54 characters.

## Non-functional requirements

- **N1** — Functions stay within the repo's 20–30 line ceiling; diff, hash and
  drift logic is pure and total, so it is property-testable without a server.
- **N2** — Property tests over `diffNodePools` (idempotence: applying a diff
  and re-diffing yields empty) and over the CIDR/name validators, per the
  repo's "property tests over unit tests" rule.
- **N3** — No new runtime dependency: `effect` only, as with every other
  package here.
- **N4** — `@kumulo/upcloud` imports no sibling kumulo package except
  `@kumulo/core`, keeping dependency-cruiser's `no-sibling-package-imports`
  satisfied.
- **N5** — Apply is re-entrant: a run interrupted between any two API calls
  can be re-run and converges (AC2 holds from any partial state).
- **N6** — Every wait has a bounded timeout surfacing `ProvisioningTimeout`.

## Open questions

- **Q7** — Does `DELETE /node-groups/{name}` drain pods first? The docs do not
  say. Affects whether D9's create-then-delete needs an explicit drain step
  (core has `drainNode`/`cordonNode` already). Needs a live probe.
- **Q8** — Exact error body shape for 4xx responses, to make R5's mapping
  precise rather than status-code-only. Needs a live probe.
- **Q9** — Which control plane plans exist beyond `dev-md` / `prod-md`?
  `GET /1.3/kubernetes/plans` answers it at runtime; the question is whether
  the config validates against a literal union or against the live list.
- **Q10** — Does deleting a cluster release its network automatically, or does
  the network delete fail while the cluster is still terminating? Determines
  whether R11's teardown needs a poll between the two.
