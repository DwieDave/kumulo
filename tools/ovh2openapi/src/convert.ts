import { Effect, Match } from "effect"
import type { OvhApi, OvhModel, OvhOperation, OvhParameter, OvhSchema } from "./domain.ts"
import { isEnumModel } from "./domain.ts"
import { ConversionUnsupported } from "./errors.ts"
import type { OpenApiDocument, OpenApiOperation, OpenApiParameter, OpenApiRequestBody, OpenApiSchema } from "./openapi.ts"

const _primitiveSchema = Match.type<string>().pipe(
  Match.when("string", (): OpenApiSchema => ({ type: "string" })),
  Match.when("uuid", (): OpenApiSchema => ({ type: "string", format: "uuid" })),
  Match.when("duration", (): OpenApiSchema => ({ type: "string", format: "duration" })),
  Match.when("datetime", (): OpenApiSchema => ({ type: "string", format: "date-time" })),
  Match.when("date", (): OpenApiSchema => ({ type: "string", format: "date" })),
  Match.when("password", (): OpenApiSchema => ({ type: "string", format: "password" })),
  Match.when("ipv4Block", (): OpenApiSchema => ({ type: "string", format: "ipv4Block" })),
  Match.when("boolean", (): OpenApiSchema => ({ type: "boolean" })),
  Match.when("long", (): OpenApiSchema => ({ type: "integer", format: "int64" })),
  Match.when("integer", (): OpenApiSchema => ({ type: "integer" })),
  Match.when("float", (): OpenApiSchema => ({ type: "number", format: "float" })),
  Match.when("double", (): OpenApiSchema => ({ type: "number", format: "double" })),
  Match.orElse(() => undefined)
)

/** Mechanically resolves an OVH `fullType` string to an OpenAPI schema (primitive, array, or model $ref). */
export function typeToSchema(args: {
  readonly fullType: string
  readonly models: Record<string, OvhModel>
}): Effect.Effect<OpenApiSchema, ConversionUnsupported> {
  const { fullType, models } = args
  if (fullType.endsWith("[]")) {
    return typeToSchema({ fullType: fullType.slice(0, -2), models }).pipe(
      Effect.map((items): OpenApiSchema => ({ type: "array", items }))
    )
  }
  // kumulo: OVH's `map[K]V` fullType syntax denotes a string-keyed dictionary
  // (K is always "string" in practice) — model as an open object.
  const [, mapValueType] = /^map\[[^\]]+\](.+)$/.exec(fullType) ?? []
  if (mapValueType !== undefined) {
    return typeToSchema({ fullType: mapValueType, models }).pipe(
      Effect.map((additionalProperties): OpenApiSchema => ({ type: "object", additionalProperties }))
    )
  }
  const primitive = _primitiveSchema(fullType)
  if (primitive !== undefined) return Effect.succeed(primitive)
  if (fullType in models) return Effect.succeed({ $ref: `#/components/schemas/${fullType}` })
  return Effect.fail(new ConversionUnsupported({ construct: "type", detail: fullType }))
}

function _enumModelSchema(enumType: string, values: readonly string[]): Effect.Effect<OpenApiSchema, ConversionUnsupported> {
  if (enumType !== "string") {
    return Effect.fail(new ConversionUnsupported({ construct: "enumType", detail: enumType }))
  }
  return Effect.succeed({ type: "string", enum: values })
}

const _nullable = (schema: OpenApiSchema, canBeNull: boolean | undefined): OpenApiSchema =>
  canBeNull === true ? { anyOf: [schema, { type: "null" }] } : schema

function _objectModelSchema(
  properties: Record<string, { readonly fullType: string; readonly required?: boolean; readonly canBeNull?: boolean }>,
  models: Record<string, OvhModel>
): Effect.Effect<OpenApiSchema, ConversionUnsupported> {
  const entries = Object.entries(properties).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const required = entries.filter(([, property]) => property.required === true).map(([key]) => key)
  return Effect.reduce(entries, (): Record<string, OpenApiSchema> => ({}), (acc, [key, property]) =>
    typeToSchema({ fullType: property.fullType, models }).pipe(
      Effect.map((schema) => ({ ...acc, [key]: _nullable(schema, property.canBeNull) }))
    )
  ).pipe(Effect.map((props): OpenApiSchema => ({ type: "object", properties: props, required })))
}

/** Converts one named OVH model (object or enum) to its OpenAPI schema. */
export function modelToSchema(args: {
  readonly model: OvhModel
  readonly models: Record<string, OvhModel>
}): Effect.Effect<OpenApiSchema, ConversionUnsupported> {
  const { model, models } = args
  return isEnumModel(model) ? _enumModelSchema(model.enumType, model.enum) : _objectModelSchema(model.properties, models)
}

