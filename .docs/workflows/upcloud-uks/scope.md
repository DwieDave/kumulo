# Scope: UpCloud Managed Kubernetes (UKS)

Status: DRAFT — pending human approval.

## Decisions taken (Phase 1)

- **D1 — Hand-written client, no codegen.** No official OpenAPI exists
  (intent.md). `@kumulo/upcloud` is hand-written Effect `HttpClient` +
  `Schema` decoders. It is exempt from `codegen:check`'s regen-noop gate; the
  exemption is recorded in the package README so nobody "fixes" it later.
- **D2 — Two packages.** `@kumulo/upcloud` (published client: transport,
  Bearer auth, UKS + network/router calls, error mapping to core's tagged
  errors) and `@kumulo/distro-upcloud-uks` (reconcile logic, depends on it).
  Client lives in a package, not `tools/` — `tools/*` are build-time-only
  devDependencies that never ship to npm.
- **D3 — First cut = cluster + node groups + SDN network/router.** `network`
  and `network_cidr` are mandatory at cluster creation, so kumulo owns the
  network the way `distro-ovh-mks` owns the vRack/Neutron side.
- **D4 — DNS.** `dns.module` for an UpCloud cluster is `none | ovh | hetzner`.
  UpCloud has no DNS product; a user's zone may live elsewhere.
- **D5 — Auth rule generalised.** `isAuthMethodConsistentWithProvider` becomes
  a `Record<Provider, ReadonlyArray<AuthMethod>>` check: `hetzner` and
  `upcloud` → `["api_token"]`, `ovh`/`generic` → the OpenStack-style methods.
- **D6 — Distro kind `"upcloud-uks"`**, matching UpCloud's own product name.

## In scope

### `@kumulo/upcloud` (new package)

- Bearer-token transport (`UPCLOUD_API_TOKEN`), base `https://api.upcloud.com`,
  retry/rate-limit handling via core's `isRetryable`.
- UKS: list/get/create/patch/delete cluster, `available-upgrades`, `upgrade`,
  `kubeconfig`, `plans`; node groups list/get/create/patch/delete + single-node
  delete.
- Networking: `GET/POST/DELETE /1.3/network`, `GET/POST/DELETE /1.3/router`.
- Schema decoders for cluster, node group, plan, states; HTTP status → core
  tagged error mapping (`AuthenticationFailed`, `ResourceNotFound`,
  `ResourceConflict`, `QuotaExceeded`, `RateLimited`, `ProviderApiError`).

### `@kumulo/distro-upcloud-uks` (new package)

- `ManagedDistroShape`: `ensureCluster`, `ensureNodePools`, `fetchKubeconfig`,
  `upgrade`, `delete`.
- Node-group diff (create / scale / replace-on-immutable-field) and a pool hash
  in the same shape as `distro-ovh-mks`'s `mksPoolHash` / `diffNodePools`.
- Cluster drift detection for creation-time-only fields (network, zone,
  `private_node_groups`) — refused at plan time, never silently applied.
- Network/router ensure + delete, ordered so the cluster is gone before the
  network is.
- A fake UKS server for tests, mirroring `test/distro/fake-mks-server.ts`.

### Core / CLI changes

- `Provider` += `"upcloud"`; `DistroKind` += `"upcloud-uks"`;
  `UpcloudUksClusterConfig` variant in the `ClusterConfig` union (zone, plan,
  `network` block with CIDR + prefix/exclusion validation, optional
  `control_plane_ip_filter`, `worker_pools`, `volumes: none`, `dns` per D4).
- `distroCapabilities["upcloud-uks"] = { autoscaling: false, selectableCni: false }`.
- D5's auth-rule generalisation.
- `packages/cli`: `upcloud-uks` distro entry, env wiring, plan/apply/delete/
  status/upgrade, doctor checks (token valid, zone exists, plan exists,
  version supported), env summary.
- Regenerated `kumulo.schema.json`, an `examples/upcloud-uks.yaml` and its plan
  snapshot.

## Out of scope (this feature)

- k3s on UpCloud (a full `CloudProvider`).
- `object_storage.module: "upcloud"`.
- Private node groups + `/1.3/gateway` NAT egress.
- UpCloud Load Balancer ingress block (the `ovh-mks` `ingress:` analogue).
- Deploying/managing cluster-autoscaler, or any `autoscaling:` support.
- Custom / cloud-native / GPU node-group plan variants (`plan` string only).
- Basic-auth credentials.
- Multi-zone clusters.

## Open questions for Phase 2

- **Q1** — Control plane `plan`: expose (`dev-md`, `prod-*`) or pin `dev-md`
  until someone asks?
- **Q2** — `storage_encryption: "data-at-rest"`: default on, or opt-in field?
- **Q3** — Do we adopt a pre-existing network by name if one matches, or always
  create-and-own (tag-based ownership like the OVH path)?
- **Q4** — Node-group changes: which fields does UpCloud actually accept in
  `PATCH` (count only?) versus requiring delete+recreate? Needs a live probe
  before the diff logic is fixed — docs are not explicit.
- **Q5** — Upgrade `strategy`: expose `manual` vs `rolling-update`, or always
  `rolling-update`?
- **Q6** — Live-test account/zone and budget for the smoke tests, mirroring the
  OVH `staging-eu` setup.
