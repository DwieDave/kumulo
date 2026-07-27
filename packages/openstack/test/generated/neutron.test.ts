import { assert, it } from "@effect/vitest"
import { NetworksIndexResponse } from "../../src/generated/neutron.ts"
import { decodeFixture, decodeFixtureFails } from "./decode.ts"

it("decodes a list-networks response (happy path)", () => {
  const decoded = decodeFixture({
    schema: NetworksIndexResponse,
    fixture: { networks: [{ id: "net-1", name: "private", mtu: 1500, shared: false }] }
  })
  assert.strictEqual(decoded.networks?.[0]?.mtu, 1500)
})

it("rejects a network whose mtu is not a number (error-mapping)", () => {
  const error = decodeFixtureFails({
    schema: NetworksIndexResponse,
    fixture: { networks: [{ id: "net-1", mtu: "jumbo" }] }
  })
  assert.isDefined(error)
})
