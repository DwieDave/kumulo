import { assert, it } from "@effect/vitest"
import { Os_Server_GroupsListResponse } from "../../src/generated/nova.ts"
import { decodeFixture, decodeFixtureFails } from "./decode.ts"

it("decodes a list-server-groups response (happy path)", () => {
  const decoded = decodeFixture({
    schema: Os_Server_GroupsListResponse,
    fixture: { server_groups: [{ id: "sg-1", name: "anti-affine", policy: "soft-anti-affinity", members: [] }] }
  })
  assert.strictEqual(decoded.server_groups?.[0]?.policy, "soft-anti-affinity")
})

it("rejects an unknown server-group policy value (error-mapping)", () => {
  const error = decodeFixtureFails({
    schema: Os_Server_GroupsListResponse,
    fixture: { server_groups: [{ id: "sg-1", policy: "not-a-real-policy" }] }
  })
  assert.isDefined(error)
})
