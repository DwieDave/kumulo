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
import { MksEnv } from "../../src/mks/env.ts"
import { OpenStackEnv } from "../../src/doctor-openstack/env.ts"
import { StorageEnv } from "../../src/storage/env.ts"
import { makeFakeMksServer } from "../e2e/fake-mks-server.ts"
import { makeFakeCinder } from "./fake-cinder.ts"
import type { RouteHandler } from "./fake-cinder.ts"

// R17/T5.1. The order is not cosmetic: the cluster's nodes and the LB's VIP
// each hold a Neutron port on the private network, so a network delete issued
// before they are gone is a 409, not a race. This drives the real `delete`
// command over fake OVH + OpenStack and asserts the observed call order.

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

// The real OpenStack `CloudProvider` is built from this env, so the teardown
// exercises the actual Neutron/Octavia calls against the fake below.
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
  // Octavia accepts a delete and finishes it asynchronously: the LB reports
  // PENDING_DELETE — VIP port still on the subnet — until the amphorae are
  // gone. The teardown must wait that out, so the fake reports it.
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
    "DELETE /v2.0/networks/net-1": (request) => {
      record("network")
      return networkDelete(request)
    }
  })
}

const _deleted: RouteHandler = () => ({ status: 204 })

/** Neutron's answer to a network that still has ports on it (`NetworkInUse`). */
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
      Effect.provide(_storageLayer),
      Effect.provide(BunServices.layer)
    )
    return { server, timeline }
  })

const _polls = new Set(["cluster-poll", "lb-poll"])

it.effect("delete tears down cluster, then LB, then floating IP, then network", () =>
  Effect.gen(function*() {
    const { server, timeline } = yield* _runDelete()
    assert.isFalse(server.clusters.has("kube-1"))
    // Every ordered step happened, exactly once, in R17's order.
    assert.deepStrictEqual(
      timeline.filter((entry) => !_polls.has(entry)),
      ["cluster", "lb", "floating-ip", "network"]
    )
  }))

// Without a wait, OVH's asynchronous node teardown leaves ports on the network
// and the Neutron delete 409s on every real run — T5.3's loud failure would
// become the normal path.
it.effect("delete waits for the cluster to be gone before touching the network", () =>
  Effect.gen(function*() {
    const { timeline } = yield* _runDelete()
    const clusterDeleted = timeline.indexOf("cluster")
    const polledAfter = timeline.findIndex((entry, index) => entry === "cluster-poll" && index > clusterDeleted)
    assert.isAbove(clusterDeleted, -1)
    assert.isAbove(polledAfter, clusterDeleted)
    assert.isBelow(polledAfter, timeline.indexOf("lb"))
  }))

// Same defect, one resource over: Octavia's DELETE only starts the teardown,
// and the VIP port sits on the load-balancers subnet until it finishes.
it.effect("delete waits for the load balancer to be gone before touching the network", () =>
  Effect.gen(function*() {
    const { timeline } = yield* _runDelete()
    const polledAfter = timeline.indexOf("lb-poll")
    assert.isAbove(polledAfter, timeline.indexOf("lb"))
    assert.isBelow(polledAfter, timeline.indexOf("network"))
  }))

// T5.3. A half-torn network reported as success is the worst outcome here: the
// operator believes the teardown ran and pays for the leftovers. The one-line
// way to lose this forever is an `Effect.ignore`/`catchAll` around the delete
// step "to make delete robust" — this test is what turns that red.
//
// `it.live`, not `it.effect`: DELETE is idempotent, so `OpenStackHttpLive`
// replays a 409 with exponential backoff before it surfaces (~6s). Under
// `it.effect`'s TestClock those sleeps never elapse and the test would hang
// rather than fail. The retry is wanted — a port that is merely slow to
// disappear resolves itself — so this waits it out instead of disabling it.
it.live("a network delete blocked by a remaining port fails the command loudly", () =>
  Effect.gen(function*() {
    const failure = yield* Effect.flip(_runDelete(_inUse))
    expect(failure).toMatchObject({
      _tag: "ResourceConflict",
      kind: "network-in-use",
      // Names the network and the remedy, not the endpoint path.
      ref: expect.stringContaining("net-1")
    })
  }), 30_000)
