import { ResourceNotFound, ResponseDecodeError } from "@kumulo/core"
import { Effect } from "effect"
import * as Schema from "effect/Schema"

const CatalogEndpointSchema = Schema.Struct({
  interface: Schema.optionalKey(Schema.String),
  region: Schema.optionalKey(Schema.String),
  url: Schema.optionalKey(Schema.String)
})

const CatalogEntrySchema = Schema.Struct({
  type: Schema.optionalKey(Schema.String),
  endpoints: Schema.optionalKey(Schema.Array(CatalogEndpointSchema))
})

// kumulo: only the fields the auth layer consumes — everything else
// Keystone's token response carries is left undeclared and ignored.
const TokenResponse = Schema.Struct({
  token: Schema.Struct({
    catalog: Schema.Array(CatalogEntrySchema)
  })
})

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

export const parseCatalog = (body: unknown): Effect.Effect<ServiceCatalog, ResponseDecodeError> =>
  Schema.decodeUnknownEffect(TokenResponse)(body).pipe(
    Effect.mapError((error) => new ResponseDecodeError({ endpoint: "/v3/auth/tokens", issue: error.issue })),
    Effect.map((decoded) =>
      decoded.token.catalog.map((entry) => ({
        type: entry.type ?? "",
        endpoints: (entry.endpoints ?? []).map((endpoint) => ({
          interface: endpoint.interface ?? "",
          region: endpoint.region ?? "",
          url: endpoint.url ?? ""
        }))
      }))
    )
  )

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
