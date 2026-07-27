import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { ResponseDecodeError } from "@kumulo/core"
import { decodeServerIp } from "../../src/provider/schemas.ts"

describe("decodeServerIp", () => {
  it.effect("reads the first address Nova reports", () =>
    Effect.gen(function*() {
      const ip = yield* decodeServerIp({ server: { addresses: { "kumulo-prod": [{ addr: "10.0.0.5" }] } } })
      expect(ip).toBe("10.0.0.5")
    }))

  it.effect("is empty while the server has no addresses yet", () =>
    Effect.gen(function*() {
      expect(yield* decodeServerIp({ server: { addresses: {} } })).toBe("")
      expect(yield* decodeServerIp({ server: { status: "BUILD" } })).toBe("")
    }))

  it("reports a malformed address map as ResponseDecodeError, never as an empty IP", async () => {
    const failure = await Effect.runPromise(Effect.flip(decodeServerIp({ server: { addresses: 42 } })))
    expect(failure).toBeInstanceOf(ResponseDecodeError)
    expect(failure).toMatchObject({ endpoint: "v2.1/servers" })
  })
})
