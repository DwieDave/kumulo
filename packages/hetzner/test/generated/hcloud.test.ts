import { assert, it } from "@effect/vitest"
import { FastCheck as fc } from "effect/testing"
import { CreatePlacementGroupRequestJson, GetAction200, ListServerTypes200 } from "../../src/generated/hcloud.ts"
import { decodeFixture, decodeFixtureFails, encodeFixture } from "./decode.ts"

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

const _serverType = {
  id: 1,
  name: "cx22",
  description: "CX22",
  cores: 2,
  memory: 4,
  disk: 40,
  deprecated: false,
  prices: [],
  storage_type: "local",
  cpu_type: "shared",
  architecture: "x86",
  deprecation: null,
  category: "shared-x86",
  locations: [],
  included_traffic: null
}

const _pagination = { page: 1, per_page: 25, previous_page: null, next_page: null, last_page: 1, total_entries: 1 }

it("decodes a list-server-types response, including a null pagination field (happy path)", () => {
  const decoded = decodeFixture({
    schema: ListServerTypes200,
    fixture: {
      server_types: [_serverType],
      meta: { pagination: _pagination }
    }
  })
  assert.strictEqual(decoded.server_types[0]?.name, "cx22")
  assert.strictEqual(decoded.meta.pagination.previous_page, null)
})

it("rejects a list-server-types response missing a required pagination field (error-mapping)", () => {
  const error = decodeFixtureFails({
    schema: ListServerTypes200,
    fixture: { server_types: [], meta: { pagination: { page: 1, per_page: 25, previous_page: null, next_page: null, last_page: 1 } } }
  })
  assert.isDefined(error)
})

// Guards the free-form-map fix: `labels` must be a real string->string map, not an
// empty struct that only survives because unknown keys happen to be preserved. If it
// regressed to `Struct({})`, arbitrary keys would be dropped on encode and resources
// would be created unlabelled — invisible to tag-based teardown.
it.prop("round-trips arbitrary label maps through encode -> decode", [fc.dictionary(fc.string(), fc.string())], ([labels]) => {
  const schema = CreatePlacementGroupRequestJson
  const encoded = encodeFixture({ schema, value: { name: "pg", type: "spread", labels } })
  assert.deepStrictEqual(decodeFixture({ schema, fixture: encoded }).labels, labels)
})
