import { assert, it } from "@effect/vitest"
import { TypesListResponse } from "../../src/generated/cinder.ts"
import { decodeFixture, decodeFixtureFails } from "./decode.ts"

it("decodes a list-volume-types response (happy path)", () => {
  const decoded = decodeFixture({
    schema: TypesListResponse,
    fixture: { volume_types: [{ id: "t1", name: "standard", is_public: true }] }
  })
  assert.strictEqual(decoded.volume_types?.[0]?.name, "standard")
})

it("rejects a volume type whose is_public is not a boolean (error-mapping)", () => {
  const error = decodeFixtureFails({
    schema: TypesListResponse,
    fixture: { volume_types: [{ id: "t1", is_public: "yes" }] }
  })
  assert.isDefined(error)
})
