import { Effect, Layer } from "effect"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import { assert, it } from "@effect/vitest"
import { DnsProvider } from "@kumulo/core"
import {
  makeNetworkClient,
  makeNodeGroupsClient,
  makeObjectStorageClient,
  makeRouterClient,
  makeStorageClient,
  makeUksClient,
  makeZoneClient
} from "@kumulo/upcloud"
import { deleteUpcloudUksWithCdn } from "../../src/upcloud/reconcile.ts"
import { UpcloudEnv } from "../../src/upcloud/env.ts"
import { validUpcloudUksConfig } from "../config/fixtures.ts"
import { decodeUpcloudTestConfig } from "../fixtures.ts"

const _config = decodeUpcloudTestConfig({
  ...validUpcloudUksConfig,
  dns: { module: "hetzner", zone: "example.com", ttl: 300, records: [{ name: "api", target: "api_server" }] }
})

it.effect("without a cdn block, delete removes dns only after the network and router steps", () =>
  Effect.gen(function*() {
    const order: Array<string> = []

    const raw = HttpClient.make((request) =>
      Effect.sync(() => {
        order.push(`http:${request.method} ${request.url}`)

        const body = request.url.includes("/kubernetes")
          ? []
          : request.url.includes("/network")
          ? { networks: { network: [] } }
          : { routers: { router: [] } }

        return HttpClientResponse.fromWeb(request, Response.json(body))
      })
    )

    const http = raw.pipe(HttpClient.mapRequest(HttpClientRequest.prependUrl("https://fixture.invalid")))

    const env = Layer.succeed(UpcloudEnv, {
      clients: {
        uks: makeUksClient(http),
        nodeGroups: makeNodeGroupsClient(http),
        network: makeNetworkClient(http),
        router: makeRouterClient(http)
      },
      zones: makeZoneClient(http),
      storage: makeStorageClient(http),
      objectStorage: makeObjectStorageClient(http)
    })

    const dns = Layer.succeed(DnsProvider, {
      ensureRecords: () => Effect.void,
      removeClusterRecords: () => Effect.sync(() => void order.push("dns:remove"))
    })

    yield* deleteUpcloudUksWithCdn({ config: _config, cdn: undefined }).pipe(Effect.provide(Layer.merge(env, dns)))
    assert.strictEqual(order.at(-1), "dns:remove")
    assert.strictEqual(order.filter((entry) => entry === "dns:remove").length, 1)
    assert.ok(order.length > 1, order.join("\n"))
    assert.ok(order.some((entry) => entry.includes("router")), order.join("\n"))
  }))
