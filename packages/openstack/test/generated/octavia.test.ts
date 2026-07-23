import { assert, it } from "@effect/vitest"
import { LbaasLoadbalancersListResponse } from "../../src/generated/octavia.ts"
import { decodeFixture, decodeFixtureFails } from "./decode.ts"

it("decodes a list-loadbalancers response (happy path)", () => {
  const decoded = decodeFixture({
    schema: LbaasLoadbalancersListResponse,
    fixture: { loadbalancers: [{ id: "lb-1", provisioning_status: "ACTIVE", admin_state_up: true }] }
  })
  assert.strictEqual(decoded.loadbalancers?.[0]?.provisioning_status, "ACTIVE")
})

it("rejects an additional_vips entry missing its required subnet_id (error-mapping)", () => {
  const error = decodeFixtureFails({
    schema: LbaasLoadbalancersListResponse,
    fixture: { loadbalancers: [{ id: "lb-1", additional_vips: [{ ip_address: "10.0.0.5" }] }] }
  })
  assert.isDefined(error)
})
