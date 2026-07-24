import { ResourceNotFound } from "@kumulo/core"
import { Effect } from "effect"
import * as Schema from "effect/Schema"

// kumulo: OpenStack list/get responses carry many fields beyond what any one
// caller consumes — every schema here is intentionally partial (FR-4.6):
// unrecognized extra fields are ignored, not rejected, because a plain
// `Schema.Struct` only validates the keys it declares.

// ---- Generic named resource (network / security-group / server-group /
// image / flavor entries all share this "id/name" shape) -------------------

export const NamedResource = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String)
})
export type NamedResource = typeof NamedResource.Type

// ---- Server (compute) ------------------------------------------------------

const ServerAddress = Schema.Struct({
  addr: Schema.optionalKey(Schema.String)
})

export const ServerRecord = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(Schema.String),
  addresses: Schema.optionalKey(Schema.Record(Schema.String, Schema.Array(ServerAddress)))
})
export type ServerRecord = typeof ServerRecord.Type

// ---- Load balancer (Octavia) ----------------------------------------------

export const LoadBalancerRecord = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String),
  vip_address: Schema.optionalKey(Schema.String)
})
export type LoadBalancerRecord = typeof LoadBalancerRecord.Type

// ---- decode helpers ---------------------------------------------------------

// kumulo: `CloudProvider`'s error channel (`CloudError`, defined in
// `@kumulo/core`) has no decode-failure variant of its own — mirrors the
// pre-existing `_decodeRule` convention in `cloud-provider.ts`, mapping a
// malformed response into `ResourceNotFound` rather than widening the whole
// port's error type (out of this package's ownership).
export const decodeResponse = <A>(
  { kind, schema }: { readonly schema: Schema.Codec<A, unknown>; readonly kind: string }
) =>
(value: unknown): Effect.Effect<A, ResourceNotFound> =>
  Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(() => new ResourceNotFound({ kind, ref: "malformed response body" }))
  )

// kumulo: a "GET .../<resource>s?name=..." list response wraps its array
// under a service-chosen field name (`networks`, `security_groups`, ...) —
// decode straight into `{ [listField]: Array<A> }` instead of a manual
// `Array.isArray(field(body, listField))` guard.
export const decodeListField = <A>(
  { itemSchema, kind, listField }: { readonly itemSchema: Schema.Codec<A, unknown>; readonly listField: string; readonly kind: string }
) => {
  const envelope = Schema.Struct({ [listField]: Schema.Array(itemSchema) })
  return (value: unknown): Effect.Effect<ReadonlyArray<A>, ResourceNotFound> =>
    // kumulo: the envelope has exactly one key (`listField`) — pulling the
    // sole value out avoids indexing by a non-literal string, which widens
    // TS's inferred property type to `A | undefined`.
    decodeResponse({ schema: envelope, kind })(value).pipe(Effect.map((decoded) => Object.values(decoded)[0] ?? []))
}

// kumulo: a "POST/GET .../<resource>" singular response wraps its object
// under a service-chosen field name (`network`, `server`, ...).
export const decodeSingleField = <A>(
  { field, itemSchema, kind }: { readonly itemSchema: Schema.Codec<A, unknown>; readonly field: string; readonly kind: string }
) => {
  const envelope = Schema.Struct({ [field]: itemSchema })
  return (value: unknown): Effect.Effect<A, ResourceNotFound> =>
    decodeResponse({ schema: envelope, kind })(value).pipe(
      Effect.flatMap((decoded) => {
        const sole = Object.values(decoded)[0]
        return sole === undefined
          ? Effect.fail(new ResourceNotFound({ kind, ref: "malformed response body" }))
          : Effect.succeed(sole)
      })
    )
}
