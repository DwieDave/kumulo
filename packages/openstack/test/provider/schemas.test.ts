import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit } from "effect"
import { ResourceNotFound } from "@kumulo/core"
import { decodeListField, decodeSingleField, NamedResource } from "../../src/provider/schemas.ts"

describe("decodeListField / decodeSingleField", () => {
  it("decodeListField fails with ResourceNotFound when the envelope's list field is missing", async () => {
    const decode = decodeListField({ itemSchema: NamedResource, listField: "networks", kind: "network" })
    const exit = await Effect.runPromiseExit(decode({ notNetworks: [] }))
    expect(Exit.isFailure(exit)).toBe(true)
    const failure = await Effect.runPromise(Effect.flip(decode({ notNetworks: [] })))
    expect(failure).toBeInstanceOf(ResourceNotFound)
  })

  it("decodeSingleField fails with ResourceNotFound when the wrapper field is missing", async () => {
    const decode = decodeSingleField({ itemSchema: NamedResource, field: "network", kind: "network" })
    const failure = await Effect.runPromise(Effect.flip(decode({ notNetwork: { id: "1" } })))
    expect(failure).toBeInstanceOf(ResourceNotFound)
  })

  it("decodeListField tolerates entries missing id/name (lenient FR-4.6 decode)", async () => {
    const decode = decodeListField({ itemSchema: NamedResource, listField: "networks", kind: "network" })
    const result = await Effect.runPromise(decode({ networks: [{ id: "net-1", extra: "ignored" }] }))
    expect(result).toEqual([{ id: "net-1" }])
  })
})
