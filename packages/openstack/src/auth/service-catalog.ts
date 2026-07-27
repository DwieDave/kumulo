import { ResourceNotFound } from "@kumulo/core"
import { Effect } from "effect"
import type { AuthTokensPostResponse } from "../generated/keystone.ts"

export interface CatalogEndpoint {
  readonly interface: string
  readonly region: string
  readonly url: string
}

export interface CatalogEntry {
  readonly type: string
  readonly endpoints: ReadonlyArray<CatalogEndpoint>
}

export type ServiceCatalog = ReadonlyArray<CatalogEntry>

// kumulo: no hand-written response schema any more — the generated Keystone
// client already decoded the token envelope. This only fills in the defaults
// for the fields the catalog leaves optional.
export const catalogOf = (response: AuthTokensPostResponse): ServiceCatalog =>
  (response.token?.catalog ?? []).map((entry) => ({
    type: entry.type ?? "",
    endpoints: (entry.endpoints ?? []).map((endpoint) => ({
      interface: endpoint.interface ?? "",
      region: endpoint.region ?? "",
      url: endpoint.url ?? ""
    }))
  }))

export interface ResolveEndpointOptions {
  readonly catalog: ServiceCatalog
  readonly service: string
  readonly region: string
}

export const resolveEndpoint = (options: ResolveEndpointOptions): Effect.Effect<string, ResourceNotFound> => {
  const entry = options.catalog.find((candidate) => candidate.type === options.service)
  const endpoint = entry?.endpoints.find((candidate) =>
    candidate.interface === "public" && candidate.region === options.region
  ) ?? entry?.endpoints.find((candidate) => candidate.interface === "public")
  return endpoint === undefined
    ? Effect.fail(new ResourceNotFound({ kind: "service-catalog-endpoint", ref: `${options.service}@${options.region}` }))
    : Effect.succeed(endpoint.url)
}
