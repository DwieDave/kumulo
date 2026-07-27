import { Effect, Layer } from "effect"
import { layerNoop } from "effect/FileSystem"
import * as HttpClient from "effect/unstable/http/HttpClient"
import { assert, it } from "@effect/vitest"
import { AuthenticationFailed, parseConfigYaml } from "@kumulo/core"
import { CinderAuth, parseOutputsYaml, stringifyOutputsYaml } from "@kumulo/volumes-cinder"
import type { OutputsFile } from "@kumulo/volumes-cinder"
import { convergeManagedVolumes, reconcileVolumesOnDelete } from "../../src/commands/volumes.ts"
import { makeFakeCinder } from "./fake-cinder.ts"

const _yaml = `
name: staging
provider: ovh
distro: ovh-mks
version: "1.31.0"
auth:
  method: application_credential
  region: GRA5
network:
  cidr: 10.0.0.0/16
  public_access: nat
api_server:
  high_availability: true
  allowed_cidrs: ["0.0.0.0/0"]
ssh:
  public_key_path: ~/.ssh/id_ed25519.pub
  allowed_cidrs: ["0.0.0.0/0"]
masters:
  flavor: b2-7
  count: 3
  image: ubuntu-22.04
worker_pools: []
dns:
  module: none
  zone: unused.example.com
  ttl: 300
  records: []
volumes:
  module: cinder
  managed:
    - name: keep-me
      size_gb: 50
      type: high-speed
      retain: true
    - name: drop-me
      size_gb: 10
      type: classic
      retain: false
object_storage:
  module: none
  buckets: []
secrets:
  sink: none
  dir: .
addons:
  cloud_controller_manager: true
  cinder_csi:
    enabled: true
    default_volume_type: high-speed
  hcloud_csi:
    enabled: false
  system_upgrade_controller: false
  cni: flannel
k3s:
  extra_server_args: []
  extra_agent_args: []
`

// `delete` retains `retain: true` volumes and prints what it kept;
// non-retained entries recorded in config are actually deleted.
it.effect("keeps retain:true volumes and deletes the rest", () =>
  Effect.gen(function*() {
    const config = yield* parseConfigYaml(_yaml)
    const deletedIds: Array<string> = []
    const fakeCinder = makeFakeCinder({
      "GET /volumes/detail": () => ({
        status: 200,
        body: {
          volumes: [
            { id: "vol-keep", name: "keep-me", metadata: { kumulo_cluster: "staging" } },
            { id: "vol-drop", name: "drop-me", metadata: { kumulo_cluster: "staging" } }
          ]
        }
      }),
      "DELETE /volumes/vol-drop": () => {
        deletedIds.push("vol-drop")
        return { status: 204 }
      }
    })

    const result = yield* reconcileVolumesOnDelete(config).pipe(Effect.provide(fakeCinder))

    assert.deepStrictEqual(result.kept, ["keep-me"])
    assert.deepStrictEqual(result.deleted, ["drop-me"])
    assert.deepStrictEqual(deletedIds, ["vol-drop"])
  }))

it.effect("no-ops when volumes.module isn't cinder", () =>
  Effect.gen(function*() {
    const config = yield* parseConfigYaml(_yaml.replace("module: cinder", "module: none"))
    const fakeCinder = makeFakeCinder({})
    const result = yield* reconcileVolumesOnDelete(config).pipe(Effect.provide(fakeCinder))
    assert.deepStrictEqual(result, { kept: [], deleted: [] })
  }))

// in-memory FileSystem covering just `exists`/`readFileString`/`writeFileString`,
// same pattern as `storage/reconcile.test.ts`'s `_fakeFs`; also exposes the
// backing store so tests can inspect what got written.
const _fakeFs = (seed: Record<string, string> = {}) => {
  const store = new Map(Object.entries(seed))
  const layer = layerNoop({
    exists: (path) => Effect.succeed(store.has(path)),
    readFileString: (path) => Effect.succeed(store.get(path) ?? ""),
    writeFileString: (path, data) =>
      Effect.sync(() => {
        store.set(path, data)
      })
  })
  return { layer, store }
}

const _outputsSeed = (dir: string, file: OutputsFile): Record<string, string> => ({
  [`${dir}/${file.cluster}.outputs.yaml`]: stringifyOutputsYaml(file)
})

