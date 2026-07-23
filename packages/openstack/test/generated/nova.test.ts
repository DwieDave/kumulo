import { assert, it } from "@effect/vitest"
import { Os_Server_GroupShowResponse } from "../../src/generated/nova.ts"
import { decodeFixture, decodeFixtureFails } from "./decode.ts"

it("decodes a server-group response (happy path)", () => {
  const decoded = decodeFixture({
    schema: Os_Server_GroupShowResponse,
    fixture: { server_group: { id: "sg-1", name: "anti-affine", policy: "soft-anti-affinity", members: [] } }
  })
  assert.strictEqual(decoded.server_group?.policy, "soft-anti-affinity")
})

it("rejects an unknown server-group policy value (error-mapping)", () => {
  const error = decodeFixtureFails({
    schema: Os_Server_GroupShowResponse,
    fixture: { server_group: { id: "sg-1", policy: "not-a-real-policy" } }
  })
  assert.isDefined(error)
})
