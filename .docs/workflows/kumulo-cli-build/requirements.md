# Requirements — Kumulo CLI Build

Spec base: `.docs/design/kumulo-design.md`. Deviations from the design doc decided in Phase 2 are marked **[DEVIATION]**.

## Decisions log (Phase 2)

| # | Decision | Choice |
|---|---|---|
| D1 | Track | Both distros (`k3s` + `ovh-mks`) in parallel on shared core |
| D2 | Runtime | Bun workspaces; single binary via `bun build --compile` |
| D3 | Effect | **Effect v4 beta** (pinned npm `effect@4.0.0-beta.x`, `@effect/platform-bun`, `@effect/openapi-generator`). **[DEVIATION]** from doc's v3-era naming (`@effect/cli` → `effect/unstable/cli`, HttpApi → `effect/unstable/httpapi`) |
| D4 | Addon apply | **In-house HTTP apply** (minimal k8s client, server-side apply) — no kubectl dependency. **[DEVIATION]** from doc's kubectl fallback |
| D5 | CNI default | flannel (k3s built-in); cilium opt-in |
| D6 | Tests | vitest + `@effect/vitest`; property tests via fast-check |
| D7 | k3s bootstrap | **SSH-driven install** (hetzner-k3s pattern): minimal cloud-init, k3s installed over SSH on every node; token quorum-read from masters with secure-random fallback; joins target master-1 IP (private preferred), LB is client-facing only. **[DEVIATION]** from doc §6.5 cloud-init-join goal |
| D8 | Anti-affinity | v1 includes Nova server groups (`soft-anti-affinity`) per masters-set and per pool; MKS uses native `antiAffinity` |
| D9 | OpenStack specs | Vendored from archived `gtema/openstack-openapi` `/specs` snapshot; treated beta-quality → lenient response validation default, patches carry corrections |
| D10 | Live testing | All milestones offline-verifiable (fakes/fixtures); live smoke tests only at the end when credentials arrive |

## Functional requirements

### FR-1 Config & validation
- FR-1.1 Single YAML config per §5 schema, validated by effect/Schema with pathed errors (`ConfigInvalid`).
- FR-1.2 `provider: ovh | generic`, `distro: k3s | ovh-mks` enums from day one.
- FR-1.3 `autoscaling` block accepted by schema; runtime-rejected for `k3s` ("not yet implemented"), functional for `ovh-mks` (native min/max per pool).
- FR-1.4 Profile validation rejects unsupported combos early (e.g. Octavia-less region + `high_availability: true` without fallback, cilium under ovh-mks).

### FR-2 Reconciliation core (§6)
- FR-2.1 Stateless, tag-based: all resources named `kumulo-<cluster>-<role>-<pool>-<index>` and tagged `kumulo.cluster/role/pool/config-hash`.
- FR-2.2 `create` = apply: inventory → typed Plan (create/delete/no-op/replace-with-confirm) → present (terraform-plan-style, `--yes` skips) → apply in dependency order with bounded concurrency.
- FR-2.3 Phase pipeline branches once on distro kind: self-managed = Network → Security → ServerGroups → LB → Nodes → Bootstrap → Addons → DNS → Volumes → Kubeconfig; managed = EnsureCluster → EnsureNodePools → Addons(subset) → DNS → Volumes → Kubeconfig.
- FR-2.4 Re-running any interrupted operation converges (all steps idempotent ensure*, discovery by tag).
- FR-2.5 Async OpenStack/OVH statuses polled via Schedule with timeouts (`ProvisioningTimeout` carries lastStatus).
- FR-2.6 `delete`: inventory by tag → reverse dependency order; skips `retain: true` volumes and prints what it kept; removes owned DNS records.
- FR-2.7 `scale`: pool count change routes through the same reconcile; scale-down drains via Distro port before instance deletion.

