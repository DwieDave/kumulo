import { assert, it } from "@effect/vitest"
import { NetworkShowResponse } from "../../src/generated/neutron.ts"
import { decodeFixture, decodeFixtureFails } from "./decode.ts"

it("decodes a show-network response (happy path)", () => {
  const decoded = decodeFixture({
    schema: NetworkShowResponse,
    fixture: { network: { id: "net-1", name: "private", mtu: 1500, shared: false } }
  })
  assert.strictEqual(decoded.network?.mtu, 1500)
})

it("rejects a network whose mtu is not a number (error-mapping)", () => {
  const error = decodeFixtureFails({
    schema: NetworkShowResponse,
    fixture: { network: { id: "net-1", mtu: "jumbo" } }
  })
  assert.isDefined(error)
})
