import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer } from "effect"
import * as BunServices from "@effect/platform-bun/BunServices"
import { Command } from "effect/cli"
import * as HttpClient from "effect/http/HttpClient"
import { assert, it } from "@effect/vitest"
import { makeStorageClient } from "@kumulo/storage-ovh"
import { makeMksClient } from "@kumulo/distro-ovh-mks"
import { makeFakeZone } from "../../../godaddy/dns/test/provider/fake-zone.ts"
import { kumuloCli } from "../../src/commands.ts"
import { fakeCredentials } from "./fake-credentials.ts"
import { MksEnv } from "../../src/mks/env.ts"
import { OpenStackEnv } from "../../src/doctor-openstack/env.ts"
import { StorageEnv } from "../../src/storage/env.ts"
import { makeFakeMksServer } from "../e2e/fake-mks-server.ts"
import { makeFakeCinder } from "./fake-cinder.ts"
import { unavailableUpcloudEnvLayer } from "../fake-upcloud-env.ts"

const _yaml = (dns: string) => `
name: staging
provider: ovh
distro: ovh-mks
version: "1.31.0"
auth:
  method: application_credential
  region: GRA5
worker_pools: []
dns:
${dns}
volumes:
  module: none
object_storage:
  module: none
secrets:
  sink: none
`

const _godaddy = `  module: godaddy
  zone: example.com
  ttl: 600
  records:
    - name: api
      target: 203.0.113.5`

const _path = (dns: string) => {
  const path = join(mkdtempSync(join(tmpdir(), "kumulo-godaddy-")), "cluster.yaml")
  writeFileSync(path, _yaml(dns))

  return path
}

process.stdout.isTTY = false

const _storageLayer = Layer.succeed(StorageEnv, {
  storage: makeStorageClient(HttpClient.make(() => Effect.die("object storage must not be reached"))),
  serviceName: ""
})

const _openStackEnvLayer = Layer.succeed(OpenStackEnv, {
  keystone: undefined,
  region: undefined,
  unavailableReason: "not used"
})

const _run = ({ args, fake }: { readonly args: ReadonlyArray<string>; readonly fake: ReturnType<typeof makeFakeZone> }) =>
  Effect.gen(function*() {
    const server = makeFakeMksServer()
    const calls: Array<string> = []

    const recordingMks = server.httpClient.pipe(
      HttpClient.mapRequest((request) => {
        calls.push(`${request.method} ${request.url}`)

        return request
      })
    )

    const result = yield* Command.runWith(kumuloCli, { version: "test" })([...args]).pipe(
      Effect.provide(Layer.succeed(HttpClient.HttpClient, fake.httpClient)),
      Effect.provide(Layer.succeed(MksEnv, { mks: makeMksClient(recordingMks), serviceName: "service-1" })),
      Effect.provide(makeFakeCinder({})),
      Effect.provide(_openStackEnvLayer),
      Effect.provide(unavailableUpcloudEnvLayer),
      Effect.provide(_storageLayer),
      Effect.provide(fakeCredentials),
      Effect.provide(BunServices.layer),
      Effect.result
    )

    return { result, server, calls }
  })

it.effect("a 403 preflight aborts apply before any cluster or dns write", () =>
  Effect.gen(function*() {
    const fake = makeFakeZone({ zone: "example.com", forbiddenCode: "ACCESS_DENIED" })
    const { calls, result, server } = yield* _run({ args: ["apply", _path(_godaddy), "--yes"], fake })

    assert.strictEqual(result._tag, "Failure")
    assert.strictEqual(server.clusters.size, 0)
    assert.deepStrictEqual(calls, [])
    assert.strictEqual(fake.writes().length, 0)
    assert.strictEqual(fake.requests().length, 1)
  }))

it.effect("--dry-run reports the preflight failure", () =>
  Effect.gen(function*() {
    const fake = makeFakeZone({ zone: "example.com", forbiddenCode: "ACCESS_DENIED" })
    const { result } = yield* _run({ args: ["--dry-run", "apply", _path(_godaddy)], fake })

    assert.strictEqual(result._tag, "Failure")
    assert.include(JSON.stringify(result), "domains.dns:update")
  }))

it.effect("other dns modules never touch the godaddy API", () =>
  Effect.gen(function*() {
    const fake = makeFakeZone({ zone: "example.com", forbiddenCode: "ACCESS_DENIED" })
    const { server } = yield* _run({ args: ["apply", _path("  module: none"), "--yes"], fake })

    assert.strictEqual(fake.requests().length, 0)
    assert.strictEqual(server.clusters.size, 1)
  }))

it.effect("a 403 preflight aborts delete before any cluster or dns write", () =>
  Effect.gen(function*() {
    const fake = makeFakeZone({ zone: "example.com", forbiddenCode: "ACCESS_DENIED" })
    const { calls, result } = yield* _run({ args: ["delete", _path(_godaddy), "--yes"], fake })

    assert.strictEqual(result._tag, "Failure")
    assert.deepStrictEqual(calls, [])
    assert.strictEqual(fake.writes().length, 0)
    assert.strictEqual(fake.requests().length, 1)
  }))

it.effect("--dry-run delete reports the preflight failure", () =>
  Effect.gen(function*() {
    const fake = makeFakeZone({ zone: "example.com", forbiddenCode: "ACCESS_DENIED" })
    const { result } = yield* _run({ args: ["--dry-run", "delete", _path(_godaddy)], fake })

    assert.strictEqual(result._tag, "Failure")
    assert.include(JSON.stringify(result), "domains.dns:update")
  }))
