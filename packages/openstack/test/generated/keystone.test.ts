import { assert, it } from "@effect/vitest"
import { AuthReceiptSchema, AuthTokensPostResponse } from "../../src/generated/keystone.ts"
import { decodeFixture, decodeFixtureFails } from "./decode.ts"

it("decodes a 200 unscoped token response (happy path)", () => {
  const decoded = decodeFixture({
    schema: AuthTokensPostResponse,
    fixture: {
      token: {
        methods: ["password"],
        expires_at: "2026-07-24T00:00:00.000000Z",
        user: { id: "u1", name: "admin" }
      }
    }
  })
  assert.deepStrictEqual(decoded.token?.methods, ["password"])
})

it("decodes a 401 auth-receipt error body (error-mapping)", () => {
  const decoded = decodeFixture({
    schema: AuthReceiptSchema,
    fixture: {
      receipt: { expires_at: "2026-07-24T00:00:00.000000Z", methods: ["password"] },
      required_auth_methods: ["totp"]
    }
  })
  assert.deepStrictEqual(decoded.required_auth_methods, ["totp"])
})

it("rejects a token response with a non-array methods field", () => {
  const error = decodeFixtureFails({ schema: AuthTokensPostResponse, fixture: { token: { methods: "password" } } })
  assert.isDefined(error)
})
