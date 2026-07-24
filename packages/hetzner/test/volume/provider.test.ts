import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { ResourceConflict } from "@kumulo/core"
import { deleteVolume, ensureVolume, listClusterVolumes, type VolumeProviderOptions } from "../../src/volume/provider.ts"
import { makeFakeHcloud } from "../provider/fake-hcloud.ts"

const options: VolumeProviderOptions = { tag: "prod", location: "fsn1" }
const spec = { name: "postgres-data", sizeGb: 20, type: "hcloud-volumes", retain: true }

describe("hetzner VolumeProvider", () => {
  it.effect("ensureVolume creates then reuses by name", () => {
    let created = false
    const fake = makeFakeHcloud({
      "GET /volumes": () =>
        created
          ? { status: 200, body: { volumes: [{ id: 1, name: "postgres-data", size: 20 }] } }
          : { status: 200, body: { volumes: [] } },
      "POST /volumes": () => {
        created = true
        return { status: 201, body: { volume: { id: 1, name: "postgres-data", size: 20 } } }
      }
    })
    return Effect.gen(function*() {
      const first = yield* ensureVolume({ options, spec })
      const second = yield* ensureVolume({ options, spec })
      expect(first).toEqual({ id: "1", name: "postgres-data" })
      expect(second).toEqual({ id: "1", name: "postgres-data" })
      expect(fake.calls().filter((call) => call.method === "POST").length).toBe(1)
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("ensureVolume rounds a below-minimum request up to 10Gi on create", () => {
    const fake = makeFakeHcloud({
      "GET /volumes": () => ({ status: 200, body: { volumes: [] } }),
      "POST /volumes": () => ({ status: 201, body: { volume: { id: 2, name: "small", size: 10 } } })
    })
    return Effect.gen(function*() {
      const info = yield* ensureVolume({ options, spec: { name: "small", sizeGb: 3, type: "hcloud-volumes", retain: false } })
      expect(info).toEqual({ id: "2", name: "small" })
      expect(fake.calls().filter((call) => call.method === "POST").length).toBe(1)
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("ensureVolume enlarges an existing volume when the requested size grew", () => {
    let resized = false
    const fake = makeFakeHcloud({
      "GET /volumes": () => ({
        status: 200,
        body: { volumes: [{ id: 1, name: "postgres-data", size: resized ? 50 : 20 }] }
      }),
      "POST /volumes/1/actions/resize": () => {
        resized = true
        return { status: 201, body: { action: { id: 9 } } }
      }
    })
    return Effect.gen(function*() {
      const info = yield* ensureVolume({ options, spec: { ...spec, sizeGb: 50 } })
      expect(info).toEqual({ id: "1", name: "postgres-data" })
      expect(fake.calls().some((call) => call.method === "POST" && call.url.includes("/volumes/1/actions/resize"))).toBe(true)
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("ensureVolume refuses a shrink with a tagged ResourceConflict naming old/new size", () => {
    const fake = makeFakeHcloud({
      "GET /volumes": () => ({ status: 200, body: { volumes: [{ id: 1, name: "postgres-data", size: 50 }] } })
    })
    return Effect.gen(function*() {
      const failure = yield* Effect.flip(ensureVolume({ options, spec: { ...spec, sizeGb: 20 } }))
      expect(failure).toBeInstanceOf(ResourceConflict)
      expect(failure._tag === "ResourceConflict" ? failure.ref : undefined).toBe("postgres-data: 50Gi -> 20Gi")
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("listClusterVolumes queries by the cluster label selector", () => {
    const fake = makeFakeHcloud({
      "GET /volumes": () => ({ status: 200, body: { volumes: [{ id: 1, name: "a", size: 20 }] } })
    })
    return Effect.gen(function*() {
      const volumes = yield* listClusterVolumes({ options })
      expect(volumes).toEqual([{ id: "1", name: "a" }])
      expect(fake.calls()[0]?.url).toContain("label_selector=kumulo-cluster%3Dprod")
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("deleteVolume tolerates an already-gone volume (404)", () => {
    const fake = makeFakeHcloud({ "DELETE /volumes/1": () => ({ status: 404 }) })
    return Effect.gen(function*() {
      yield* deleteVolume({ id: "1" })
    }).pipe(Effect.provide(fake.layer))
  })
})
