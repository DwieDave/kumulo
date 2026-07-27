import { assert, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { FastCheck as fc } from "effect/testing"
import { Cloud_StorageLifecycleRuleFilter } from "../../src/generated/client.ts"

// kumulo: see packages/hetzner/test/generated/freeform-map.test.ts for the WHY — the OVH
// storage lifecycle-rule `tags` map is free-form and must generate as a real
// `Schema.Record`, not `Schema.Struct({})`.
const _roundTrip = (value: unknown) =>
  Effect.runSync(
    Schema.encodeUnknownEffect(Cloud_StorageLifecycleRuleFilter)(value).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Cloud_StorageLifecycleRuleFilter))
    )
  )

it("storage lifecycle-rule tags round-trip with arbitrary keys", () => {
  fc.assert(
    fc.property(fc.dictionary(fc.string(), fc.string()), (tags) => {
      const decoded = _roundTrip({ tags })
      assert.deepStrictEqual(decoded.tags, tags)
    })
  )
})

it("storage tags are typed, not an open empty struct", () => {
  const error = Effect.runSync(Effect.flip(Schema.decodeUnknownEffect(Cloud_StorageLifecycleRuleFilter)({ tags: { a: 1 } })))
  assert.isDefined(error)
})
