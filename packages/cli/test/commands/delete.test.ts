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

// The whole apply/scale/delete orchestration (`commands.ts`) had no test at
// all: these drive the real `delete` command through `Command.runWith`, with
// only the two provider APIs faked, so the *ordering* and the confirm gate are
// observed rather than assumed.

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

// `commands.ts` reads `process.stdout.isTTY` at call time — pin the non-TTY
// branch so the confirm test asserts the CI behaviour regardless of how the
// suite was launched.
process.stdout.isTTY = false

const _storageLayer = Layer.succeed(StorageEnv, {
  storage: makeStorageClient(HttpClient.make(() => Effect.die("object storage must not be reached"))),
  serviceName: ""
})

// The distro service set is shared across distros, so `ovh-mks` now carries
// `OpenStackEnv` in R too — this run must never touch Keystone, so the stub
// mirrors the "unavailable" shape `OpenStackEnvLive` produces without creds.
const _openStackEnvLayer = Layer.succeed(OpenStackEnv, {
  keystone: undefined,
  region: undefined,
  unavailableReason: "not used by the ovh-mks delete path"
})

/** Live `delete` run against fake OVH + Cinder, returning the call timeline. */
const _runDelete = (args: ReadonlyArray<string>) =>
  Effect.gen(function*() {
    const timeline: Array<string> = []
    const server = makeFakeMksServer()
    server.clusters.set("kube-1", { id: "kube-1", name: "staging", status: "READY", url: "https://kube-1.fixture.mks.invalid" })
    server.pools.set("kube-1", new Map())
    // Record on the request side: re-wrapping `execute` would drop the fake
    // server's own `prependUrl`, leaving every call with a relative URL.
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
      Effect.provide(_storageLayer),
      Effect.provide(fakeCredentials),
      Effect.provide(BunServices.layer)
    )
    return { server, timeline }
  })

// Flipping the two steps orphans billable disks: the cluster must be gone
// (and its attachments with it) before any volume is deleted.
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

// Non-TTY + no `--yes`: `_confirm` must fail closed. A confirm that defaulted
// to "yes" off a TTY would delete a cluster from CI with no operator input.
it.effect("delete without --yes on a non-TTY deletes nothing", () =>
  Effect.gen(function*() {
    const { server, timeline } = yield* _runDelete(["delete", _configPath])
    assert.isTrue(server.clusters.has("kube-1"))
    assert.notInclude(timeline, "cinder delete")
  }))
