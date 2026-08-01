import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer } from "effect"
import * as BunServices from "@effect/platform-bun/BunServices"
import { Command } from "effect/unstable/cli"
import * as HttpClient from "effect/unstable/http/HttpClient"
import { assert, expect, it } from "@effect/vitest"
import { makeStorageClient } from "@kumulo/storage-ovh"
import { makeMksClient } from "@kumulo/distro-ovh-mks"
import { kumuloCli } from "../../src/commands.ts"
import { fakeCredentials } from "./fake-credentials.ts"
import { MksEnv } from "../../src/mks/env.ts"
import { OpenStackEnv } from "../../src/doctor-openstack/env.ts"
import { unavailableUpcloudEnvLayer } from "../fake-upcloud-env.ts"
import { StorageEnv } from "../../src/storage/env.ts"
import { makeFakeMksServer } from "../e2e/fake-mks-server.ts"
import { makeFakeCinder } from "./fake-cinder.ts"
import type { RouteHandler } from "./fake-cinder.ts"

// order matters: a network delete issued before nodes/LB VIP release their Neutron port is a 409, not a race
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

const _configPath = join(mkdtempSync(join(tmpdir(), "kumulo-delete-network-")), "cluster.yaml")
writeFileSync(_configPath, _yaml)

process.stdout.isTTY = false

const _storageLayer = Layer.succeed(StorageEnv, {
  storage: makeStorageClient(HttpClient.make(() => Effect.die("object storage must not be reached"))),
  serviceName: ""
})

const _openStackEnvLayer = Layer.succeed(OpenStackEnv, {
  keystone: {
    token: Effect.succeed("tok"),
    invalidate: Effect.void,
    endpoint: ({ service }: { readonly service: string }) => Effect.succeed(`https://${service}.example.com/`)
  },
  region: "GRA5",
  unavailableReason: undefined
})

const _fakeOpenStack = (timeline: Array<string>, networkDelete: RouteHandler) => {
  const record = (entry: string) => timeline.push(entry)
  const lb = { status: "ACTIVE" }
  return makeFakeCinder({
    "GET /v2/lbaas/loadbalancers": () => {
      // The amphora teardown finishes between the DELETE and the first poll.
      if (lb.status === "PENDING_DELETE") {
        timeline.push("lb-poll")
        lb.status = "DELETED"
      }
      return {
        status: 200,
        body: { loadbalancers: [{ id: "lb-1", name: "kumulo-staging", vip_port_id: "port-vip", provisioning_status: lb.status }] }
      }
    },
    "DELETE /v2/lbaas/loadbalancers/lb-1": () => {
      record("lb")
      lb.status = "PENDING_DELETE"
      return { status: 204 }
    },
    "GET /v2.0/floatingips": () => ({ status: 200, body: { floatingips: [{ id: "fip-1", floating_ip_address: "203.0.113.1" }] } }),
    "DELETE /v2.0/floatingips/fip-1": () => {
      record("floating-ip")
      return { status: 204 }
    },
    "GET /v2.1/servers/detail": () => ({ status: 200, body: { servers: [] } }),
    "GET /v2.1/os-server-groups": () => ({ status: 200, body: { server_groups: [] } }),
    "GET /v2.0/security-groups": () => ({ status: 200, body: { security_groups: [] } }),
    "GET /v2.0/networks": () => ({ status: 200, body: { networks: [{ id: "net-1", name: "kumulo-staging" }] } }),
    "GET /v2.0/subnets": () => ({ status: 200, body: { subnets: [] } }),
    "GET /v2.0/routers": () => ({ status: 200, body: { routers: [] } }),
    "DELETE /v2.0/networks/net-1": (request) => {
      record("network")
      return networkDelete(request)
    }
  })
}

const _deleted: RouteHandler = () => ({ status: 204 })

const _inUse: RouteHandler = () => ({
  status: 409,
  body: { NeutronError: { message: "There are one or more ports still in use on the network." } }
})

const _runDelete = (networkDelete: RouteHandler = _deleted) =>
  Effect.gen(function*() {
    const timeline: Array<string> = []
    const server = makeFakeMksServer()
    server.clusters.set("kube-1", { id: "kube-1", name: "staging", status: "READY", url: "https://kube-1.fixture.mks.invalid" })
    server.pools.set("kube-1", new Map())
    const recordingMks = server.httpClient.pipe(
      HttpClient.mapRequest((request) => {
        const path = new URL(request.url).pathname
        if (request.method === "DELETE" && path.endsWith("/kube/kube-1")) timeline.push("cluster")
        if (request.method === "GET" && path.endsWith("/kube")) timeline.push("cluster-poll")
        return request
      })
    )
    yield* Command.runWith(kumuloCli, { version: "test" })(["delete", _configPath, "--yes"]).pipe(
      Effect.provide(Layer.succeed(MksEnv, { mks: makeMksClient(recordingMks), serviceName: "service-1" })),
      Effect.provide(_fakeOpenStack(timeline, networkDelete)),
      Effect.provide(_openStackEnvLayer),
      Effect.provide(unavailableUpcloudEnvLayer),
      Effect.provide(_storageLayer),
      Effect.provide(fakeCredentials),
      Effect.provide(BunServices.layer)
    )
    return { server, timeline }
  })

const _polls = new Set(["cluster-poll", "lb-poll"])

it.effect("delete tears down cluster, then LB, then floating IP, then network", () =>
  Effect.gen(function*() {
    const { server, timeline } = yield* _runDelete()
    assert.isFalse(server.clusters.has("kube-1"))
    assert.deepStrictEqual(
      timeline.filter((entry) => !_polls.has(entry)),
      ["cluster", "lb", "floating-ip", "network"]
    )
  }))

it.effect("delete waits for the cluster to be gone before touching the network", () =>
  Effect.gen(function*() {
    const { timeline } = yield* _runDelete()
    const clusterDeleted = timeline.indexOf("cluster")
    const polledAfter = timeline.findIndex((entry, index) => entry === "cluster-poll" && index > clusterDeleted)
    assert.isAbove(clusterDeleted, -1)
    assert.isAbove(polledAfter, clusterDeleted)
    assert.isBelow(polledAfter, timeline.indexOf("lb"))
  }))

it.effect("delete waits for the load balancer to be gone before touching the network", () =>
  Effect.gen(function*() {
    const { timeline } = yield* _runDelete()
    const polledAfter = timeline.indexOf("lb-poll")
    assert.isAbove(polledAfter, timeline.indexOf("lb"))
    assert.isBelow(polledAfter, timeline.indexOf("network"))
  }))

// guards against a silent Effect.ignore/catchAll around the delete step masking a half-torn network as success
it.live("a network delete blocked by a remaining port fails the command loudly", () =>
  Effect.gen(function*() {
    const failure = yield* Effect.flip(_runDelete(_inUse))
    expect(failure).toMatchObject({
      _tag: "ResourceConflict",
      kind: "network-in-use",
      ref: expect.stringContaining("net-1")
    })
  }), 30_000)
