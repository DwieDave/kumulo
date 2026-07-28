import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer } from "effect"
import * as BunServices from "@effect/platform-bun/BunServices"
import { Command } from "effect/unstable/cli"
import * as HttpClient from "effect/unstable/http/HttpClient"
import type { HttpClientRequest } from "effect/unstable/http"
import { assert, it } from "@effect/vitest"
import { makeStorageClient } from "@kumulo/storage-ovh"
import { parseOutputsYaml } from "@kumulo/volumes-cinder"
import { makeMksClient } from "@kumulo/distro-ovh-mks"
import { kumuloCli } from "../../src/commands.ts"
import { fakeCredentials } from "./fake-credentials.ts"
import { MksEnv } from "../../src/mks/env.ts"
import { OpenStackEnv } from "../../src/doctor-openstack/env.ts"
import { StorageEnv } from "../../src/storage/env.ts"
import { makeFakeMksServer } from "../e2e/fake-mks-server.ts"
import { makeFakeCinder } from "./fake-cinder.ts"

// R13, end to end. `ingress-outputs.test.ts` pins `recordIngressOutputs` in
// isolation and `mks/ingress.test.ts` pins the reconciler's `LbInfo`; neither
// joins them, so the seam `mksEntry.apply` -> `DistroApplyResult.ingress` ->
// `<cluster>.outputs.yaml` could be cut without a red test. This drives the
// real `apply` command over fake OVH + OpenStack APIs and reads the file back.

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
ingress:
  flavor_id: flavor-uuid-1
worker_pools: []
dns:
  module: none
volumes:
  module: none
object_storage:
  module: none
secrets:
  sink: none
`

const _configDir = mkdtempSync(join(tmpdir(), "kumulo-apply-ingress-"))
const _configPath = join(_configDir, "cluster.yaml")
writeFileSync(_configPath, _yaml)

// `commands.ts` reads `process.stdout.isTTY` at call time; pin the CI branch.
process.stdout.isTTY = false

const _storageLayer = Layer.succeed(StorageEnv, {
  storage: makeStorageClient(HttpClient.make(() => Effect.die("object storage must not be reached"))),
  serviceName: ""
})

// The real OpenStack `CloudProvider` is built from this env (see
// `mksCloudProviderLayer`), so the apply exercises the actual Neutron/Octavia
// calls against the fake HTTP client below rather than a stubbed provider.
const _openStackEnvLayer = Layer.succeed(OpenStackEnv, {
  keystone: {
    token: Effect.succeed("tok"),
    invalidate: Effect.void,
    endpoint: ({ service }: { readonly service: string }) => Effect.succeed(`https://${service}.example.com/`)
  },
  region: "GRA5",
  unavailableReason: undefined
})

/** The JSON body a route handler received, or `undefined` for a bodyless request. */
const _json = (request: HttpClientRequest.HttpClientRequest): Record<string, unknown> =>
  request.body._tag === "Uint8Array" ? JSON.parse(new TextDecoder().decode(request.body.body)) : {}

/** Query values live in `urlParams`, not in `request.url`. */
const _param = (request: HttpClientRequest.HttpClientRequest, key: string): string | undefined =>
  [...request.urlParams].find(([name]) => name === key)?.[1]

const _postedCidr = (request: HttpClientRequest.HttpClientRequest): string => {
  const subnet = _json(request)["subnet"]
  return typeof subnet === "object" && subnet !== null && "cidr" in subnet && typeof subnet.cidr === "string"
    ? subnet.cidr
    : ""
}

// A Neutron + Octavia that remembers what it created, on the same fake HTTP
// client the Cinder harness provides (routing is by method + pathname).
const _fakeOpenStack = () => {
  const networks: Array<{ readonly id: string }> = []
  const subnets: Array<{ readonly id: string; readonly cidr: string }> = []
  return makeFakeCinder({
    "GET /v2.0/networks": (request) =>
      _param(request, "router:external") === "true"
        ? { status: 200, body: { networks: [{ id: "ext-net", name: "Ext-Net" }] } }
        : { status: 200, body: { networks } },
    "POST /v2.0/networks": () => {
      networks.push({ id: "net-1" })
      return { status: 201, body: { network: { id: "net-1" } } }
    },
    "GET /v2.0/subnets": () => ({ status: 200, body: { subnets } }),
    // The gateway (Neutron router) a floating IP needs before it can route.
    "GET /v2.0/routers": () => ({ status: 200, body: { routers: [] } }),
    "POST /v2.0/routers": () => ({ status: 201, body: { router: { id: "router-1", name: "kumulo-staging" } } }),
    "PUT /v2.0/routers/router-1/add_router_interface": () => ({ status: 200, body: { id: "router-1" } }),
    "POST /v2.0/subnets": (request) => {
      const cidr = _postedCidr(request)
      // Real Neutron subnet ids are UUIDs; a `/` from the CIDR would split the
      // gateway create path — a fixture artefact, not a product bug.
      const subnet = { id: `sub-${cidr.replace("/", "-")}`, cidr }
      subnets.push(subnet)
      return { status: 201, body: { subnet } }
    },
    "GET /v2/lbaas/loadbalancers": () => ({ status: 200, body: { loadbalancers: [] } }),
    "POST /v2/lbaas/loadbalancers": () => ({
      status: 201,
      body: { loadbalancer: { id: "lb-1", vip_address: "10.0.2.7", vip_port_id: "port-vip" } }
    }),
    "GET /v2.0/floatingips": () => ({ status: 200, body: { floatingips: [] } }),
    "POST /v2.0/floatingips": () => ({
      status: 201,
      body: { floatingip: { id: "fip-1", floating_ip_address: "203.0.113.1" } }
    })
  })
}

it.effect("apply records the ingress LB it created in <cluster>.outputs.yaml", () =>
  Effect.gen(function*() {
    const server = makeFakeMksServer()
    yield* Command.runWith(kumuloCli, { version: "test" })(["apply", _configPath, "--yes"]).pipe(
      Effect.provide(Layer.succeed(MksEnv, { mks: makeMksClient(server.httpClient), serviceName: "service-1" })),
      Effect.provide(_fakeOpenStack()),
      Effect.provide(_openStackEnvLayer),
      Effect.provide(_storageLayer),
      Effect.provide(fakeCredentials),
      Effect.provide(BunServices.layer)
    )
    assert.strictEqual(server.clusters.size, 1)
    const outputs = yield* parseOutputsYaml(readFileSync(join(_configDir, "staging.outputs.yaml"), "utf8"))
    // The id a consumer annotates a Service with, and the address DNS points at.
    assert.deepStrictEqual(outputs.ingress, { load_balancer_id: "lb-1", floating_ip: "203.0.113.1" })
  }))
