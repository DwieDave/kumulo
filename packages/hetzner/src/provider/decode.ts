import { ResourceNotFound } from "@kumulo/core"
import { Effect } from "effect"
import * as Schema from "effect/Schema"

// kumulo: `CloudProvider`'s error channel (`CloudError`) has no decode-failure
// variant of its own — mirrors the `@kumulo/openstack` convention (its
// `provider/schemas.ts`) of folding a malformed response into `ResourceNotFound`
// rather than widening the whole port's error type. Duplicated, not imported —
// dependency-cruiser's `no-sibling-package-imports` forbids one provider
// package depending on another.
export const decodeHcloud = <A>(
  { kind, schema }: { readonly schema: Schema.Codec<A, unknown>; readonly kind: string }
) =>
(value: unknown): Effect.Effect<A, ResourceNotFound> =>
  Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(() => new ResourceNotFound({ kind, ref: "malformed response body" }))
  )

// kumulo: every hcloud list response wraps its array under a resource-named
// field (`networks`, `firewalls`, ...) — decode straight into `{ [listField]:
// Array<A> }` instead of a manual field-lookup guard.
export const decodeListField = <A>(
  { itemSchema, kind, listField }: { readonly itemSchema: Schema.Codec<A, unknown>; readonly listField: string; readonly kind: string }
) => {
  const envelope = Schema.Struct({ [listField]: Schema.Array(itemSchema) })
  return (value: unknown): Effect.Effect<ReadonlyArray<A>, ResourceNotFound> =>
    decodeHcloud({ schema: envelope, kind })(value).pipe(Effect.map((decoded) => Object.values(decoded)[0] ?? []))
}

// kumulo: every hcloud create/get response wraps its object under a
// resource-named field (`network`, `server`, ...).
export const decodeSingleField = <A>(
  { field, itemSchema, kind }: { readonly itemSchema: Schema.Codec<A, unknown>; readonly field: string; readonly kind: string }
) => {
  const envelope = Schema.Struct({ [field]: Schema.optionalKey(itemSchema) })
  return (value: unknown): Effect.Effect<A, ResourceNotFound> =>
    decodeHcloud({ schema: envelope, kind })(value).pipe(
      Effect.flatMap((decoded) => {
        const sole = Object.values(decoded)[0]
        return sole === undefined
          ? Effect.fail(new ResourceNotFound({ kind, ref: "malformed response body" }))
          : Effect.succeed(sole)
      })
    )
}
