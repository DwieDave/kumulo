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
import { makeFakeUksServer } from "../../../upcloud/distro-uks/test/distro/fake-uks-server.ts"
import { kumuloCli } from "../../src/commands.ts"
import { MksEnv } from "../../src/mks/env.ts"
import { OpenStackEnv } from "../../src/openstack/env.ts"
import { StorageEnv } from "../../src/storage/env.ts"
import { UpcloudEnv } from "../../src/upcloud/env.ts"
import { makeFakeMksServer } from "../e2e/fake-mks-server.ts"
import { makeFakeCinder } from "./fake-cinder.ts"

process.stdout.isTTY = false

const _configPath = (dns: { readonly module: "none"; readonly zone?: string } = { module: "none" }) => {
  const path = join(mkdtempSync(join(tmpdir(), "kumulo-manual-dns-")), "cluster.json")

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
      dns,
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
    env: { UPCLOUD_API_TOKEN: "test-upcloud-token" }
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
  { args, server }: {
    readonly args: ReadonlyArray<string>
    readonly server: ReturnType<typeof makeFakeUksServer>
  }
) =>
  Effect.gen(function*() {
    yield* Command.runWith(kumuloCli, { version: "test" })([...args])

    return (yield* TestConsole.logLines).map(String).join("\n")
  }).pipe(
    Effect.provide(TestConsole.layer),
    // every DNS host is reached through this client: none must not touch it
    Effect.provide(Layer.succeed(HttpClient.HttpClient, HttpClient.make((request) => Effect.die(`unexpected request ${request.url}`)))),
    Effect.provide(_upcloudEnv(server)),
    Effect.provide(_unusedEnvs),
    Effect.provide(_credentials),
    Effect.provide(BunServices.layer)
  )

it.effect("apply prints the resolved api server with a <zone> placeholder and calls no DNS host", () =>
  Effect.gen(function*() {
    const server = makeFakeUksServer({ readyAfterPolls: 0 })
    const output = yield* _run({ args: ["apply", _configPath(), "--yes"], server })

    assert.strictEqual(server.clusters.size, 1)
    assert.include(output, [
      "dns.module is none: kumulo wrote no DNS records. Create these at your DNS host.",
      "The names are suggestions: any name works with the type and value shown.",
      "Replace <zone> with your domain, or set dns.zone to fill it in.",
      "",
      "  TARGET      NAME                   TYPE   VALUE",
      "  api_server  api.staging-eu.<zone>  CNAME  abc123.upcloud.k8s.io"
    ].join("\n"))
    assert.notInclude(output, "_kumulo")
  }))

it.effect("apply fills dns.zone into the suggested name", () =>
  Effect.gen(function*() {
    const server = makeFakeUksServer({ readyAfterPolls: 0 })
    const output = yield* _run({ args: ["apply", _configPath({ module: "none", zone: "example.com" }), "--yes"], server })

    assert.include(output, "  api_server  api.staging-eu.example.com  CNAME  abc123.upcloud.k8s.io")
    assert.notInclude(output, "<zone>")
  }))

it.effect("--dry-run prints no targets: nothing is resolved before the cluster exists", () =>
  Effect.gen(function*() {
    const server = makeFakeUksServer({ readyAfterPolls: 0 })
    const output = yield* _run({ args: ["--dry-run", "apply", _configPath()], server })

    assert.notInclude(output, "dns.module is none")
    assert.notInclude(output, "dns/")
    assert.strictEqual(server.clusters.size, 0)
  }))

it.effect("delete reminds that DNS records are removed by hand", () =>
  Effect.gen(function*() {
    const server = makeFakeUksServer({ readyAfterPolls: 0 })
    const path = _configPath()
    yield* _run({ args: ["apply", path, "--yes"], server })
    const output = yield* _run({ args: ["delete", path, "--yes"], server })

    assert.include(
      output,
      "dns.module is none: kumulo does not manage DNS records. Remove any records pointing at this cluster at your DNS host by hand."
    )
  }))
