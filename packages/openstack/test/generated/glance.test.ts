import { assert, it } from "@effect/vitest"
import { ImagesListResponse } from "../../src/generated/glance.ts"
import { decodeFixture, decodeFixtureFails } from "./decode.ts"

it("decodes a list-images response (happy path)", () => {
  const decoded = decodeFixture({
    schema: ImagesListResponse,
    fixture: {
      images: [{ id: "8a5a3b2e-1c4d-4f9a-9e2b-0d6c7a8f1234", name: "ubuntu-24.04", status: "active", visibility: "public" }]
    }
  })
  assert.strictEqual(decoded.images?.[0]?.status, "active")
})

it("rejects an image with an unknown status enum value (error-mapping)", () => {
  const error = decodeFixtureFails({
    schema: ImagesListResponse,
    fixture: { images: [{ id: "8a5a3b2e-1c4d-4f9a-9e2b-0d6c7a8f1234", status: "not-a-real-status" }] }
  })
  assert.isDefined(error)
})
