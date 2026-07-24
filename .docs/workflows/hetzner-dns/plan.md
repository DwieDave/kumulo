# Plan: `dns-hetzner` — Hetzner DNS via cluster config

Status: DRAFT — awaiting human approval. Each task lists its requirements.

## Milestone 1 — Config schema + CLI wiring fix

Depends on nothing; can start immediately. T1.1 and T1.2 touch disjoint files
and are parallelizable with each other, but both must land before M3 (T1.2's
dispatch function is the thing `k3sHetznerDnsProviderLayer` from M2 plugs into).

- T1.1 Add `"hetzner"` to `DnsModule` in `packages/core/src/config/schema.ts`;
  schema decode test for `dns.module: hetzner`. [R1]
- T1.2 Refactor `packages/cli/src/k3s/reconcile.ts`'s three inline
  `config.dns.module === "ovh"` checks into one `_dnsProviderFor(module)`-style
  dispatch (stubbed for `"hetzner"` until M2 lands — can return a `todo`
  placeholder Layer or be sequenced after M2; loud-`ConfigInvalid` fallback for
  unhandled modules ships here regardless). [R6]

## Milestone 2 — `dns-hetzner` package

Depends on M1's schema literal existing (for the contract/type surface) but not
on T1.2. This is the substantive milestone.

- T2.1 Package scaffold (`packages/dns-hetzner/package.json`, `tsconfig.json`,
  mirroring `dns-ovh/package.json` minus the `codegen`/`ovh2openapi`
  devDependencies per D1) + hand-written client (`src/client/`): zone lookup,
  get/put/delete rrset, list rrsets, Schema-decoded responses. [R3, D1]
- T2.2 Auth: static-bearer-token `HttpClient` wrapping Layer, reading
  `HETZNER_DNS_TOKEN` via `requiredRedactedEnv`. [R7, D3, N7]
- T2.3 Retry-on-429/5xx transport wrapper, reusing
  `openstack/http-client.ts`'s schedule constants. [N2, D4]
- T2.4 Provider logic: `ensureRecords` (TXT-ownership guard, single-value RRset
  PUT, idempotent no-op-if-unchanged) + `removeClusterRecords` (list + tag-scoped
  delete), `provider/errors.ts` status→`DnsError` mapping,
  `provider/ownership.ts` reused convention. [R2, R4, R5, N1, N3, D2, D5]
- T2.5 Contract suite: in-memory fake Hetzner RRset backend implementing
  `ContractHarness`; run `runDnsProviderContractSuite` unmodified. [R8]

## Milestone 3 — Wire it up end to end

Depends on M1 + M2 both complete.

- T3.1 `k3sHetznerDnsProviderLayer()` in `packages/cli/src/k3s/env.ts`, mirroring
  `k3sDnsProviderLayer`'s shape (read env → build httpClient Layer → call
  `hetznerDnsProviderLive`). Wire into T1.2's dispatch function at all three
  `reconcile.ts` call sites. [R6, R7]
- T3.2 Document `HETZNER_DNS_TOKEN` alongside the existing OVH env vars in
  operator-facing docs. [R9]
- T3.3 Full gate pass: typecheck, vitest (incl. T2.5's contract suite),
  oxlint, lint:deps, all green.

Phase-4 execution: per task — detailed plan appended here, failing test first,
implement, verify, commit, following AGENTS.md's Phase 4 loop.

Note: the sibling hetzner-k3s plan (M7) also refactors `packages/cli/src/k3s/reconcile.ts`
(OpenStackEnv decoupling); whichever feature lands second rebases its reconcile.ts task on
the other's merged state.
