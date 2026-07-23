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
_To be added per milestone after milestone sequencing is approved (Phase 3 step 2), each task linked to FR/AC ids._
