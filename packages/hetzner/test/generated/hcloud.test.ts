import { assert, it } from "@effect/vitest"
import { GetAction200, ListLocations200 } from "../../src/generated/hcloud.ts"
import { decodeFixture, decodeFixtureFails } from "./decode.ts"

it("decodes a get-action response (happy path)", () => {
  const decoded = decodeFixture({
    schema: GetAction200,
    fixture: {
      action: {
        id: 1,
        command: "create_server",
        status: "running",
        started: "2026-01-01T00:00:00+00:00",
        finished: "2026-01-01T00:00:05+00:00",
        progress: 100,
        resources: [{ id: 42, type: "server" }],
        error: { code: "action_failed", message: "boom" }
      }
    }
  })
  assert.strictEqual(decoded.action.status, "running")
})

it("rejects a get-action response with an unknown status (error-mapping)", () => {
  const error = decodeFixtureFails({
    schema: GetAction200,
    fixture: {
      action: {
        id: 1,
        command: "create_server",
        status: "pending",
        started: "2026-01-01T00:00:00+00:00",
        finished: "2026-01-01T00:00:05+00:00",
        progress: 100,
        resources: [],
        error: { code: "action_failed", message: "boom" }
      }
    }
  })
  assert.isDefined(error)
})

const _pagination = { page: 1, per_page: 25, previous_page: null, next_page: null, last_page: 1, total_entries: 1 }

it("decodes a list-locations response, including a null pagination field (happy path)", () => {
  const decoded = decodeFixture({
    schema: ListLocations200,
    fixture: {
      locations: [{
        id: 1,
        name: "nbg1",
        description: "Nuremberg DC Park 1",
        country: "DE",
        city: "Nuremberg",
        latitude: 49.452_02,
        longitude: 11.076_75,
        network_zone: "eu-central"
      }],
      meta: { pagination: _pagination }
    }
  })
  assert.strictEqual(decoded.locations[0]?.name, "nbg1")
  assert.strictEqual(decoded.meta.pagination.previous_page, null)
})

it("rejects a list-locations response missing a required pagination field (error-mapping)", () => {
  const error = decodeFixtureFails({
    schema: ListLocations200,
    fixture: { locations: [], meta: { pagination: { page: 1, per_page: 25, previous_page: null, next_page: null, last_page: 1 } } }
  })
  assert.isDefined(error)
})
