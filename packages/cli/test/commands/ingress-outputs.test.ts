import { Effect } from "effect"
import { layerNoop } from "effect/FileSystem"
import { assert, it } from "@effect/vitest"
import { parseOutputsYaml, upsertVolume, writeOutputs } from "@kumulo/volumes-cinder"
import { recordIngressOutputs } from "../../src/commands.ts"
import { baseMksEncodedConfig, decodeTestConfig } from "../fixtures.ts"

const _config = decodeTestConfig(baseMksEncodedConfig)
const _path = `/cfg/${_config.name}.outputs.yaml`
const _ingress = { load_balancer_id: "lb-1", floating_ip: "203.0.113.1" }

const _store = () => {
  const files = new Map<string, string>()
  return {
    read: () => files.get(_path) ?? "",
    layer: layerNoop({
      exists: (path: string) => Effect.succeed(files.has(path)),
      writeFileString: (path: string, data: string) => Effect.sync(() => void files.set(path, data)),
      readFileString: (path: string) => Effect.succeed(files.get(path) ?? "")
    })
  }
}

it.effect("records the LB id and floating IP in <cluster>.outputs.yaml", () => {
  const store = _store()
  return Effect.gen(function*() {
    yield* recordIngressOutputs({ config: _config, configDir: "/cfg", ingress: _ingress })
    const text = store.read()
    assert.deepStrictEqual((yield* parseOutputsYaml(text)).ingress, _ingress)
    for (const secret of ["accessKey", "secretKey", "password", "token"]) assert.notInclude(text, secret)
  }).pipe(Effect.provide(store.layer))
})

it.effect("preserves volume ids the volumes step already recorded", () => {
  const store = _store()
  return Effect.gen(function*() {
    const seeded = upsertVolume({
      file: { cluster: _config.name, volumes: [] },
      volume: { name: "data", id: "vol-1", retain: true }
    })
    yield* writeOutputs({ dir: "/cfg", file: seeded })
    yield* recordIngressOutputs({ config: _config, configDir: "/cfg", ingress: _ingress })
    const file = yield* parseOutputsYaml(store.read())
    assert.deepStrictEqual(file.volumes, seeded.volumes)
    assert.deepStrictEqual(file.ingress, _ingress)
  }).pipe(Effect.provide(store.layer))
})

it.effect("writes nothing when the config declared no ingress", () =>
  Effect.gen(function*() {
    yield* recordIngressOutputs({ config: _config, configDir: "/cfg", ingress: undefined })
  }).pipe(Effect.provide(layerNoop({
    writeFileString: () => Effect.die("outputs must not be written when there is no ingress")
  }))))
