import { describe, expect, it } from "@effect/vitest"
import { Data, Effect, Predicate } from "effect"
import * as Schema from "effect/Schema"
import { readFileSync } from "node:fs"
import { clientOperations, DnsRecord, DnsRecordInput, pageSize } from "../../src/client/cloudflare-dns.ts"

class SpecLoadError extends Data.TaggedError("SpecLoadError")<{ readonly reason: string }> {}

interface SchemaNode {
  readonly $ref?: string
  readonly properties?: Record<string, SchemaNode>
  readonly allOf?: ReadonlyArray<SchemaNode>
  readonly anyOf?: ReadonlyArray<SchemaNode>
  readonly required?: ReadonlyArray<string>
  readonly maximum?: number
  readonly minimum?: number
  readonly enum?: ReadonlyArray<unknown>
  readonly example?: unknown
}

const _Spec = Schema.Struct({
  paths: Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Struct({
    parameters: Schema.optionalKey(Schema.Array(Schema.Struct({ $ref: Schema.optionalKey(Schema.String), name: Schema.optionalKey(Schema.String) })))
  }))),
  components: Schema.Struct({
    schemas: Schema.Record(Schema.String, Schema.Unknown),
    parameters: Schema.Record(Schema.String, Schema.Struct({ name: Schema.String }))
  })
})

const _specUrl = new URL("../../specs/cloudflare-dns-v4.json", import.meta.url)

const _loadSpec = Effect.try({
  try: () => JSON.parse(readFileSync(_specUrl, "utf8")),
  catch: (cause) => new SpecLoadError({ reason: `cannot read or parse the spec: ${String(cause)}` })
}).pipe(Effect.flatMap((raw) => Effect.mapError(Schema.decodeUnknownEffect(_Spec)(raw), (error) => new SpecLoadError({ reason: error.message }))))

const _schema = (spec: typeof _Spec.Type, name: string): SchemaNode => {
  const node = spec.components.schemas[name]

  if (!Predicate.isObject(node)) throw new Error(`schema ${name} is missing from the spec`)

  return node
}

// properties of a schema, following $ref and allOf
const _properties = (spec: typeof _Spec.Type, node: SchemaNode): Record<string, SchemaNode> => {
  if (node.$ref !== undefined) return _properties(spec, _schema(spec, node.$ref.split("/").at(-1) ?? ""))

  return Object.assign({}, ...(node.allOf ?? []).map((part) => _properties(spec, part)), node.properties ?? {})
}

const _required = (spec: typeof _Spec.Type, node: SchemaNode): ReadonlyArray<string> => {
  if (node.$ref !== undefined) return _required(spec, _schema(spec, node.$ref.split("/").at(-1) ?? ""))

  return [...(node.required ?? []), ...(node.allOf ?? []).flatMap((part) => _required(spec, part))]
}

const _parameterNames = (spec: typeof _Spec.Type, path: string, method: string): ReadonlyArray<string> =>
  (spec.paths[path]?.[method]?.parameters ?? []).map((p) =>
    p.name ?? spec.components.parameters[p.$ref?.split("/").at(-1) ?? ""]?.name ?? ""
  )

describe("cloudflare v4 spec conformance", () => {
  it.effect("contains every method and path the client uses", () =>
    Effect.map(_loadSpec, (spec) => {
      for (const operation of clientOperations) expect(Object.keys(spec.paths[operation.path] ?? {})).toContain(operation.method)
    }))

  it.effect("the zone lookup can filter by name and the zone carries its assigned nameservers", () =>
    Effect.map(_loadSpec, (spec) => {
      expect(_parameterNames(spec, "/zones", "get")).toEqual(expect.arrayContaining(["name", "per_page"]))
      expect(_required(spec, _schema(spec, "zones_zone"))).toEqual(expect.arrayContaining(["id", "name", "name_servers"]))
    }))

  it.effect("the record list pages with page and per_page and allows our page size", () =>
    Effect.map(_loadSpec, (spec) => {
      expect(_parameterNames(spec, "/zones/{zone_id}/dns_records", "get")).toEqual(expect.arrayContaining(["page", "per_page"]))
      expect(_schema(spec, "dns-records_per_page").maximum ?? 0).toBeGreaterThanOrEqual(pageSize)
      expect(Object.keys(_properties(spec, _schema(spec, "dns-records_api-response-collection")).result_info?.properties ?? {})).toContain("total_pages")
    }))

  it.effect("every field kumulo sends exists on the A, AAAA, CNAME and TXT record bodies", () =>
    Effect.map(_loadSpec, (spec) => {
      for (const type of ["A", "AAAA", "CNAME", "TXT"]) {
        const properties = Object.keys(_properties(spec, _schema(spec, `dns-records_${type}Record`)))
        expect(Object.keys(DnsRecordInput.fields).filter((key) => !properties.includes(key))).toEqual([])
      }
    }))

  it.effect("records in responses carry an id and every field kumulo reads", () =>
    Effect.map(_loadSpec, (spec) => {
      const response = _schema(spec, "dns-records_dns-record-response")
      expect(_required(spec, response)).toContain("id")

      const properties = { ..._properties(spec, response), ..._properties(spec, _schema(spec, "dns-records_ARecord")) }
      expect(Object.keys(DnsRecord.fields).filter((key) => !(key in properties))).toEqual([])
    }))

  it.effect("decodes a record built from the spec's own examples", () =>
    Effect.gen(function*() {
      const spec = yield* _loadSpec
      const a = _properties(spec, _schema(spec, "dns-records_ARecord"))

      const example = {
        id: _schema(spec, "dns-records_identifier").example,
        name: _schema(spec, "dns-records_name").example,
        type: "A",
        content: a.content?.example,
        ttl: _schema(spec, "dns-records_ttl").example,
        proxied: _schema(spec, "dns-records_proxied").example
      }

      yield* Schema.decodeUnknownEffect(DnsRecord)(example)
    }))

  it.effect("ttl takes 1 for automatic and tops out at 86400, as the config rule assumes", () =>
    Effect.map(_loadSpec, (spec) => {
      const ttl = _schema(spec, "dns-records_ttl")
      expect(ttl.anyOf?.some((option) => option.enum?.includes(1) === true)).toBe(true)
      expect(ttl.anyOf?.some((option) => option.maximum === 86400)).toBe(true)
    }))
})