/** Converts the full `models` map to `components/schemas`, sorted for stable output. */
export function convertModels(
  models: Record<string, OvhModel>
): Effect.Effect<Record<string, OpenApiSchema>, ConversionUnsupported> {
  const entries = Object.entries(models).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return Effect.reduce(entries, (): Record<string, OpenApiSchema> => ({}), (acc, [key, model]) =>
    modelToSchema({ model, models }).pipe(Effect.map((schema) => ({ ...acc, [key]: schema })))
  )
}

function _stableOperationId(method: string, path: string): string {
  const slug = path.replace(/[{}]/g, "").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "")
  return `${method.toLowerCase()}_${slug}`
}

function _toOpenApiParam(param: OvhParameter, models: Record<string, OvhModel>): Effect.Effect<OpenApiParameter, ConversionUnsupported> {
  return typeToSchema({ fullType: param.fullType, models }).pipe(
    Effect.map((schema) => ({
      name: param.name ?? "",
      in: param.paramType === "path" ? "path" : "query",
      required: param.required,
      schema
    }))
  )
}

function _requestBodyFor(
  param: OvhParameter | undefined,
  models: Record<string, OvhModel>
): Effect.Effect<OpenApiRequestBody | undefined, ConversionUnsupported> {
  if (param === undefined) return Effect.succeed(undefined)
  return typeToSchema({ fullType: param.fullType, models }).pipe(
    Effect.map((schema) => ({ required: param.required, content: { "application/json": { schema } } }))
  )
}

function _responses(responseType: string, models: Record<string, OvhModel>): Effect.Effect<OpenApiOperation["responses"], ConversionUnsupported> {
  // OVH's schema says "void" but the API answers 200 or 204 depending on the route.
  if (responseType === "void") return Effect.succeed({ "200": { description: "OK" }, "204": { description: "No Content" } })
  return typeToSchema({ fullType: responseType, models }).pipe(
    Effect.map((schema) => ({ "200": { description: "OK", content: { "application/json": { schema } } } }))
  )
}

/** Converts one OVH operation (method + params + response) to an OpenAPI operation object. */
export function operationToOpenApi(args: {
  readonly path: string
  readonly op: OvhOperation
  readonly models: Record<string, OvhModel>
}): Effect.Effect<OpenApiOperation, ConversionUnsupported> {
  const { path, op, models } = args
  const bodyParam = op.parameters.find((p) => p.paramType === "body")
  const otherParams = op.parameters.filter((p) => p.paramType !== "body")
  return Effect.all([
    Effect.forEach(otherParams, (p) => _toOpenApiParam(p, models)),
    _requestBodyFor(bodyParam, models),
    _responses(op.responseType, models)
  ]).pipe(
    Effect.map(([parameters, requestBody, responses]) => ({
      operationId: op.operationId ?? _stableOperationId(op.httpMethod, path),
      description: op.description,
      parameters,
      requestBody,
      responses
    }))
  )
}

function _apiToPathItem(api: OvhApi, models: Record<string, OvhModel>): Effect.Effect<readonly [string, Record<string, OpenApiOperation>], ConversionUnsupported> {
  return Effect.reduce(api.operations, (): Record<string, OpenApiOperation> => ({}), (acc, op) =>
    operationToOpenApi({ path: api.path, op, models }).pipe(
      Effect.map((operation) => ({ ...acc, [op.httpMethod.toLowerCase()]: operation }))
    )
  ).pipe(Effect.map((pathItem) => [api.path, pathItem] as const))
}

/** Converts an OVH proprietary v1 schema document (e.g. `cloud.json`) to an OpenAPI 3.1 document. */
export function convert(schema: OvhSchema): Effect.Effect<OpenApiDocument, ConversionUnsupported> {
  const sortedApis = schema.apis.toSorted((a, b) => a.path.localeCompare(b.path))
  return Effect.all([
    Effect.reduce(sortedApis, (): Record<string, Record<string, OpenApiOperation>> => ({}), (acc, api) =>
      _apiToPathItem(api, schema.models).pipe(Effect.map(([path, item]) => ({ ...acc, [path]: item })))
    ),
    convertModels(schema.models)
  ]).pipe(
    Effect.map(([paths, schemas]) => ({
      openapi: "3.1.0" as const,
      info: { title: "OVH API v1", version: schema.apiVersion ?? "1.0" },
      paths,
      components: { schemas }
    }))
  )
}
