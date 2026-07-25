# Plan — ClusterConfig as a distro-discriminated union

Goal: one source of truth. `Schema.Union` on `distro` gives (a) a TS union so
k3s code gets its blocks as genuinely required after narrowing — deleting
`k3sBlocks` and its dead fallbacks — and (b) derived `anyOf` JSON schema,
deleting the hand-mirrored distro conditional in `generate-schema.ts`.
Verified: this repo's Effect v4 `toJsonSchemaDocument` compiles unions to
`anyOf` with per-variant `required` + literal discriminators.

## M1 — core schema (packages/core/src/config/schema.ts)

- Factor the shared fields into a plain object (`_commonFields`) spread into
  two structs:
  - `K3sClusterConfig`: `distro: Literal("k3s")`, the six `K3S_ONLY_BLOCKS`
    required again, `version` with the `+k3sN` pattern as a structural check
    (emits `pattern` in JSON schema), `dns.module` full enum.
  - `MksClusterConfig`: `distro: Literal("ovh-mks")`, no k3s blocks,
    `provider: Literal("ovh")` (MKS only exists on OVH — subsumes the dns/auth
    distro gates for this variant), plain-version pattern, `dns.module`
    without `ovh`/`designate`.
- `ClusterConfig = Schema.Union([K3sClusterConfig, MksClusterConfig])`.
- Keep as `.check(...)` only what stays cross-field *within* a variant:
  provider↔auth-method, provider↔volumes-module, provider↔CSI addon,
  object-storage↔secrets-sink (k3s variant; mks variant gets the ovh-fixed
  halves structurally). Delete `isK3sBlocksPresentForK3s`,
  `isVersionValidForDistro`, `isDnsModuleConsistentWithDistro`.
- Export `K3sClusterConfig`/`MksClusterConfig` types; drop `K3S_ONLY_BLOCKS`.

## M2 — consumers (packages/cli)

- Delete `k3s/blocks.ts`; k3s modules (`k3s/*`, `distro/k3s-entry.ts`,
  `provider/registry.ts` k3s helpers) take `K3sClusterConfig`; mks modules
  take `MksClusterConfig`.
- Narrow once at dispatch: `distroFor(config)` switches on `config.distro`,
  which TS now narrows — each `DistroEntry` becomes generic over its variant
  (or the entry closures narrow before calling into distro modules).
- Shared modules (dns, volumes, storage, env-summary) keep taking the union —
  they only touch common fields.
- Fix tests: decode fixtures, `hetzner-fields.test.ts` drops the `?.`.

## M3 — generator (scripts/generate-schema.ts)

- Delete the distro `if/then` from `crossFieldConstraints` (derived now);
  keep the provider and secrets conditionals only if they survived as checks.
- Regenerate; re-run the ajv positive/negative validations from 5687a8b.

Order: M1 → M2 compile-error-driven → M3. Success = `k3sBlocks` gone, no
distro-related `.check` filters, examples decode unchanged, ajv checks pass.
