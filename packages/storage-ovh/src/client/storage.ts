/**
 * Thin, friendlier re-export of the generated OVH v1 object-storage +
 * project-user client.
 *
 * See `packages/distro-ovh-mks/src/client/mks.ts` for why this doesn't wire
 * `@kumulo/provider-ovh`'s `OvhAuthLive`/`ovhHttpClientLayer` itself
 * (dependency-cruiser sibling-import rule; composition happens at the CLI
 * wiring layer).
 */
export { make as makeStorageClient } from "../generated/client.ts"
export type { Storage, StorageError } from "../generated/client.ts"