it.effect("convergeManagedVolumes ensures each managed volume and records its id in outputs", () =>
  Effect.gen(function*() {
    const config = yield* parseConfigYaml(_yaml)
    let created = 0
    const fakeCinder = makeFakeCinder({
      "GET /volumes/detail": () => ({ status: 200, body: { volumes: [] } }),
      "POST /volumes": () => {
        created += 1
        return { status: 200, body: { volume: { id: `vol-${created}`, name: "unused" } } }
      }
    })
    const fs = _fakeFs()

    yield* convergeManagedVolumes({ config, configDir: "." }).pipe(Effect.provide(Layer.merge(fakeCinder, fs.layer)))

    assert.strictEqual(created, 2)
    const written = yield* parseOutputsYaml(fs.store.get("./staging.outputs.yaml") ?? "")
    assert.deepStrictEqual(written.volumes.map((v) => v.name).toSorted(), ["drop-me", "keep-me"])
    assert.deepStrictEqual(written.volumes.find((v) => v.name === "keep-me")?.retain, true)
    assert.deepStrictEqual(written.volumes.find((v) => v.name === "drop-me")?.retain, false)
  }))

it.effect("convergeManagedVolumes reuses an already-recorded volume id without recreating it", () =>
  Effect.gen(function*() {
    const config = yield* parseConfigYaml(_yaml)
    const seed = _outputsSeed(".", {
      cluster: "staging",
      volumes: [{ name: "keep-me", id: "vol-existing", retain: true }]
    })
    let created = 0
    const fakeCinder = makeFakeCinder({
      "GET /volumes/detail": () => ({
        status: 200,
        body: { volumes: [{ id: "vol-existing", name: "keep-me", metadata: { kumulo_cluster: "staging" } }] }
      }),
      "POST /volumes": () => {
        created += 1
        return { status: 200, body: { volume: { id: "vol-drop-me", name: "drop-me" } } }
      }
    })
    const fs = _fakeFs(seed)

    yield* convergeManagedVolumes({ config, configDir: "." }).pipe(Effect.provide(Layer.merge(fakeCinder, fs.layer)))

    // only `drop-me` is missing from Cinder's tagged list, `keep-me` is reused.
    assert.strictEqual(created, 1)
    const written = yield* parseOutputsYaml(fs.store.get("./staging.outputs.yaml") ?? "")
    assert.deepStrictEqual(written.volumes.find((v) => v.name === "keep-me")?.id, "vol-existing")
  }))

it.effect("convergeManagedVolumes no-ops when volumes.module isn't cinder", () =>
  Effect.gen(function*() {
    const config = yield* parseConfigYaml(_yaml.replace("module: cinder", "module: none"))
    const fakeCinder = makeFakeCinder({})
    const fs = _fakeFs()
    yield* convergeManagedVolumes({ config, configDir: "." }).pipe(Effect.provide(Layer.merge(fakeCinder, fs.layer)))
    assert.strictEqual(fs.store.size, 0)
  }))

// A missing OS_* env var (surfaced as `CinderAuth`'s
// `AuthenticationFailed`, see `volumes/env.ts`'s `CinderAuthLive`) must
// propagate, never be swallowed into a silent no-op.
it.effect("convergeManagedVolumes fails with AuthenticationFailed when OpenStack credentials are missing, never a silent skip", () =>
  Effect.gen(function*() {
    const config = yield* parseConfigYaml(_yaml)
    const failingAuth = Layer.succeed(CinderAuth, {
      token: Effect.fail(new AuthenticationFailed({ hint: "missing required env var OS_AUTH_URL" })),
      endpoint: Effect.fail(new AuthenticationFailed({ hint: "missing required env var OS_AUTH_URL" }))
    })
    // The generated Cinder client reads `HttpClient.HttpClient` from context
    // before it reads `auth.endpoint` — a client must be present even though the
    // auth failure means it's never actually used to send a request.
    const deadHttpClient = Layer.succeed(HttpClient.HttpClient, HttpClient.make(() => Effect.die("unreachable")))

    const failure = yield* convergeManagedVolumes({ config, configDir: "." }).pipe(
      Effect.provide(Layer.mergeAll(failingAuth, deadHttpClient, _fakeFs().layer)),
      Effect.flip
    )

    assert.strictEqual(failure._tag, "AuthenticationFailed")
    if (failure._tag === "AuthenticationFailed") assert.match(failure.hint, /OS_AUTH_URL/)
  }))
