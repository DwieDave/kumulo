import { Effect, Layer, Ref } from "effect"
import { layerNoop } from "effect/FileSystem"
import { assert, it } from "@effect/vitest"
import { makeMksClient } from "@kumulo/distro-ovh-mks"
import { CloudProvider, PlanAction } from "@kumulo/core"
import { loadConfig } from "../../src/config.ts"
import { MksEnv } from "../../src/mks/env.ts"
import { buildMksPlan, emptyMksInventory } from "../../src/mks/plan.ts"
import { applyMksEffect, deleteMksWithCdn } from "../../src/mks/reconcile.ts"
import { makeFakeMksServer } from "../e2e/fake-mks-server.ts"
import { cdnYamlBlock, makeFakeCdn } from "../cdn-fakes.ts"
import { fakeCloudProvider } from "./fake-cloud-provider.ts"
import { spyDnsLayer } from "./spy-dns.ts"

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
  nodes_subnet: 10.0.1.0/24
  load_balancers_subnet: 10.0.2.0/24
ingress: {}
worker_pools: []
dns:
  module: hetzner
  zone: example.com
  ttl: 300
  records:
    - name: app
      target: cdn
volumes:
  module: none
object_storage:
  module: none
secrets:
  sink: none
${cdnYamlBlock()}`

const _withYaml = Effect.provide(layerNoop({ readFileString: () => Effect.succeed(_yaml) }))

const _setup = () => {
  const server = makeFakeMksServer()
  const cloud = fakeCloudProvider()
  const dns = spyDnsLayer()
  const fake = makeFakeCdn()
  fake.pullZone.setDnsReady("app.example.com", true)

  const cloudLayer = Layer.effect(
    CloudProvider,
    Effect.map(CloudProvider, (base) => ({ ...base, deleteByTag: () => Effect.void }))
  ).pipe(Layer.provide(cloud.layer))

  const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provide(Layer.succeed(MksEnv, { mks: makeMksClient(server.httpClient), serviceName: "service-1" })),
      Effect.provide(cloudLayer),
      Effect.provide(dns.layer)
    )

  return { server, dns, fake, provide }
}

it.effect("apply creates the pull zone from the ingress floating ip, then writes the cdn dns record", () =>
  Effect.gen(function*() {
    const { dns, fake, provide, server } = _setup()
    const config = yield* loadConfig("cluster.yaml")
    yield* provide(applyMksEffect({ config, cdn: fake.handle }))
    assert.strictEqual(server.clusters.size, 1)
    assert.strictEqual(fake.pullZone.zones()[0]?.OriginUrl, "https://203.0.113.1")
    assert.deepStrictEqual(dns.ensured[0]?.[0], { name: "app", target: "stagingeu.b-cdn.net" })
    const file = yield* Ref.get(fake.state)
    assert.strictEqual(file.pullZoneId, fake.pullZone.zones()[0]?.Id)
  }).pipe(_withYaml))

it.effect("delete removes dns, then the pull zone, then the cluster", () =>
  Effect.gen(function*() {
    const { dns, fake, provide, server } = _setup()
    const config = yield* loadConfig("cluster.yaml")
    yield* provide(applyMksEffect({ config, cdn: fake.handle }))
    yield* provide(deleteMksWithCdn({ config, cdn: fake.handle }))
    assert.deepStrictEqual(dns.removed, ["staging"])
    assert.strictEqual(fake.pullZone.zones().length, 0)
    assert.strictEqual(server.clusters.size, 0)
  }).pipe(_withYaml))

it.effect("plan resolves the cdn dns target as a CNAME", () =>
  Effect.gen(function*() {
    const config = yield* loadConfig("cluster.yaml")

    if (config.distro !== "ovh-mks") throw new Error("unreachable")
    const plan = buildMksPlan({ config, inventory: emptyMksInventory })
    assert.ok(plan.actions.some((a) => PlanAction.$is("Create")(a) && a.name === "dns/example.com/app (CNAME)"))
  }).pipe(_withYaml))
