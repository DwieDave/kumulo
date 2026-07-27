import { assert, it } from "@effect/vitest"
import { FastCheck as fc } from "effect/testing"
import { CreateFirewallRequestJson } from "../../src/generated/hcloud.ts"
import { decodeFixture, decodeFixtureFails, encodeFixture } from "./decode.ts"

// kumulo: labels is a free-form string map. It MUST generate as a real `Schema.Record`,
// not `Schema.Struct({})` — an empty struct only carries labels by accident (unknown-key
// preservation on encode); the moment that stops, resources are created unlabelled,
// `deleteByTag` can't see them (orphaned billable servers) and drift detection, which
// stores the config hash in exactly this field, breaks.
it("hcloud labels round-trip with arbitrary keys", () => {
  fc.assert(
    fc.property(fc.dictionary(fc.string(), fc.string()), (labels) => {
      const value = { name: "fw", labels }
      const encoded = encodeFixture({ schema: CreateFirewallRequestJson, value })
      const decoded = decodeFixture({ schema: CreateFirewallRequestJson, fixture: encoded })
      assert.deepStrictEqual(decoded.labels, labels)
    })
  )
})

// The round trip above must not rely on unknown-key preservation: a typed Record rejects a
// non-string value, an empty struct would happily let it through.
it("hcloud labels are typed, not an open empty struct", () => {
  const error = decodeFixtureFails({ schema: CreateFirewallRequestJson, fixture: { name: "fw", labels: { a: 1 } } })
  assert.isDefined(error)
})
