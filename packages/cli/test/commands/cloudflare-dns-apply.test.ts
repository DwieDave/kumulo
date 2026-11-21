import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ConfigProvider, Effect, Layer } from "effect"
import * as BunServices from "@effect/platform-bun/BunServices"
import { Command } from "effect/cli"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import { TestConsole } from "effect/testing"
import { assert, it } from "@effect/vitest"
import { makeStorageClient } from "@kumulo/storage-ovh"
import { makeMksClient } from "@kumulo/distro-ovh-mks"
import {
  makeNetworkClient,
  makeNodeGroupsClient,
  makeObjectStorageClient,
  makeRouterClient,
  makeStorageClient as makeUpcloudStorageClient,
  makeUksClient,
  makeZoneClient
} from "@kumulo/upcloud"
import { makeFakeZone } from "../../../cloudflare/dns/test/provider/fake-zone.ts"
import { makeFakeUksServer } from "../../../upcloud/distro-uks/test/distro/fake-uks-server.ts"
import { kumuloCli } from "../../src/commands.ts"
import { MksEnv } from "../../src/mks/env.ts"
import { OpenStackEnv } from "../../src/openstack/env.ts"
import { StorageEnv } from "../../src/storage/env.ts"
import { UpcloudEnv } from "../../src/upcloud/env.ts"
import { makeFakeMksServer } from "../e2e/fake-mks-server.ts"
import { makeFakeCinder } from "./fake-cinder.ts"

process.stdout.isTTY = false

const _LB = "203.0.113.10"

const _apiRecord = { name: "api.staging-eu", target: "api_server" }

const _lbRecords = [
  { name: "*", target: _LB },
  { name: "*.c1", target: _LB },
  { name: "@", target: _LB }
]

const _configPath = (records: ReadonlyArray<{ readonly name: string; readonly target: string }>) => {
  const path = join(mkdtempSync(join(tmpdir(), "kumulo-uks-cloudflare-")), "cluster.json")

  writeFileSync(
    path,
    JSON.stringify({
      name: "staging-eu",
      provider: "upcloud",
      distro: "upcloud-uks",
      version: "1.31",
      zone: "de-fra1",
      auth: { method: "api_token", region: "de-fra1" },
      network: { cidr: "10.0.0.0/16" },
      worker_pools: [{ name: "general", flavor: "2xCPU-4GB", count: 1 }],
      dns: { module: "cloudflare", zone: "example.com", ttl: 300, records },
      volumes: { module: "none" },
      object_storage: { module: "none" },
      secrets: { sink: "none" }
    })
  )

  return path
}

const _credentials = Layer.succeed(
  ConfigProvider.ConfigProvider,
  ConfigProvider.fromEnv({
    env: { UPCLOUD_API_TOKEN: "test-upcloud-token", CLOUDFLARE_API_TOKEN: "test-cloudflare-token", CLOUDFLARE_API_BASE_URL: "https://fixture.invalid" }
  })
)

const _kubeconfig = [
  "apiVersion: v1",
  "clusters:",
  "  - cluster:",
  "      server: https://abc123.upcloud.k8s.io:6443",
  "    name: uks",
  "users:",
  "  - name: uks",
  "    user:",
  "      token: shhh"
].join("\n")

// the fake server's kubeconfig names no cluster, and the api_server record needs a server hostname
const _withKubeconfig = (server: ReturnType<typeof makeFakeUksServer>) =>
  server.httpClient.pipe(
    HttpClient.transformResponse(Effect.map((response) =>
      response.request.url.endsWith("/kubeconfig")
        ? HttpClientResponse.fromWeb(response.request, Response.json({ kubeconfig: _kubeconfig }))
        : response
    ))
  )

const _upcloudEnv = (server: ReturnType<typeof makeFakeUksServer>) => {
  const http = _withKubeconfig(server)

  return Layer.succeed(UpcloudEnv, {
    clients: {
      uks: makeUksClient(http),
      nodeGroups: makeNodeGroupsClient(http),
      network: makeNetworkClient(http),
      router: makeRouterClient(http)
    },
    zones: makeZoneClient(http),
    storage: makeUpcloudStorageClient(http),
    objectStorage: makeObjectStorageClient(http)
  })
}