### FR-3 Ports (§3) — exact interfaces per design doc
- FR-3.1 `CloudProvider`, `ProviderProfile`, `Distro` (self-managed | managed union), `Addon`, `DnsProvider`, `VolumeProvider` live in core; core depends only on `effect`.
- FR-3.2 Module selection (`provider`, `distro`, `dns.module`, `volumes.module`) is explicit Layer wiring in cli main — no runtime discovery.

### FR-4 Generated clients (§4)
- FR-4.1 OpenStack pipeline: vendored specs → operationId allowlist filter (§4.3) → RFC 6902 patches (never edit vendored specs; stale patches fail CI) → `@effect/openapi-generator` → committed output. Nothing outside `@kumulo/openstack` imports generated code.
- FR-4.2 Nova microversion pinned, sent explicitly on every request.
- FR-4.3 OVH pipeline adds stage 0: in-repo deterministic `tools/ovh2openapi` converter (byte-stable output, `ConversionUnsupported` on unknown constructs, TDD against vendored fixtures from `eu.api.ovh.com/1.0/{cloud,domain}.json`).
- FR-4.4 `specs:update` scripts re-fetch upstream, re-apply, regenerate — drift surfaces as clean diff or hard CI failure.
- FR-4.5 Auth Layers: `KeystoneAuthLive` (application credentials + clouds.yaml + OS_* env; token cache with expiry skew; re-auth on 401) and `OvhAuthLive` (OAuth2 client-credentials against `https://www.ovh.com/auth/oauth2/token`, Bearer on v1 routes; no legacy AK/AS/CK).
- FR-4.6 Transport: retry Schedule (exp backoff + jitter; retryability decided per error tag, not status code at call site), rate limiting via Semaphore, lenient response decode by default (log extra/unknown fields, don't fail).

### FR-5 distro-k3s (self-managed)
- FR-5.1 Minimal cloud-init (hostname, packages, SSH hardening); k3s installed over SSH per D7. Bounded-concurrency node setup queue.
- FR-5.2 Token: quorum-read from existing masters' `/var/lib/rancher/k3s/server/node-token`, else secure-random; first-master identity stable across reruns (oldest token-file wins).
- FR-5.3 HA: embedded etcd, master 1 `--cluster-init`, others `--server https://<master1>:6443`; joins never via LB; TLS SANs include all master IPs, 127.0.0.1, LB VIP, DNS api record.
- FR-5.4 Readiness gates copied from hetzner-k3s: wait cloud-init boot-finished (300s), SSH-ready poll, control-plane `cluster-info` poll with retries.
- FR-5.5 Kubeconfig fetched via SSH from master 1, server rewritten to LB VIP / master IP / DNS name, contexts named by cluster, chmod 600.
- FR-5.6 `upgrade` renders SUC Plans (masters concurrency 1 + cordon; workers configurable concurrency, waits on server plan). `releases` lists/validates k3s versions (cached, TTL).
- FR-5.7 Security groups: SSH (allowed_cidrs), 6443 (api allowed_cidrs), intra-cluster all-proto within network CIDR, etcd 2379-2380 master-to-master, flannel wireguard 51820 / cilium 51871 when applicable, ICMP.

### FR-6 distro-ovh-mks (managed)
- FR-6.1 ensureCluster (create/update, region, version, private network attachment options), ensureNodePools mapped 1:1 from worker_pools incl. `autoscale/minNodes/maxNodes/desiredNodes/antiAffinity/monthlyBilled`.
- FR-6.2 Kubeconfig via OVH API; upgrades OVH-driven; delete via API.
- FR-6.3 OVH-managed addons (OCCM, cinder-csi, CNI) skipped; cilium selection rejected at validation.

### FR-7 DNS (§3.5)
- FR-7.1 `DnsProvider` port; `@kumulo/dns-ovh` (v1) + built-in `none`.
- FR-7.2 Records from config resolve `target: api_server | ingress` to actual endpoints post-provisioning; TXT ownership record `kumulo.cluster=<name>` guards every mutation (port contract).
- FR-7.3 Zone refresh after changes; `delete` removes only owned records.

### FR-8 Volumes (§3.6)
- FR-8.1 `VolumeProvider` port; `@kumulo/volumes-cinder` (v1) + `none`. ensure-by-tag+name before addon phase.
- FR-8.2 Stable volume IDs written to `<cluster>.outputs.yaml`; static PV+PVC manifests generated with `persistentVolumeReclaimPolicy: Retain` and pinned `csi.volumeHandle` (works under both distros).
- FR-8.3 `kumulo volumes list` / `volumes adopt` re-bind existing volume IDs into a new cluster's generated PVs.

### FR-9 Addons (§3.4) & k8s client
- FR-9.1 Addons: `openstack-ccm`, `cinder-csi`, `system-upgrade-controller`, `cilium` — toggleable, capability-gated; OCCM/CSI receive generated minimal-scope `cloud.conf` Secret.
- FR-9.2 Minimal in-house k8s client (D4): kubeconfig auth (token/client-cert), server-side apply (`PATCH application/apply-patch+yaml`, field manager `kumulo`), get/list for readiness waits, node drain/cordon/delete for scale-down. No third-party k8s SDK.

### FR-10 CLI (§7)
- FR-10.1 Commands: `create`, `delete`, `scale`, `status`, `kubeconfig`, `upgrade`, `releases`, `doctor`; global `--config`, `--yes`, `--dry-run` where applicable.
- FR-10.2 `doctor`: auth check (Keystone and/or OVH per config), region capabilities (Octavia), quota headroom vs plan, image/flavor resolution, microversion acceptance.
- FR-10.3 Error rendering: one exhaustive catchTags at the boundary; every tag → human message + distinct exit code; defects → bug-report prompt.

## Non-functional requirements

- NFR-1 Hexagonal dependencies enforced in CI (dependency-cruiser or equivalent import-lint): all arrows into core; core imports only `effect`.
- NFR-2 TDD for core/distro logic against fake Layers; fixture-replay tests for generated clients; converter developed TDD against vendored OVH fixtures. Property tests where meaningful (config schema round-trips, plan diffing, converter determinism).
- NFR-3 Everything runs and tests offline (D10). No network at build or test time; spec updates are explicit scripts.
- NFR-4 Functions small (20-30 lines max), declarative Effect style, tagged errors only — no thrown exceptions past adapters.
- NFR-5 Reproducible codegen: regenerating from unchanged inputs is a no-op diff.
- NFR-6 Ctrl-C safe: structured concurrency interruption never orphans untagged resources.
- NFR-7 Single-file binary artifact builds via `bun build --compile`.

## Acceptance criteria (v1 done =)

- AC-1 `kumulo create --config examples/k3s.yaml --dry-run` prints a correct plan against a fake CloudProvider inventory (unit-tested for empty, partial, complete, and drifted inventories).
- AC-2 Full create/delete/scale/upgrade lifecycle for `distro: k3s` passes an end-to-end test against fake Layers (SSH + cloud fakes), covering HA 3-master + 2 pools + DNS + retained volume + addons.
- AC-3 Same lifecycle for `distro: ovh-mks` against fixture-replayed OVH API (create, nodepool autoscaling update, kubeconfig, delete).
- AC-4 `doctor` produces actionable failures for: bad credentials, missing Octavia, insufficient quota, unresolvable image/flavor.
- AC-5 Codegen pipelines regenerate byte-identically in CI; a synthetic upstream change breaks CI loudly.
- AC-6 Every error tag has a renderer (compile-enforced) and at least one test asserting its message.
- AC-7 `delete` retains `retain: true` volumes and their records in outputs; `volumes adopt` binds them into a fresh cluster config's PVs.
- AC-8 Final (credential-gated): live smoke test — `doctor`, then create→kubeconfig→delete for both distros on the real OVH project.
