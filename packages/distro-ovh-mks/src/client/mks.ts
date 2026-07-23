/**
 * Thin, friendlier re-export of the generated OVH v1 MKS client.
 *
 * kumulo: deliberately takes a plain `HttpClient.HttpClient` value (not a
 * Layer/Context tag) and imports nothing from `@kumulo/provider-ovh` —
 * dependency-cruiser's `no-sibling-package-imports` rule forbids non-core
 * packages depending on each other by design (hexagonal boundary). Composing
 * `OvhAuthLive` + `ovhHttpClientLayer` (both in provider-ovh) with this
 * client is the composition root's job (CLI wiring, T4.2), not this
 * package's.
 */
export { make as makeMksClient } from "../generated/client.ts"
export type { Mks, MksError } from "../generated/client.ts"
