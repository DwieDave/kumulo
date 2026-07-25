# Plan — sub-unions for dns / secrets / object_storage / volumes

Follow-up to config-distro-union. Each module-style field becomes its own
discriminated union so only the fields that mean something for the chosen
backend are required — and orthogonal concerns stop being coupled to distro.

## Ground truth (verified in code)

- `dnsProviderLayerFor` (cli/src/dns.ts) is shared by BOTH distro paths —
  mks/reconcile.ts dispatches through it. DNS module is orthogonal to distro
  and to cloud provider. The old "ovh/designate only on k3s" filter and the
  `ManagedDnsModule` (`none|hetzner`) restriction on the mks variant are
  stale — `distro: ovh-mks` + `dns.module: ovh|hetzner` works, as does
  k3s + any module.
- `designate` has no implementation (always a loud ConfigInvalid at runtime).
- `secrets.dir`/`secrets.sops` only mean anything for `sink: sops`;
  `dns.zone/ttl/records` only for a real dns module; `buckets` only for
  `object_storage.module: ovh`.

## Target shapes

- `dns`: `{ module: "none" }` | `{ module: "ovh" | "hetzner", zone, ttl, records }`
  — same union on BOTH distro variants (delete `ManagedDnsModule`). Drop
  `designate` from the schema entirely: a value that can never work should
  not validate. (Runtime dispatch keeps its loud-failure default.)
- `secrets`: `{ sink: "none" }` | `{ sink: "sops", dir, sops: { age_recipient } }`
  — deletes `isSopsConfiguredWhenSinkIsSops`; `dir` moves into the sops variant.
- `object_storage`: `{ module: "none" }` | `{ module: "ovh", buckets }`
  — deletes `isBucketsEmptyWhenModuleNone`.
- `volumes`: `{ module: "none" }` | `{ module: "cinder", managed }` |
  `{ module: "hcloud", managed }`. Provider coupling becomes structural where
  the variant fixes the provider (mks variant → cinder|none only); the k3s
  variant keeps `isVolumesModuleConsistentWithProvider` as a check.

## Combo matrix after this change

distro × dns fully orthogonal; provider constrains only volumes/CSI addons
(structural on mks, checked on k3s); `object_storage: ovh` still requires a
real secrets sink (cross-field check stays — it spans two unions).

## Milestones

1. **Core schema**: introduce the four sub-unions inside both distro
   variants; delete the three superseded filters + `ManagedDnsModule` +
   `designate`; keep `isSecretsRequiredForObjectStorage` and the k3s-variant
   provider checks. Export nothing new (sub-shapes stay internal).
2. **Consumers** (compile-error-driven): narrow on the discriminant before
   touching dependent fields — dns consumers (`cli/src/dns.ts` desiredRecords/
   reconcileDns/removeDns take the non-none dns shape or early-return, mks
   reconcile already early-returns on none, k3s dns-plan), secrets consumers
   (`storage/env.ts`, `storage/reconcile.ts` narrow `sink === "sops"`),
   bucket consumers (`storage/reconcile.ts`, registry `wantsObjectStorage`),
   volumes consumers (`commands/volumes.ts`, k3s/mks plan) narrow
   `module !== "none"`.
3. **Generator + examples**: drop the now-derived conditionals from
   `crossFieldConstraints` (only object_storage↔secrets and the k3s provider
   rules remain); regenerate; simplify examples (mks example loses the dead
   `dns` zone/ttl/records via `module: none`); ajv positive/negative cases:
   sops sink without age_recipient, dns ovh without zone, buckets under
   module none, mks + dns hetzner ACCEPTED, k3s + dns ovh ACCEPTED.

Success: no module-conditional `.check` filters left except the two listed;
`kumulo.schema.json` expresses every remaining rule; both examples minimal.
