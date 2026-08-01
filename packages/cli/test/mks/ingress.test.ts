import { Effect, Layer } from "effect"
import { layerNoop } from "effect/FileSystem"
import { assert, it } from "@effect/vitest"
import { dnsNoopLive } from "@kumulo/core"
import type { DnsProvider } from "@kumulo/core"
import { makeMksClient } from "@kumulo/distro-ovh-mks"
import { loadConfig } from "../../src/config.ts"
import { MksEnv } from "../../src/mks/env.ts"
import { applyMksEffect } from "../../src/mks/reconcile.ts"
import { makeFakeMksServer } from "../e2e/fake-mks-server.ts"
import { defaultLbInfo, fakeCloudProvider } from "./fake-cloud-provider.ts"
import { spyDnsLayer } from "./spy-dns.ts"

const _yaml = (blocks: string, dns = "  module: none\n") => `
name: staging
provider: ovh
distro: ovh-mks
version: "1.31.0"
auth:
  method: application_credential
  region: GRA5
${blocks}worker_pools: []
dns:
${dns}volumes:
  module: none
object_storage:
  module: none
secrets:
  sink: none
`

const _INGRESS_DNS = `  module: hetzner
  zone: example.com
  ttl: 300
  records:
    - name: www
      target: ingress
`

const _NETWORK = `network:
  cidr: 10.0.0.0/16
  nodes_subnet: 10.0.1.0/24
  load_balancers_subnet: 10.0.2.0/24
`

const _run = (
  { cloud, dns = dnsNoopLive, server }: {
    readonly cloud: ReturnType<typeof fakeCloudProvider>
    readonly dns?: Layer.Layer<DnsProvider>
    readonly server: ReturnType<typeof makeFakeMksServer>
  }
) =>
  Effect.gen(function*() {
    const config = yield* loadConfig("cluster.yaml")
    return yield* applyMksEffect({ config })
  }).pipe(
    Effect.provide(Layer.succeed(MksEnv, { mks: makeMksClient(server.httpClient), serviceName: "service-1" })),
    Effect.provide(cloud.layer),
    Effect.provide(dns)
  )

const _withYaml = (yaml: string) => Effect.provide(layerNoop({ readFileString: () => Effect.succeed(yaml) }))

it.effect("creates an ingress load balancer on the cluster's load-balancer subnet, with a floating IP", () =>
  Effect.gen(function*() {
    const server = makeFakeMksServer()
    const cloud = fakeCloudProvider()

    const info = yield* _run({ cloud, server })

    assert.deepStrictEqual(cloud.lbSpecs, [{
      members: [],
      floatingIp: true,
      vipNetworkId: "net-1",
      vipSubnetId: "subnet-lb-1",
      flavorId: "flavor-uuid-1"
    }])
    assert.strictEqual(server.clusters.size, 1)
    assert.deepStrictEqual(info.ingress, defaultLbInfo)
  }).pipe(_withYaml(_yaml(`${_NETWORK}ingress:\n  flavor_id: flavor-uuid-1\n`))))

it.effect("omits the flavor when the ingress block names none", () =>
  Effect.gen(function*() {
    const cloud = fakeCloudProvider()

    yield* _run({ cloud, server: makeFakeMksServer() })

    assert.deepStrictEqual(cloud.lbSpecs, [{
      members: [],
      floatingIp: true,
      vipNetworkId: "net-1",
      vipSubnetId: "subnet-lb-1"
    }])
  }).pipe(_withYaml(_yaml(`${_NETWORK}ingress: {}\n`))))

it.effect("re-applying an adopted ingress LB asks for the identical spec and returns the identical info", () =>
  Effect.gen(function*() {
    const cloud = fakeCloudProvider()
    const server = makeFakeMksServer()

    const first = yield* _run({ cloud, server })
    const second = yield* _run({ cloud, server })

    assert.deepStrictEqual(second.ingress, first.ingress)
    assert.strictEqual(cloud.lbSpecs.length, 2)
    assert.deepStrictEqual(cloud.lbSpecs[1], cloud.lbSpecs[0])
    assert.strictEqual(server.clusters.size, 1)
  }).pipe(_withYaml(_yaml(`${_NETWORK}ingress: {}\n`))))

it.effect("touches no load balancer when the config declares no ingress", () =>
  Effect.gen(function*() {
    const cloud = fakeCloudProvider()

    yield* _run({ cloud, server: makeFakeMksServer() })

    assert.deepStrictEqual(cloud.lbSpecs, [])
  }).pipe(_withYaml(_yaml(_NETWORK))))

it.effect("an apply points a target: ingress record at the floating IP it just allocated", () =>
  Effect.gen(function*() {
    const dns = spyDnsLayer()

    yield* _run({ cloud: fakeCloudProvider(), dns: dns.layer, server: makeFakeMksServer() })

    assert.deepStrictEqual(dns.ensured, [[
      { name: "www", target: defaultLbInfo.floatingIp },
      { name: "www", target: "kumulo.cluster=staging" }
    ]])
  }).pipe(_withYaml(_yaml(`${_NETWORK}ingress: {}\n`, _INGRESS_DNS))))

it.effect("rejects an ingress block on a config that declares no network", () =>
  Effect.gen(function*() {
    const failure = yield* Effect.flip(loadConfig("cluster.yaml"))
    assert.strictEqual(failure._tag, "ConfigInvalid")
    assert.include(JSON.stringify(failure), "network")
  }).pipe(_withYaml(_yaml("ingress: {}\n"))))
