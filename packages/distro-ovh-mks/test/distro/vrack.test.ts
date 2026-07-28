import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { CapabilityMissing, ResourceNotFound } from "@kumulo/core"
import { makeMksClient } from "../../src/client/mks.ts"
import { requireVrack } from "../../src/distro/vrack.ts"

const _ref = { serviceName: "service-1", region: "GRA5" }

// One route, one response — the check has exactly one call to make.
const _fakeOvh = (response: () => Response) => {
  const calls: Array<{ readonly method: string; readonly url: string }> = []
  const httpClient = HttpClient.make((request) => {
    calls.push({ method: request.method, url: request.url })
    return Effect.succeed(HttpClientResponse.fromWeb(request, response()))
  }).pipe(HttpClient.mapRequest(HttpClientRequest.prependUrl("https://fixture.invalid")))
  return { calls, mks: makeMksClient(httpClient) }
}

const _json = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status })

describe("requireVrack", () => {
  it.effect("succeeds when the project has a linked vRack, reading only", () => {
    const fake = _fakeOvh(_json(200, { id: "pn-vrack-1234", name: "vrack-1234" }))
    return Effect.gen(function*() {
      yield* requireVrack({ mks: fake.mks, ..._ref })
      expect(fake.calls.map((call) => call.method)).toEqual(["GET"])
      expect(fake.calls[0]?.url).toContain("/cloud/project/service-1/vrack")
    })
  })

  it.effect("fails with CapabilityMissing naming the project and the remedy when OVH reports no vRack", () => {
    const fake = _fakeOvh(_json(404, { message: "This service does not exist" }))
    return Effect.gen(function*() {
      const error = yield* Effect.flip(requireVrack({ mks: fake.mks, ..._ref }))
      expect(error).toBeInstanceOf(CapabilityMissing)
      expect(error).not.toBeInstanceOf(ResourceNotFound)
      if (error._tag !== "CapabilityMissing") throw new Error(`expected CapabilityMissing, got ${error._tag}`)
      expect(error.capability).toBe("vrack")
      expect(error.region).toBe("GRA5")
      expect(error.workaround).toContain("service-1")
      expect(error.workaround).toContain("vRack")
    })
  })

  it.effect("fails with CapabilityMissing when the vRack payload carries no id", () => {
    const fake = _fakeOvh(_json(200, {}))
    return Effect.gen(function*() {
      const error = yield* Effect.flip(requireVrack({ mks: fake.mks, ..._ref }))
      expect(error).toBeInstanceOf(CapabilityMissing)
    })
  })

  it.effect("does not swallow a real API failure as a missing vRack", () => {
    const fake = _fakeOvh(_json(500, { message: "boom" }))
    return Effect.gen(function*() {
      const error = yield* Effect.flip(requireVrack({ mks: fake.mks, ..._ref }))
      expect(error).not.toBeInstanceOf(CapabilityMissing)
      expect(error._tag).toBe("ProviderApiError")
    })
  })
})
