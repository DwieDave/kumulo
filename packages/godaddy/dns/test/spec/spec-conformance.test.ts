import { describe, expect, it } from "@effect/vitest"
import { Data, Effect } from "effect"
import * as Schema from "effect/Schema"
import { readFileSync } from "node:fs"
import { clientOperations, DnsRecord, DnsRecordInput } from "../../src/client/godaddy-dns.ts"

class SpecLoadError extends Data.TaggedError("SpecLoadError")<{ readonly reason: string }> {}

const _Operation = Schema.Struct({
  responses: Schema.optionalKey(Schema.Record(Schema.String, Schema.Struct({
    content: Schema.optionalKey(Schema.Record(Schema.String, Schema.Struct({
      examples: Schema.optionalKey(Schema.Record(Schema.String, Schema.Struct({ value: Schema.Struct({ items: Schema.Array(Schema.Unknown) }) })))
    })))
  }))),
  requestBody: Schema.optionalKey(Schema.Struct({
    content: Schema.Record(Schema.String, Schema.Struct({ schema: Schema.Struct({ $ref: Schema.String }) }))
  }))
})

const _Spec = Schema.Struct({
  paths: Schema.Record(Schema.String, Schema.Unknown),
  components: Schema.Struct({
    parameters: Schema.Record(Schema.String, Schema.Struct({ name: Schema.optionalKey(Schema.String) })),
    schemas: Schema.Record(Schema.String, Schema.Struct({ $ref: Schema.optionalKey(Schema.String) }))
  }),
  "x-ext": Schema.Record(Schema.String, Schema.Struct({
    required: Schema.optionalKey(Schema.Array(Schema.String)),
    properties: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown))
  }))
})

const _specUrl = new URL("../../specs/domains-v3.json", import.meta.url)

const _loadSpec = Effect.try({
  try: () => JSON.parse(readFileSync(_specUrl, "utf8")),
  catch: (cause) => new SpecLoadError({ reason: `cannot read or parse the spec: ${String(cause)}` })
}).pipe(
  Effect.flatMap((raw) => Effect.mapError(Schema.decodeUnknownEffect(_Spec)(raw), (error) => new SpecLoadError({ reason: error.message })))
)

const _last = (ref: string | undefined): string => ref?.split("/").at(-1) ?? ""

const _PathItem = Schema.Record(Schema.String, Schema.Unknown)

const _pathItem = (path: string) =>
  _loadSpec.pipe(
    Effect.flatMap((spec) => Effect.fromOption(Schema.decodeUnknownOption(_PathItem)(spec.paths[path]))),
    Effect.mapError(() => new SpecLoadError({ reason: `path ${path} is missing from the spec` }))
  )

const _requestSchema = ({ method, path }: { readonly method: string; readonly path: string }) =>
  Effect.gen(function*() {
    const spec = yield* _loadSpec
    const item = yield* _pathItem(path)
    const operation = yield* Effect.fromOption(Schema.decodeUnknownOption(_Operation)(item[method]))
    const named = _last(operation.requestBody?.content["application/json"]?.schema.$ref)

    return spec["x-ext"][_last(spec.components.schemas[named]?.$ref)]
  })

describe("domains-v3 spec conformance", () => {
  it.effect("contains every method and path the client uses", () =>
    Effect.forEach(clientOperations, (operation) =>
      _pathItem(operation.path).pipe(Effect.tap((item) => Effect.sync(() => expect(Object.keys(item)).toContain(operation.method))))))

  it.effect("decodes the spec's list response examples with the record schema", () =>
    Effect.gen(function*() {
      const item = yield* _pathItem("/zones/{zone}/dns-records")
      const operation = yield* Effect.fromOption(Schema.decodeUnknownOption(_Operation)(Object.entries(item).find(([method]) => method === "get")?.[1]))
      const examples = Object.values(operation.responses?.["200"]?.content?.["application/json"]?.examples ?? {})
      const items = examples.flatMap((example) => example.value.items)

      expect(items.length).toBeGreaterThan(0)
      yield* Effect.forEach(items, (value) => Schema.decodeUnknownEffect(DnsRecord)(value))
    }))

  it.effect("matches the POST and PUT request body fields to DnsRecordInput", () =>
    Effect.forEach(
      [
        { method: "post", path: "/zones/{zone}/dns-records" },
        { method: "put", path: "/zones/{zone}/dns-records/{recordId}" }
      ],
      (operation) =>
        _requestSchema(operation).pipe(Effect.tap((schema) =>
          Effect.sync(() => {
            const properties = Object.keys(schema?.properties ?? {})
            const inputKeys = Object.keys(DnsRecordInput.fields)

            expect([...(schema?.required ?? [])].toSorted()).toEqual(["data", "name", "ttl", "type"])
            expect(inputKeys.filter((key) => !properties.includes(key))).toEqual([])
            expect(properties.filter((key) => !inputKeys.includes(key))).toEqual(["recordId"])
          })
        ))
    ))

  it.effect("uses the spec's path parameter names", () =>
    Effect.gen(function*() {
      const spec = yield* _loadSpec

      expect(Object.keys(spec.paths)).toContain("/zones/{zone}/dns-records/{recordId}")
      expect(spec.components.parameters["zonePath"]?.name).toBe("zone")
      expect(spec.components.parameters["recordId"]?.name).toBe("recordId")
    }))
})
