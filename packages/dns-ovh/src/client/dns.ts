/**
 * Thin, friendlier re-export of the generated OVH v1 DNS zone-record client.
 *
 * See `packages/distro-ovh-mks/src/client/mks.ts` for why this doesn't wire
 * `@kumulo/provider-ovh`'s `OvhAuthLive`/`ovhHttpClientLive` itself
 * (dependency-cruiser sibling-import rule; composition happens at the CLI
 * wiring layer).
 */
export { make as makeDnsClient } from "../generated/client.ts"
export type { Dns, DnsError } from "../generated/client.ts"
