import { ResourceNotFound, ResponseDecodeError } from "@kumulo/core"
import { Effect, Option, SchemaIssue } from "effect"

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

const _isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

const _field = (value: unknown, key: string): unknown => _isRecord(value) ? value[key] : undefined

const _string = (value: unknown): string => typeof value === "string" ? value : ""

// kumulo: lenient by design (FR-4.6) — only the fields we consume are
// validated; every other field OpenStack's catalog carries is ignored
// rather than rejected.
export const parseCatalog = (body: unknown): Effect.Effect<ServiceCatalog, ResponseDecodeError> => {
  const catalog = _field(_field(body, "token"), "catalog")
  if (!Array.isArray(catalog)) {
    const issue = new SchemaIssue.InvalidValue(Option.some(body), { message: "missing token.catalog" })
    return Effect.fail(new ResponseDecodeError({ endpoint: "/v3/auth/tokens", issue }))
  }
  return Effect.succeed(
    catalog.map((entry: unknown) => {
      const endpoints = _field(entry, "endpoints")
      return {
        type: _string(_field(entry, "type")),
        endpoints: Array.isArray(endpoints)
          ? endpoints.map((endpoint: unknown) => ({
            interface: _string(_field(endpoint, "interface")),
            region: _string(_field(endpoint, "region")),
            url: _string(_field(endpoint, "url"))
          }))
          : []
      }
    })
  )
}

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
