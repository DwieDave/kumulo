import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { AuthenticationFailed } from "@kumulo/core"
import { deleteVolume, ensureVolume, listClusterVolumes, type VolumeProviderOptions } from "../src/provider.ts"
import { makeFakeCinder } from "./fake-cinder.ts"

const options: VolumeProviderOptions = { tag: "prod" }
const spec = { name: "postgres-data", sizeGb: 100, type: "high-speed", retain: true }

describe("volumes-cinder VolumeProvider", () => {
  it.effect("ensureVolume creates then reuses by tag+name", () => {
    let created = false
    const fake = makeFakeCinder({
      "GET /volumes/detail": () =>
        created
          ? { status: 200, body: { volumes: [{ id: "vol-1", name: "postgres-data", metadata: { kumulo_cluster: "prod" } }] } }
          : { status: 200, body: { volumes: [] } },
      "POST /volumes": () => {
        created = true
        return { status: 202, body: { volume: { id: "vol-1", name: "postgres-data" } } }
      }
    })
    return Effect.gen(function*() {
      const first = yield* ensureVolume({ options, spec })
      const second = yield* ensureVolume({ options, spec })
      expect(first).toEqual({ id: "vol-1", name: "postgres-data" })
      expect(second).toEqual({ id: "vol-1", name: "postgres-data" })
      expect(fake.calls().filter((call) => call.method === "POST").length).toBe(1)
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("ensureVolume ignores same-name volumes tagged for a different cluster", () => {
    const fake = makeFakeCinder({
      "GET /volumes/detail": () => ({
        status: 200,
        body: { volumes: [{ id: "vol-other", name: "postgres-data", metadata: { kumulo_cluster: "staging" } }] }
      }),
      "POST /volumes": () => ({ status: 202, body: { volume: { id: "vol-1", name: "postgres-data" } } })
    })
    return Effect.gen(function*() {
      const info = yield* ensureVolume({ options, spec })
      expect(info).toEqual({ id: "vol-1", name: "postgres-data" })
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("listClusterVolumes filters by tag only", () => {
    const fake = makeFakeCinder({
      "GET /volumes/detail": () => ({
        status: 200,
        body: {
          volumes: [
            { id: "vol-1", name: "a", metadata: { kumulo_cluster: "prod" } },
            { id: "vol-2", name: "b", metadata: { kumulo_cluster: "staging" } }
          ]
        }
      })
    })
    return Effect.gen(function*() {
      const volumes = yield* listClusterVolumes("prod")
      expect(volumes).toEqual([{ id: "vol-1", name: "a" }])
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("deleteVolume tolerates an already-gone volume (404)", () => {
    const fake = makeFakeCinder({ "DELETE /volumes/vol-1": () => ({ status: 404 }) })
    return Effect.gen(function*() {
      yield* deleteVolume({ id: "vol-1" })
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("surfaces a genuine transport failure as a tagged VolumeError", () => {
    const fake = makeFakeCinder({ "DELETE /volumes/vol-1": () => ({ status: 500 }) })
    return Effect.gen(function*() {
      const failure = yield* Effect.flip(deleteVolume({ id: "vol-1" }))
      expect(failure).toBeInstanceOf(AuthenticationFailed)
    }).pipe(Effect.provide(fake.layer))
  })
})
