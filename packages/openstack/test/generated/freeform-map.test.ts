import { assert, it } from "@effect/vitest"
import { FastCheck as fc } from "effect/testing"
import { ServersCreate_274 } from "../../src/generated/nova.ts"
import { decodeFixture, decodeFixtureFails, encodeFixture } from "./decode.ts"

// kumulo: see packages/hetzner/test/generated/freeform-map.test.ts for the WHY — nova
// `metadata` is the same free-form string map, and it carries the drift-detection hash.
// Keys/values are constrained upstream (key pattern, value maxLength 255), so the
// arbitrary respects those bounds; what is under test is that the map is a real
// `Schema.Record` and not an empty struct.
const metadataKey = fc.stringMatching(/^[a-zA-Z0-9-_:. ]{1,255}$/)

it("nova metadata round-trips with arbitrary keys", () => {
  fc.assert(
    fc.property(fc.dictionary(metadataKey, fc.string({ maxLength: 255 })), (metadata) => {
      const value = { server: { name: "s", flavorRef: "1", networks: "none", metadata } }
      const encoded = encodeFixture({ schema: ServersCreate_274, value })
      const decoded = decodeFixture({ schema: ServersCreate_274, fixture: encoded })
      assert.deepStrictEqual(decoded.server.metadata, metadata)
    })
  )
})

it("nova metadata is typed, not an open empty struct", () => {
  const error = decodeFixtureFails({
    schema: ServersCreate_274,
    fixture: { server: { name: "s", flavorRef: "1", networks: "none", metadata: { a: 1 } } }
  })
  assert.isDefined(error)
})
