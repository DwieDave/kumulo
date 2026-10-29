import { assert, it } from "@effect/vitest"
import { Effect, Option, Schema } from "effect"
import { HttpTransportError } from "../../src/errors/tagged.ts"
import type { K8sManifest } from "../../src/domain/types.ts"
import { installAddons } from "../../src/k8s/addon.ts"
import type { Addon } from "../../src/k8s/addon.ts"
import type { K8sClient } from "../../src/k8s/client.ts"

const _metadataName = Schema.decodeUnknownOption(Schema.Struct({ name: Schema.String }))

const _nameOf = (manifest: K8sManifest): string =>
  Option.match(_metadataName(manifest.metadata), { onNone: () => "", onSome: ({ name }) => name })

const _manifest = (kind: string, name: string): K8sManifest => ({ apiVersion: "v1", kind, metadata: { name } })

const _fakeK8sClient = (log: Array<string>, failOn?: string): K8sClient["Service"] => ({
  get: () => Effect.die("unused"),
  list: () => Effect.die("unused"),
  apply: (_ref, manifest) => {
    const entry = `${manifest.kind}:${_nameOf(manifest)}`

    if (entry === failOn) return Effect.fail(new HttpTransportError({ cause: "boom" }))
    log.push(entry)

    return Effect.succeed(manifest)
  },
  delete: () => Effect.die("unused"),
  evict: () => Effect.die("unused")
})

const addons: ReadonlyArray<Addon> = [
  { name: "a", manifests: [_manifest("ServiceAccount", "a1"), _manifest("DaemonSet", "a2")] },
  { name: "b", manifests: [_manifest("Secret", "b1")] }
]

it.effect("installs addon manifests in array order, addon-by-addon", () =>
  Effect.gen(function*() {
    const log: Array<string> = []

    yield* installAddons({ k8sClient: _fakeK8sClient(log), addons })

    assert.deepStrictEqual(log, ["ServiceAccount:a1", "DaemonSet:a2", "Secret:b1"])
  }))

it.effect("an empty addon list installs nothing", () =>
  Effect.gen(function*() {
    const log: Array<string> = []

    yield* installAddons({ k8sClient: _fakeK8sClient(log), addons: [] })

    assert.deepStrictEqual(log, [])
  }))

it.effect("an apply failure maps to AddonInstallFailed and stops later addons", () =>
  Effect.gen(function*() {
    const log: Array<string> = []

    const error = yield* installAddons({ k8sClient: _fakeK8sClient(log, "DaemonSet:a2"), addons }).pipe(Effect.flip)

    assert.strictEqual(error._tag, "AddonInstallFailed")
    assert.strictEqual(error.addon, "a")
    assert.deepStrictEqual(log, ["ServiceAccount:a1"])
  }))
