# Plan — Kumulo CLI Build

Status: **Phase 3 draft — milestones for approval** (detailed tasks follow after milestone sign-off).

**Execution model:** implementation work (Phase 4 task execution) is delegated to **Sonnet 5 subagents** (`model: sonnet`), one per task, each following the Phase 4 TDD loop (failing test → code → green → commit). The main session orchestrates: prepares task briefs with full context (requirement links, file paths, conventions), reviews subagent output, and gates commits.

Sequencing rationale: shared foundations first; then the OVH-MKS vertical slice (smallest surface that proves config → reconcile → running cluster end to end, per design §3.3.1's own sequencing note); then the k3s/OpenStack slice on the proven core; extensions and addons after both distros exist; polish and credential-gated smoke last. Every milestone ends green offline (NFR-3) and is committed per Phase 4 discipline.

## M0 — Workspace foundations
Bun workspaces monorepo (9 packages + tools/ovh2openapi), TypeScript strict, vitest + @effect/vitest wiring, pinned Effect v4 beta deps, import-direction lint (arrows into core), CI script (typecheck, test, dep-lint). Empty-but-compiling packages.
→ NFR-1, NFR-2, D2, D3, D6

## M1 — Core domain: config schema + ports + error taxonomy
Full effect/Schema config (§5) with pathed errors; all six port interfaces incl. Distro discriminated union; complete tagged-error taxonomy; property tests (schema round-trip, autoscaling accept/reject rules).
→ FR-1, FR-3, FR-10.3 (tags), AC-6 (renderer registry shape)

## M2 — Reconciler engine (distro-agnostic, fake-driven)
Inventory/Plan/diff types, plan presentation, phase pipeline with managed/self-managed branch, bounded-concurrency apply, polling Schedules, interruption safety. Entirely TDD against a fake CloudProvider Layer (AC-1 lands here).
→ FR-2, NFR-4, NFR-6

## M3 — Codegen pipeline A: ovh2openapi + OVH clients + auth
Vendor OVH `cloud.json`/`domain.json` fixtures; deterministic converter (TDD, ConversionUnsupported on unknowns); filter/patch/generate stages shared as reusable scripts; generated MKS + DNS-zone clients; `OvhAuthLive` (OAuth2 client-credentials, refresh Schedule); fixture-replay client tests.
→ FR-4.3–4.6 (OVH half), NFR-5, AC-5 (OVH half)

## M4 — distro-ovh-mks vertical slice
ensureCluster/ensureNodePools (incl. native autoscaling mapping), kubeconfig via API, delete, upgrade; wired through the M2 reconciler; `create`/`delete`/`scale`/`kubeconfig` CLI commands minimally usable for MKS; `doctor` (OVH auth + capability checks). First end-to-end lifecycle green against fixtures (AC-3).
→ FR-6, FR-10 (subset), AC-3, AC-4 (OVH parts)

## M5 — Codegen pipeline B: OpenStack clients + Keystone auth
Vendor frozen OpenStack specs (D9); allowlists per §4.3; patches; generated Keystone/Nova/Neutron/Glance/Cinder/Octavia clients; `KeystoneAuthLive` (app-creds, clouds.yaml, OS_* env, token cache/re-auth); transport retry/rate-limit layer; microversion pin; fixture-replay tests.
→ FR-4.1–4.2, FR-4.5–4.6 (Keystone half), AC-5 (OpenStack half)

## M6 — CloudProvider on OpenStack + provider profiles
CloudProvider implementation (network/SG/server-group/LB/server ensure*, tag inventory, deleteByTag, image/flavor resolution); `provider-ovh` profile (Ext-Net, aliases, Octavia per-region, volume types) + `generic` profile; `doctor` OpenStack checks (quota, image/flavor, microversion). SG rules per FR-5.7; soft-anti-affinity server groups (D8).
→ FR-3 (CloudProvider impl), FR-5.7, D8, AC-4 (OpenStack parts)

## M7 — distro-k3s vertical slice
SSH layer + readiness gates; minimal cloud-init; SSH-driven k3s install (D7): token quorum, first-master stability, cluster-init/join, TLS SANs; kubeconfig fetch/rewrite; scale-down drain; `releases` command with cache. Full k3s lifecycle green against fake SSH/cloud Layers (AC-2 core).
→ FR-5, FR-2.7, AC-2

## M8 — k8s client + addons
Minimal in-house k8s client (SSA apply, get/list waits, cordon/drain/delete node); addon registry + OCCM, cinder-csi (cloud.conf secret generation), SUC, cilium option; MKS addon-subset skipping; `upgrade` via SUC plans.
→ FR-9, FR-5.6, FR-6.3, D4, D5

## M9 — Extensions: DNS + retained volumes
`dns-ovh` with TXT ownership contract + `none`; record targets api_server/ingress; `volumes-cinder`: ensure, outputs file, static PV/PVC generation, `volumes list/adopt`; delete-time retention behavior. Completes AC-2/AC-3 (DNS+volumes legs) and AC-7.
→ FR-7, FR-8, AC-7

## M10 — CLI polish & release readiness
`status`, full error-renderer coverage sweep (AC-6), exit codes, `--dry-run`/`--yes` everywhere applicable, example configs, README/docs, `bun build --compile` binary, packaging checklist.
→ FR-10, NFR-7, AC-1 final form

## M11 — Live smoke tests (credential-gated)
When user supplies OVH service account + OpenStack app credentials: `doctor`, then create→kubeconfig→delete for both distros against the real project; fix fallout; record results.
→ AC-8, D10

## Task breakdown

Each task = one Sonnet 5 subagent run through the Phase 4 loop (detailed sub-plan → failing tests → code → green → memories → commit). `[→ …]` links requirements. Tasks within a milestone are sequential unless marked ∥ (parallelizable, disjoint files).

### M0 — Workspace foundations
- **T0.1** Bun workspaces skeleton: root package.json/workspaces, tsconfig base + per-package, 9 `@kumulo/*` packages + `tools/ovh2openapi` (empty index + placeholder test each), pinned `effect@4.0.0-beta.x`, `@effect/platform-bun`, `@effect/openapi-generator`, vitest + `@effect/vitest` + fast-check config running under Bun. [→ D2, D3, D6]
- **T0.2** Dependency-direction lint (dependency-cruiser or ESLint import rules): only-inward-to-core matrix from Appendix A; `bun run ci` = typecheck + test + dep-lint. [→ NFR-1]

### M1 — Core domain
- **T1.1** Error taxonomy: all `Data.TaggedError` classes (§8.1 transport/cloud/domain layers) + `Retryable` predicate keyed by tag + renderer-registry type that fails compilation on missing tag. [→ FR-10.3, FR-4.6, AC-6]
- **T1.2** Config schema: full §5 shape (provider/distro enums, pools, dns, volumes, addons, k3s passthrough) with pathed `ConfigInvalid` issues; property tests: YAML→Schema→YAML round-trip, cidr/count/flavor validators, autoscaling accepted-by-schema. [→ FR-1.1–1.3]
- **T1.3** Port interfaces: `CloudProvider`, `ProviderProfile`, `Distro` (SelfManaged|Managed union), `Addon`, `DnsProvider`, `VolumeProvider` + domain types (specs, infos, ClusterTag, Inventory, NodeRole…); cross-distro validation rules (autoscaling rejected for k3s at runtime, cilium rejected under ovh-mks). [→ FR-3.1, FR-1.3–1.4]

### M2 — Reconciler engine
- **T2.1** Inventory/Plan domain: typed diff (create/delete/noop/replace-confirm) from desired config vs tagged inventory; property tests incl. drifted/partial inventories. [→ FR-2.1–2.2]
- **T2.2** Phase pipeline: dependency-ordered phases, single managed/self-managed branch, bounded-concurrency apply, polling Schedule helper (`ProvisioningTimeout`), interruption-safety tests; fake `CloudProvider` Layer (in-memory tagged store) as shared test fixture. [→ FR-2.3–2.5, NFR-6]
- **T2.3** Plan presentation (terraform-plan-style renderer) + confirm/`--yes`/`--dry-run` flow as pure core logic. [→ FR-2.2, AC-1]

### M3 — Codegen A: ovh2openapi + OVH clients
- **T3.1** Vendor OVH fixtures: `specs/ovh/cloud.json` + `domain.json` snapshots (+ trimmed fixture excerpts for tests); `specs:update:ovh` fetch script. [→ FR-4.4]
- **T3.2** `tools/ovh2openapi` converter TDD: models→schemas, routes→operations, params, enums, `fullType` formats; stable key ordering; `ConversionUnsupported` on unknown constructs; determinism property test (double-run byte-equal). [→ FR-4.3, NFR-5]
- **T3.3** Shared pipeline scripts: allowlist filter + RFC 6902 patch + `@effect/openapi-generator` invocation + regen-is-noop CI check (service-agnostic, reused by M5). [→ FR-4.1 mechanics, FR-4.4, AC-5]
- **T3.4** Generate MKS + DNS-zone clients (allowlists: kube CRUD, nodepool CRUD, kubeconfig, `/domain/zone/*` records/refresh) + `OvhAuthLive` (client-credentials token, refresh Schedule, Bearer injection) + fixture-replay tests. [→ FR-4.3, FR-4.5–4.6]

### M4 — distro-ovh-mks slice
- **T4.1** `@kumulo/distro-ovh-mks`: ensureCluster/ensureNodePools (pool↔nodepool mapping incl. autoscale/min/max/antiAffinity/monthlyBilled), fetchKubeconfig, upgrade, delete; status polling; fixture-replay lifecycle tests. [→ FR-6.1–6.2]
- **T4.2** CLI skeleton (`effect/unstable/cli`): `create`/`delete`/`scale`/`kubeconfig` wired for MKS via Layer composition in main; error renderers for tags reachable so far; e2e test config→plan→apply against fixtures (AC-3). [→ FR-10.1, FR-3.2, AC-3]
- **T4.3** `doctor` (OVH half): auth validity, project access, region/version capability, plan-vs-quota preview; actionable failure tests. [→ FR-10.2, AC-4]

### M5 — Codegen B: OpenStack clients
- **T5.1** Vendor frozen specs (Keystone/Nova/Neutron/Glance/Cinder/Octavia) + per-service allowlists (§4.3) + initial patches; document microversion pin decision. [→ FR-4.1–4.2, D9]
- **T5.2** Generate six clients through the T3.3 pipeline; regen-noop CI; fixture-replay tests per service (happy + error-mapping cases). [→ FR-4.1, AC-5]
- **T5.3** `KeystoneAuthLive` (app-creds/clouds.yaml/OS_* env; scoped token cache with skew; re-auth on 401; ServiceCatalog lookup) + transport layer (retry-by-tag Schedule, jitter, Semaphore rate limit, lenient decode). [→ FR-4.5–4.6]

### M6 — CloudProvider + profiles
- **T6.1** `CloudProvider` impl: ensureNetwork/SecurityGroups/ServerGroups(soft-anti-affinity)/LoadBalancer(Octavia)/Server, tag-based inventory + deleteByTag, image/flavor resolution with alias→fuzzy fallback; SG rules per FR-5.7; TDD against recorded fixtures. [→ FR-3.1 impl, FR-5.7, D8]
- **T6.2** ∥ `provider-ovh` profile (Ext-Net, image aliases, Octavia per-region flags, volume types, auth defaults) + `generic` profile + profile validation. [→ FR-1.4, §3.2]
- **T6.3** `doctor` OpenStack half: Keystone auth, microversion acceptance, Octavia capability, quota headroom, image/flavor resolution. [→ FR-10.2, AC-4]

### M7 — distro-k3s slice
- **T7.1** SSH layer (Bun ssh or thin ssh2 wrapper behind a port): exec/readFile with retry Schedules; readiness gates (cloud-init boot-finished 300s, ssh-ready, control-plane cluster-info poll). [→ FR-5.4]
- **T7.2** Bootstrap logic: minimal cloud-init render; k3s install script generation (server/agent, cluster-init vs join via master-1, TLS SANs, disable-flags, private-IP advertise); token quorum-read + stable first-master; bounded-concurrency install queue. [→ FR-5.1–5.3, D7]
- **T7.3** Kubeconfig fetch/rewrite (LB/DNS/master server URL, context naming, 0600), `releases` command (cached k3s version list + validateVersion), drainAndRemove for scale-down; full fake-Layer lifecycle e2e (AC-2 core). [→ FR-5.5–5.6, FR-2.7, AC-2]

### M8 — k8s client + addons
- **T8.1** Minimal k8s client: kubeconfig parse (token/client-cert), SSA apply (field manager `kumulo`), get/list + readiness waits, cordon/evict/delete node; recorded-response tests. [→ FR-9.2, D4]
- **T8.2** Addon registry + built-ins: OCCM + cinder-csi (generated minimal-scope cloud.conf Secret), SUC, cilium option; capability gating; MKS subset-skip; flannel-default wiring. [→ FR-9.1, FR-6.3, D5]
- **T8.3** `upgrade` command: SUC plan rendering (masters concurrency 1 + cordon; workers concurrency + wait-on-server) for k3s; MKS API-driven upgrade path. [→ FR-5.6, FR-6.2]

### M9 — DNS + volumes
- **T9.1** `dns-ovh`: ensureRecords/removeClusterRecords with TXT ownership contract, api_server/ingress target resolution, zone refresh; `none` no-op; contract test suite reusable by future providers. [→ FR-7]
- **T9.2** ∥ `volumes-cinder`: ensureVolume by tag+name, outputs file (`<cluster>.outputs.yaml`), static PV/PVC manifest generation (Retain + pinned volumeHandle), delete-time retention; `volumes list`/`adopt` commands. [→ FR-8, AC-7]

### M10 — Polish & release
- **T10.1** `status` command (inventory + node health via k8s client); exit-code map; renderer completeness sweep + per-tag message tests. [→ FR-10, AC-6]
- **T10.2** Example configs (k3s + ovh-mks), README/docs, `bun build --compile` binary build script + CI artifact; AC-1 final assertion suite. [→ NFR-7, AC-1]

### M11 — Live smoke (blocked on credentials)
- **T11.1** Smoke harness: env-gated scripts running doctor + create→kubeconfig→delete per distro against the real OVH project; record results, fix fallout. [→ AC-8, D10]
