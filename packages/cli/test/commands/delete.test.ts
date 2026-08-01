import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer } from "effect"
import * as BunServices from "@effect/platform-bun/BunServices"
import { Command } from "effect/unstable/cli"
import * as HttpClient from "effect/unstable/http/HttpClient"
import { assert, it } from "@effect/vitest"
import { makeStorageClient } from "@kumulo/storage-ovh"
import { kumuloCli } from "../../src/commands.ts"
import { fakeCredentials } from "./fake-credentials.ts"
import { MksEnv } from "../../src/mks/env.ts"
import { OpenStackEnv } from "../../src/doctor-openstack/env.ts"
import { StorageEnv } from "../../src/storage/env.ts"
import { makeMksClient } from "@kumulo/distro-ovh-mks"
import { makeFakeMksServer } from "../e2e/fake-mks-server.ts"
import { makeFakeCinder } from "./fake-cinder.ts"
import { unavailableUpcloudEnvLayer } from "../fake-upcloud-env.ts"

const _yaml = `
name: staging
provider: ovh
distro: ovh-mks
version: "1.31.0"
auth:
  method: application_credential
  region: GRA5
worker_pools: []
dns:
  module: none
volumes:
  module: cinder
  managed:
    - name: drop-me
      size_gb: 10
      type: classic
      retain: false
object_storage:
  module: none
secrets:
  sink: none
`

const _configPath = join(mkdtempSync(join(tmpdir(), "kumulo-delete-")), "cluster.yaml")
writeFileSync(_configPath, _yaml)

process.stdout.isTTY = false

const _storageLayer = Layer.succeed(StorageEnv, {
  storage: makeStorageClient(HttpClient.make(() => Effect.die("object storage must not be reached"))),
  serviceName: ""
})

const _openStackEnvLayer = Layer.succeed(OpenStackEnv, {
  keystone: undefined,
  region: undefined,
  unavailableReason: "not used by the ovh-mks delete path"
})

const _runDelete = (args: ReadonlyArray<string>) =>
  Effect.gen(function*() {
    const timeline: Array<string> = []
    const server = makeFakeMksServer()
    server.clusters.set("kube-1", { id: "kube-1", name: "staging", status: "READY", url: "https://kube-1.fixture.mks.invalid" })
    server.pools.set("kube-1", new Map())
    const recordingMks = server.httpClient.pipe(
      HttpClient.mapRequest((request) => {
        timeline.push(`mks ${request.method} ${request.url}`)
        return request
      })
    )
    const cinder = makeFakeCinder({
      "GET /volumes/detail": () => {
        timeline.push("cinder list")
        return {
          status: 200,
          body: { volumes: [{ id: "vol-1", name: "drop-me", metadata: { kumulo_cluster: "staging" } }] }
        }
      },
      "DELETE /volumes/vol-1": () => {
        timeline.push("cinder delete")
        return { status: 202 }
      }
    })
    yield* Command.runWith(kumuloCli, { version: "test" })([...args]).pipe(
      Effect.provide(Layer.succeed(MksEnv, { mks: makeMksClient(recordingMks), serviceName: "service-1" })),
      Effect.provide(cinder),
      Effect.provide(_openStackEnvLayer),
      Effect.provide(unavailableUpcloudEnvLayer),
      Effect.provide(_storageLayer),
      Effect.provide(fakeCredentials),
      Effect.provide(BunServices.layer)
    )
    return { server, timeline }
  })

// order matters: cluster (and its attachments) must be gone before volumes are deleted, else disks are orphaned
it.effect("delete tears the cluster down before its volumes", () =>
  Effect.gen(function*() {
    const { server, timeline } = yield* _runDelete(["delete", _configPath, "--yes"])
    assert.isFalse(server.clusters.has("kube-1"))
    const clusterDeleted = timeline.findIndex((entry) =>
      entry.startsWith("mks DELETE") && entry.endsWith("/cloud/project/service-1/kube/kube-1")
    )
    const volumeDeleted = timeline.indexOf("cinder delete")
    assert.isAbove(clusterDeleted, -1)
    assert.isAbove(volumeDeleted, -1)
    assert.isBelow(clusterDeleted, volumeDeleted)
  }))

it.effect("delete without --yes on a non-TTY deletes nothing", () =>
  Effect.gen(function*() {
    const { server, timeline } = yield* _runDelete(["delete", _configPath])
    assert.isTrue(server.clusters.has("kube-1"))
    assert.notInclude(timeline, "cinder delete")
  }))
