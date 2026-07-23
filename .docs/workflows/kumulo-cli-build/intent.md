# Intent — Kumulo CLI Build

Build the full Kumulo CLI as specified in `.docs/design/kumulo-design.md` (Draft v1): a single-binary-experience CLI that reconciles a single `cluster.yaml` into a running Kubernetes cluster on OpenStack-based clouds (OVH first), including DNS management and retained volumes — the hetzner-k3s experience (see `.references/hetzner-k3s`), provider-decoupled.

## Decisions confirmed with the user (2026-07-23)

- **Track:** Both distros in parallel — `k3s` (self-managed, OpenStack/Keystone path) **and** `ovh-mks` (managed, OVH v1 API path). Shared core is built once; both distros prove it.
- **Runtime/tooling:** **Bun workspaces** (not pnpm/turborepo as drafted). `bun test`, `bun build --compile` for the single binary. Effect.ts + @effect/cli unchanged.
- **Scope:** The **entire design doc** — core, codegen pipelines (OpenStack OpenAPI + ovh2openapi converter), both distros, all v1 addons, DNS module (OVH), retained volumes (Cinder), generic profile, docs/release polish. v1 non-goals in the doc (§1) remain non-goals.
- **Live testing:** Development is fixtures-only (fake Layers, recorded HTTP fixtures, vendored specs). Real OVH credentials arrive only at the end for smoke tests — every milestone must be verifiable without live cloud access; a final smoke-test milestone runs `doctor` + E2E against the real project.

## Success criteria

- `kumulo create --config cluster.yaml` converges to a working cluster for both `distro: k3s` and `distro: ovh-mks` (verified via fixtures/fakes throughout; live smoke at the end).
- Full CLI surface of §7, error model of §8.1, no state file (tag-based reconciliation, §6).
- Hexagonal package layout per Appendix A, arrows inward, core depends only on `effect`.