const _unusedEnvs = Layer.mergeAll(
  Layer.succeed(MksEnv, { mks: makeMksClient(makeFakeMksServer().httpClient), serviceName: "service-1" }),
  Layer.succeed(OpenStackEnv, { keystone: undefined, region: undefined, unavailableReason: "not used" }),
  Layer.succeed(StorageEnv, {
    storage: makeStorageClient(HttpClient.make(() => Effect.die("object storage must not be reached"))),
    serviceName: ""
  }),
  makeFakeCinder({})
)

const _run = (
  { args, server, zone }: {
    readonly args: ReadonlyArray<string>
    readonly server: ReturnType<typeof makeFakeUksServer>
    readonly zone: ReturnType<typeof makeFakeZone>
  }
) =>
  Effect.gen(function*() {
    yield* Command.runWith(kumuloCli, { version: "test" })([...args])

    return (yield* TestConsole.logLines).map(String).join("\n")
  }).pipe(
    Effect.provide(TestConsole.layer),
    Effect.provide(Layer.succeed(HttpClient.HttpClient, zone.httpClient)),
    Effect.provide(_upcloudEnv(server)),
    Effect.provide(_unusedEnvs),
    Effect.provide(_credentials),
    Effect.provide(BunServices.layer)
  )

const _converged = () =>
  Effect.gen(function*() {
    const server = makeFakeUksServer({ readyAfterPolls: 0 })
    const zone = makeFakeZone({ zone: "example.com" })
    yield* _run({ args: ["apply", _configPath([_apiRecord]), "--yes"], server, zone })

    return { server, zone }
  })

it.effect("a dns-only change on a live cluster writes the new records", () =>
  Effect.gen(function*() {
    const { server, zone } = yield* _converged()
    assert.strictEqual(server.clusters.size, 1)
    assert.strictEqual(zone.peek({ name: "api.staging-eu", type: "CNAME" })?.content, "abc123.upcloud.k8s.io")

    yield* _run({ args: ["apply", _configPath([_apiRecord, ..._lbRecords]), "--yes"], server, zone })

    for (const { name } of _lbRecords) {
      assert.strictEqual(zone.peek({ name, type: "A" })?.content, _LB, name)
      assert.strictEqual(zone.peek({ name, type: "A" })?.proxied, false, name)
    }

    assert.strictEqual(server.clusters.size, 1)
  }))

it.effect("a re-run repairs a record deleted behind kumulo's back", () =>
  Effect.gen(function*() {
    const { server, zone } = yield* _converged()
    const path = _configPath([_apiRecord, ..._lbRecords])
    yield* _run({ args: ["apply", path, "--yes"], server, zone })

    const lost = zone.peek({ name: "*", type: "A" })
    assert.isDefined(lost)
    yield* zone.dns.deleteRecord({ zone: "example.com", zoneId: zone.zoneId, recordId: lost?.id ?? "" })
    assert.isUndefined(zone.peek({ name: "*", type: "A" }))

    yield* _run({ args: ["apply", path, "--yes"], server, zone })
    assert.strictEqual(zone.peek({ name: "*", type: "A" })?.content, _LB)
  }))

it.effect("--dry-run lists the dns rows and writes nothing", () =>
  Effect.gen(function*() {
    const { server, zone } = yield* _converged()
    const writes = zone.writes().length

    const output = yield* _run({ args: ["--dry-run", "apply", _configPath([_apiRecord, ..._lbRecords])], server, zone })

    for (const row of ["dns/example.com/* (A)", "dns/example.com/*.c1 (A)", "dns/example.com/@ (A)", "dns/example.com/api.staging-eu (CNAME)"]) {
      assert.include(output, row)
    }

    assert.strictEqual(zone.writes().length, writes)
  }))

it.effect("a zone the token cannot see stops apply before the cluster is created", () =>
  Effect.gen(function*() {
    const server = makeFakeUksServer({ readyAfterPolls: 0 })
    const zone = makeFakeZone({ zone: "example.com", visible: false })

    const error = yield* Effect.flip(_run({ args: ["apply", _configPath([_apiRecord, ..._lbRecords]), "--yes"], server, zone }))

    assert.strictEqual(error._tag, "ResourceNotFound")
    assert.strictEqual(server.clusters.size, 0)
    assert.strictEqual(zone.writes().length, 0)
  }))
