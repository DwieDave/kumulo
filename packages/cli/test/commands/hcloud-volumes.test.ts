import { ConfigProvider, Effect, Layer } from "effect"
import { assert, it } from "@effect/vitest"
import { makeFakeHcloud } from "../../../hetzner/client/test/provider/fake-hcloud.ts"
import * as fixture from "../../../hetzner/client/test/provider/fixtures.ts"
import { lookupManagedVolumeNames, usesGenericVolumes } from "../../src/commands/volumes.ts"
import { baseEncodedConfig, decodeTestConfig } from "../fixtures.ts"
import { makeFakeCinder } from "./fake-cinder.ts"

const _config = decodeTestConfig({
  ...baseEncodedConfig,
  provider: "hetzner",
  auth: { method: "api_token", region: "fsn1" },
  addons: { ...baseEncodedConfig.addons, csi: { enabled: false } },
  volumes: { module: "hcloud", managed: [{ name: "data", size_gb: 20, type: "hcloud-volumes", retain: false }] }
})

const _token = Layer.succeed(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv({ env: { HCLOUD_TOKEN: "t" } }))

it("hcloud volumes take the generic volume path", () => {
  assert.isTrue(usesGenericVolumes(_config))
})

it.effect("lookupManagedVolumeNames lists live hcloud volumes through the VolumeProvider port", () => {
  const fake = makeFakeHcloud({
    "GET /volumes": () => ({ status: 200, body: { volumes: [fixture.volume({ id: 1, name: "data", size: 20 })], meta: fixture.meta() } })
  })

  return Effect.gen(function*() {
    const names = yield* lookupManagedVolumeNames(_config)

    assert.deepStrictEqual([...names], ["data"])
  }).pipe(Effect.provide(Layer.mergeAll(makeFakeCinder({}), fake.layer, _token)))
})
