# Plan

## Milestone 1 — Validation fails loudly (core)

- T1.1 (FR4): Add cross-field filter `isDnsModuleConsistentWithDistro` in
  `packages/core/src/config/schema.ts`: allowed = `none`/`hetzner` for any distro;
  `ovh`/`designate` only for `k3s`. Property test over the enum product space.

## Milestone 2 — Shared DNS module (cli refactor, k3s unchanged)

- T2.1 (D1, NFR1): Create `packages/cli/src/dns.ts`; move `_reconcileDns` and
  `_dnsProviderLayerFor` from `k3s/reconcile.ts`; k3s call sites import from it.
- T2.2 (FR2, D2): Introduce `DnsTarget` union; `ip` → A record, `hostname` →
  CNAME. k3s passes `{ kind: "ip", value: infra.lbVip }`. Unit/property test on
  the target→record mapping.

## Milestone 3 — Wire MKS path (cli)

- T3.1 (FR1, D3): In `applyMks` flow (`commands.ts` / `mks/reconcile.ts`), after
  cluster ensure, call `reconcileDns` with
  `{ kind: "hostname", value: new URL(info.apiEndpoint).hostname }`; fail on empty
  endpoint. Provide the hetzner DNS layer via shared `dnsProviderLayerFor`.
- T3.2 (FR3): Call `removeClusterRecords` in the MKS delete flow.

## Milestone 4 — Plan visibility

- T4.1 (FR5): Emit DNS record actions in `k3s/plan.ts` and `mks/plan.ts`
  (one shared helper building rows from `config.dns.records` + target kind).

## Task → requirement links

| Task | Requirements |
|------|--------------|
| T1.1 | FR4, D4 |
| T2.1 | D1, NFR1 |
| T2.2 | FR2, D2, NFR3, NFR4 |
| T3.1 | FR1, D3 |
| T3.2 | FR3 |
| T4.1 | FR5 |

Each task executes per Phase 4: detail plan → failing test → code → pass → commit.
