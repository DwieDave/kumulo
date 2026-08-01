import { describe, expect, it } from "@effect/vitest"
import { Effect, Fiber } from "effect"
import { FastCheck as fc, TestClock } from "effect/testing"
import { CapabilityMissing, ProvisioningTimeout, ResourceNotFound, ResponseDecodeError, type SecGroupSpec } from "@kumulo/core"
import {
  deleteByTag,
  ensureFloatingIp,
  hasGateway,
  ensureLoadBalancer,
  ensureNetwork,
  ensureSecurityGroups,
  findNetwork,
  ensureServer,
  ensureServerGroups,
  listClusterResources,
  releaseFloatingIp,
  resolveFlavor,
  resolveImage,
  type CloudProviderOptions
} from "../../src/provider/cloud-provider.ts"
import { makeFakeOpenStack, requestJson } from "./fake-openstack.ts"
import type { RouteHandler } from "./fake-openstack.ts"

const IMG_1 = "11111111-1111-4111-8111-111111111111"
const IMG_2 = "22222222-2222-4222-8222-222222222222"

const options: CloudProviderOptions = {
  tag: "prod",
  region: "gra",
  octaviaEnabled: true,
  imageAliases: { "ubuntu-24.04": "Ubuntu 24.04" }
}

const _octaviaRoutes = (
  { deleted, lb, onDelete }: {
    readonly deleted: Array<string>
    readonly lb: { status: string }
    readonly onDelete: string
  }
): Record<string, RouteHandler> => ({
  "GET /v2/lbaas/loadbalancers": () => ({
    status: 200,
    body: { loadbalancers: [{ id: "lb-1", name: "kumulo-prod", provisioning_status: lb.status }] }
  }),
  "DELETE /v2/lbaas/loadbalancers/lb-1": () => {
    deleted.push("lb")
    lb.status = onDelete
    return { status: 204 }
  }
})

const _postedCidr = (payload: unknown): string =>
  typeof payload === "object" && payload !== null && "subnet" in payload &&
    typeof payload.subnet === "object" && payload.subnet !== null && "cidr" in payload.subnet &&
    typeof payload.subnet.cidr === "string"
    ? payload.subnet.cidr
    : ""

const _fakeNeutron = (seeded: ReadonlyArray<{ readonly id: string; readonly cidr: string }> = []) => {
  const networks: Array<{ readonly id: string }> = seeded.length === 0 ? [] : [{ id: "net-1" }]
  const subnets: Array<{ readonly id: string; readonly cidr: string }> = [...seeded]
  return makeFakeOpenStack({
    "GET /v2.0/networks": () => ({ status: 200, body: { networks } }),
    "POST /v2.0/networks": () => {
      networks.push({ id: "net-1" })
      return { status: 201, body: { network: { id: "net-1" } } }
    },
    "GET /v2.0/subnets": () => ({ status: 200, body: { subnets } }),
    "POST /v2.0/subnets": (request) => {
      const cidr = _postedCidr(requestJson(request))
      const subnet = { id: `sub-${cidr}`, cidr }
      subnets.push(subnet)
      return { status: 201, body: { subnet } }
    }
  })
}

const _postedFloatingIp = (payload: unknown): Record<string, string> => {
  const wrapper = typeof payload === "object" && payload !== null && "floatingip" in payload
    ? payload.floatingip
    : undefined
  if (typeof wrapper !== "object" || wrapper === null) return {}
  return Object.fromEntries(
    Object.entries(wrapper).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  )
}

const _postedSubnetId = (payload: unknown): string =>
  typeof payload === "object" && payload !== null && "subnet_id" in payload &&
    typeof payload.subnet_id === "string"
    ? payload.subnet_id
    : ""

const _route = (call: { readonly method: string; readonly url: string }) => `${call.method} ${new URL(call.url).pathname}`

describe("openstack CloudProvider", () => {
  it.effect("ensureNetwork creates then reuses by name, and re-applying mutates nothing", () => {
    const fake = _fakeNeutron()
    return Effect.gen(function*() {
      const first = yield* ensureNetwork({ options, spec: { cidr: "10.0.0.0/24" } })
      const second = yield* ensureNetwork({ options, spec: { cidr: "10.0.0.0/24" } })
      expect(first).toStrictEqual({ id: "net-1", cidr: "10.0.0.0/24", nodesSubnetId: "sub-10.0.0.0/24" })
      expect(second).toStrictEqual(first)
      expect(fake.calls().map(_route)).toEqual([
        "GET /v2.0/networks",
        "POST /v2.0/networks",
        "POST /v2.0/subnets",
        "GET /v2.0/subnets",
        "GET /v2.0/networks",
        "GET /v2.0/subnets"
      ])
    }).pipe(Effect.provide(fake.layer))
  })

  const _halfCreated = () => {
    const subnets: Array<{ readonly id: string; readonly cidr: string }> = []
    const posted: Array<string> = []
    return {
      posted,
      ...makeFakeOpenStack({
        "GET /v2.0/networks": () => ({ status: 200, body: { networks: [{ id: "net-1", name: "kumulo-prod" }] } }),
        "GET /v2.0/subnets": () => ({ status: 200, body: { subnets } }),
        "POST /v2.0/subnets": (request) => {
          const cidr = _postedCidr(requestJson(request))
          const subnet = { id: `sub-${cidr}`, cidr }
          subnets.push(subnet)
          posted.push(cidr)
          return { status: 201, body: { subnet } }
        }
      })
    }
  }

  it.effect("ensureNetwork completes a network that exists with no subnets", () => {
    const fake = _halfCreated()
    return Effect.gen(function*() {
      const info = yield* ensureNetwork({
        options,
        spec: { cidr: "10.0.0.0/16", nodesSubnet: "10.0.1.0/24", loadBalancersSubnet: "10.0.2.0/24" }
      })
      expect(fake.posted).toEqual(["10.0.1.0/24", "10.0.2.0/24"])
      expect(info.nodesSubnetId).toBe("sub-10.0.1.0/24")
      expect(info.loadBalancersSubnetId).toBe("sub-10.0.2.0/24")
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("ensureNetwork writes nothing to a network whose subnets do not match", () => {
    const posted: Array<string> = []
    const fake = makeFakeOpenStack({
      "GET /v2.0/networks": () => ({ status: 200, body: { networks: [{ id: "net-1", name: "kumulo-prod" }] } }),
      "GET /v2.0/subnets": () => ({ status: 200, body: { subnets: [{ id: "sub-old", cidr: "192.168.0.0/24" }] } }),
      "POST /v2.0/subnets": (request) => {
        posted.push(_postedCidr(requestJson(request)))
        return { status: 201, body: { subnet: { id: "x", cidr: "x" } } }
      }
    })
    return Effect.gen(function*() {
      const info = yield* ensureNetwork({
        options,
        spec: { cidr: "10.0.0.0/16", nodesSubnet: "10.0.1.0/24", loadBalancersSubnet: "10.0.2.0/24" }
      })
      expect(posted).toEqual([])
      expect(info.nodesSubnetId).toBeUndefined()
      expect(info.loadBalancersSubnetId).toBeUndefined()
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("ensureNetwork creates a nodes subnet and a load-balancers subnet and returns both ids", () => {
    const fake = _fakeNeutron()
    return Effect.gen(function*() {
      const info = yield* ensureNetwork({
        options,
        spec: { cidr: "10.0.0.0/16", nodesSubnet: "10.0.1.0/24", loadBalancersSubnet: "10.0.2.0/24" }
      })
      expect(info).toEqual({
        id: "net-1",
        cidr: "10.0.0.0/16",
        nodesSubnetId: "sub-10.0.1.0/24",
        loadBalancersSubnetId: "sub-10.0.2.0/24"
      })
      expect(fake.calls().filter((call) => call.method === "POST" && call.url.includes("/v2.0/subnets")).length).toBe(2)
    }).pipe(Effect.provide(fake.layer))
  })

  const _cidrArb = fc.tuple(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }))
    .map(([a, b]) => `10.${a}.${b}.0/24`)
  const _distinctPair = fc.tuple(_cidrArb, _cidrArb).filter(([nodes, lbs]) => nodes !== lbs)

  it.effect.prop(
    "ensureNetwork twice returns equal, fully-populated NetworkInfo — the create path and the lookup path agree",
    [_distinctPair],
    ([[nodesSubnet, loadBalancersSubnet]]) => {
      const fake = _fakeNeutron()
      const spec = { cidr: "10.0.0.0/8", nodesSubnet, loadBalancersSubnet }
      return Effect.gen(function*() {
        const first = yield* ensureNetwork({ options, spec })
        const second = yield* ensureNetwork({ options, spec })
        expect(second).toEqual(first)
        for (const id of [first.id, first.nodesSubnetId, first.loadBalancersSubnetId]) {
          expect(typeof id).toBe("string")
          expect(id).not.toBe("")
        }
        const posts = fake.calls().filter((call) => call.method === "POST")
        expect(posts.filter((call) => call.url.includes("/v2.0/networks")).length).toBe(1)
        expect(posts.filter((call) => call.url.includes("/v2.0/subnets")).length).toBe(2)
      }).pipe(Effect.provide(fake.layer))
    }
  )

  it.effect("an existing network is never mutated when its subnets no longer match the config", () => {
    const fake = _fakeNeutron([{ id: "sub-old", cidr: "10.0.0.0/16" }])
    return Effect.gen(function*() {
      const info = yield* ensureNetwork({ options, spec: { cidr: "10.0.0.0/24", loadBalancersSubnet: "10.9.0.0/24" } })
      expect(info).toStrictEqual({ id: "net-1", cidr: "10.0.0.0/24" })
      expect(fake.calls().filter((call) => call.method === "POST")).toEqual([])
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("ensureSecurityGroups decodes security group rules and tolerates already-applied (409) rules", () => {
    const fake = makeFakeOpenStack({
      "GET /v2.0/security-groups": () => ({ status: 200, body: { security_groups: [] } }),
      "POST /v2.0/security-groups": () => ({ status: 201, body: { security_group: { id: "sg-1" } } }),
      "POST /v2.0/security-group-rules": () => ({ status: 409 })
    })
    const rules: SecGroupSpec["rules"] = [
      { protocol: "tcp", portMin: 22, portMax: 22, remoteCidr: "1.2.3.0/24" },
      { protocol: "tcp", portMin: 2379, portMax: 2380, remoteGroupSelf: true }
    ]
    return Effect.gen(function*() {
      const info = yield* ensureSecurityGroups({ options, spec: { rules } })
      expect(info).toEqual({ id: "sg-1" })
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("ensureSecurityGroups fails on a malformed rule descriptor", () => {
    const fake = makeFakeOpenStack({
      "GET /v2.0/security-groups": () => ({ status: 200, body: { security_groups: [{ id: "sg-1" }] } })
    })
    const spec: SecGroupSpec = { rules: JSON.parse(`[{"nonsense":true}]`) }
    return Effect.gen(function*() {
      const exit = yield* Effect.flip(ensureSecurityGroups({ options, spec }))
      expect(exit).toBeInstanceOf(ResponseDecodeError)
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("ensureServerGroups is idempotent per role", () => {
    const fake = makeFakeOpenStack({
      "GET /v2.1/os-server-groups": () => ({ status: 200, body: { server_groups: [{ id: "grp-masters", name: "kumulo-prod-masters" }] } })
    })
    return Effect.gen(function*() {
      const id = yield* ensureServerGroups({ options, role: "master" })
      expect(id).toBe("grp-masters")
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("ensureLoadBalancer fails with CapabilityMissing when Octavia is unavailable", () => {
    const fake = makeFakeOpenStack({})
    return Effect.gen(function*() {
      const exit = yield* Effect.flip(
        ensureLoadBalancer({ options: { ...options, octaviaEnabled: false }, spec: { members: [] } })
      )
      expect(exit).toBeInstanceOf(CapabilityMissing)
    }).pipe(Effect.provide(fake.layer))
  })

  const _lbFake = (
    { loadbalancers, posted }: {
      readonly loadbalancers: ReadonlyArray<Record<string, unknown>>
      readonly posted: Array<unknown>
    }
  ) => {
    const postedFips: Array<Record<string, string>> = []
    return {
      postedFips,
      ...makeFakeOpenStack({
        "GET /v2/lbaas/loadbalancers": () => ({ status: 200, body: { loadbalancers } }),
        "POST /v2/lbaas/loadbalancers": (request) => {
          posted.push(requestJson(request))
          return {
            status: 201,
            body: { loadbalancer: { id: "lb-1", vip_address: "10.0.2.7", vip_port_id: "port-vip" } }
          }
        },
        "GET /v2.0/networks": () => ({ status: 200, body: { networks: [{ id: "ext-net", name: "Ext-Net" }] } }),
        "GET /v2/lbaas/flavors": () => ({
          status: 200,
          body: { flavors: [{ id: "flav-small", name: "small" }, { id: "flav-large", name: "large" }] }
        }),
        "GET /v2.0/floatingips": () => ({ status: 200, body: { floatingips: [] } }),
        "POST /v2.0/floatingips": (request) => {
          const body = _postedFloatingIp(requestJson(request))
          postedFips.push(body)
          return { status: 201, body: { floatingip: { id: "fip-1", floating_ip_address: "203.0.113.1", ...body } } }
        }
      })
    }
  }

  it.effect("ensureLoadBalancer places the VIP and allocates a floating IP on its VIP port", () => {
    const posted: Array<unknown> = []
    const fake = _lbFake({ loadbalancers: [], posted })
    return Effect.gen(function*() {
      const info = yield* ensureLoadBalancer({
        options,
        spec: {
          members: ["10.0.1.5"],
          vipSubnetId: "sub-lb",
          vipNetworkId: "net-1",
          flavorId: "flavor-1",
          floatingIp: true
        }
      })
      expect(info).toEqual({ id: "lb-1", vip: "10.0.2.7", floatingIp: "203.0.113.1" })
      expect(posted).toEqual([{
        loadbalancer: { name: "kumulo-prod", vip_subnet_id: "sub-lb", vip_network_id: "net-1", flavor_id: "flavor-1" }
      }])
      expect(fake.postedFips).toEqual([
        { floating_network_id: "ext-net", port_id: "port-vip", description: "kumulo-prod" }
      ])
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("ensureLoadBalancer resolves a flavor name to its Octavia id", () => {
    const posted: Array<unknown> = []
    const fake = _lbFake({ loadbalancers: [], posted })
    return Effect.gen(function*() {
      yield* ensureLoadBalancer({ options, spec: { members: [], vipSubnetId: "sub-lb", flavorName: "large" } })
      expect(posted).toEqual([{
        loadbalancer: { name: "kumulo-prod", vip_subnet_id: "sub-lb", flavor_id: "flav-large" }
      }])
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("ensureLoadBalancer fails, listing what exists, when a flavor name is unknown", () => {
    const posted: Array<unknown> = []
    const fake = _lbFake({ loadbalancers: [], posted })
    return Effect.gen(function*() {
      const exit = yield* Effect.exit(
        ensureLoadBalancer({ options, spec: { members: [], vipSubnetId: "sub-lb", flavorName: "enormous" } })
      )
      expect(exit._tag).toBe("Failure")
      expect(JSON.stringify(exit)).toContain("enormous")
      expect(JSON.stringify(exit)).toContain("small")
      expect(posted).toEqual([])
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("ensureLoadBalancer sends no members and, without a floating-IP request, returns none", () => {
    const posted: Array<unknown> = []
    const fake = _lbFake({ loadbalancers: [], posted })
    return Effect.gen(function*() {
      const k3s = yield* ensureLoadBalancer({ options, spec: { members: [] } })
      expect(k3s).toStrictEqual({ id: "lb-1", vip: "10.0.2.7" })
      expect(posted).toEqual([{ loadbalancer: { name: "kumulo-prod" } }])
      expect(fake.calls().some((call) => call.url.includes("/v2.0/floatingips"))).toBe(false)
      const withMembers = yield* ensureLoadBalancer({ options, spec: { members: ["10.0.1.5", "10.0.1.6"] } })
      expect(withMembers).toStrictEqual(k3s)
      expect(posted[1]).toEqual({ loadbalancer: { name: "kumulo-prod" } })
    }).pipe(Effect.provide(fake.layer))
  })

  const _ccmChild = fc.record({ id: fc.stringMatching(/^[a-z0-9-]{1,12}$/) })
  const _adoptedLb = fc.record({
    listeners: fc.array(_ccmChild, { minLength: 1, maxLength: 4 }),
    pools: fc.array(_ccmChild, { minLength: 1, maxLength: 4 }),
    tags: fc.array(fc.stringMatching(/^[a-z0-9-]{1,12}$/), { maxLength: 3 }),
    operating_status: fc.constantFrom("ONLINE", "DEGRADED", "OFFLINE")
  })

  it.effect.prop(
    "ensureLoadBalancer is a pure read against an LB carrying CCM-created listeners and pools",
    [_adoptedLb],
    ([ccm]) => {
      const posted: Array<unknown> = []
      const existing = {
        id: "lb-1",
        name: "kumulo-prod",
        vip_address: "10.0.2.7",
        vip_port_id: "port-vip",
        vip_subnet_id: "sub-lb",
        provisioning_status: "ACTIVE",
        ...ccm
      }
      const fake = makeFakeOpenStack({
        "GET /v2/lbaas/loadbalancers": () => ({ status: 200, body: { loadbalancers: [existing] } }),
        "POST /v2/lbaas/loadbalancers": (request) => {
          posted.push(requestJson(request))
          return { status: 201, body: { loadbalancer: existing } }
        },
        "GET /v2.0/floatingips": () => ({
          status: 200,
          body: { floatingips: [{ id: "fip-1", floating_ip_address: "203.0.113.1", port_id: "port-vip" }] }
        })
      })
      const spec = { members: [], floatingIp: true, vipSubnetId: "sub-other", flavorId: "flavor-other" }
      return Effect.gen(function*() {
        const first = yield* ensureLoadBalancer({ options, spec })
        const second = yield* ensureLoadBalancer({ options, spec })
        expect(first).toEqual({ id: "lb-1", vip: "10.0.2.7", floatingIp: "203.0.113.1" })
        expect(second).toEqual(first)
        expect(fake.calls().filter((call) => call.method !== "GET")).toEqual([])
        expect(posted).toEqual([])
        expect(Object.keys(first).toSorted()).toEqual(["floatingIp", "id", "vip"])
      }).pipe(Effect.provide(fake.layer))
    }
  )

  it.effect("listClusterResources reports an adopted LB without its CCM-owned children", () => {
    const fake = makeFakeOpenStack({
      "GET /v2.1/servers/detail": () => ({ status: 200, body: { servers: [] } }),
      "GET /v2.0/networks": () => ({ status: 200, body: { networks: [] } }),
      "GET /v2.0/security-groups": () => ({ status: 200, body: { security_groups: [] } }),
      "GET /v2/lbaas/loadbalancers": () => ({
        status: 200,
        body: {
          loadbalancers: [{
            id: "lb-1",
            name: "kumulo-prod",
            vip_address: "10.0.2.7",
            listeners: [{ id: "listener-ccm" }],
            pools: [{ id: "pool-ccm" }],
            operating_status: "DEGRADED"
          }]
        }
      })
    })
    return Effect.gen(function*() {
      const inventory = yield* listClusterResources({ options })
      expect(inventory.loadBalancers).toEqual([{ id: "lb-1", vip: "10.0.2.7" }])
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("ensureServer creates, waits for ACTIVE, and re-ensures idempotently by name", () => {
    const fake = makeFakeOpenStack({
      "GET /v2.1/servers": () => ({ status: 200, body: { servers: [] } }),
      "GET /v2.1/os-server-groups": () => ({ status: 200, body: { server_groups: [{ id: "grp-masters", name: "kumulo-prod-masters" }] } }),
      "POST /v2.1/servers": () => ({ status: 202, body: { server: { id: "srv-1" } } }),
      "GET /v2.1/servers/srv-1": () => ({
        status: 200,
        body: { server: { id: "srv-1", status: "ACTIVE", addresses: { "kumulo-prod": [{ addr: "10.0.0.5" }] } } }
      })
    })
    return Effect.gen(function*() {
      const info = yield* ensureServer({ options, spec: { name: "master-1", role: "master", flavor: "b2-7", image: "img-1", tag: "prod" } })
      expect(info).toEqual({ id: "srv-1", name: "master-1", ip: "10.0.0.5" })
      expect(fake.calls().filter((call) => call.method === "POST" && call.url.includes("/v2.1/servers")).length).toBe(1)
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("deleteByTag removes resources in reverse dependency order", () => {
    const deleted: Array<string> = []
    const lb = { status: "ACTIVE" }
    const fake = makeFakeOpenStack({
      ..._octaviaRoutes({ deleted, lb, onDelete: "DELETED" }),
      "GET /v2.0/floatingips": () => ({ status: 200, body: { floatingips: [{ id: "fip-1" }] } }),
      "DELETE /v2.0/floatingips/fip-1": () => {
        deleted.push("floating-ip")
        return { status: 204 }
      },
      "GET /v2.1/servers/detail": () => ({ status: 200, body: { servers: [{ id: "srv-1" }] } }),
      "DELETE /v2.1/servers/srv-1": () => {
        deleted.push("server")
        return { status: 204 }
      },
      "GET /v2.1/os-server-groups": () => ({ status: 200, body: { server_groups: [{ id: "grp-masters", name: "kumulo-prod-masters" }, { id: "grp-workers", name: "kumulo-prod-workers" }] } }),
      "DELETE /v2.1/os-server-groups/grp-masters": () => {
        deleted.push("server-group")
        return { status: 204 }
      },
      "DELETE /v2.1/os-server-groups/grp-workers": () => {
        deleted.push("server-group")
        return { status: 204 }
      },
      "GET /v2.0/security-groups": () => ({ status: 200, body: { security_groups: [{ id: "sg-1" }] } }),
      "DELETE /v2.0/security-groups/sg-1": () => {
        deleted.push("security-group")
        return { status: 204 }
      },
      "GET /v2.0/networks": () => ({ status: 200, body: { networks: [{ id: "net-1" }] } }),
      "GET /v2.0/subnets": () => ({ status: 200, body: { subnets: [] } }),
      "GET /v2.0/routers": () => ({ status: 200, body: { routers: [] } }),
      "DELETE /v2.0/networks/net-1": () => {
        deleted.push("network")
        return { status: 204 }
      }
    })
    return Effect.gen(function*() {
      yield* deleteByTag({ options })
      expect(deleted).toEqual(["lb", "floating-ip", "server", "server-group", "server-group", "security-group", "network"])
    }).pipe(Effect.provide(fake.layer))
  })

  // landmine: Octavia DELETE returns immediately, VIP port stays until PENDING_DELETE resolves; teardown must block on status
  it.effect("deleteByTag waits out a PENDING_DELETE load balancer before deleting the network", () => {
    const deleted: Array<string> = []
    const lb = { status: "ACTIVE" }
    const fake = makeFakeOpenStack({
      ..._octaviaRoutes({ deleted, lb, onDelete: "PENDING_DELETE" }),
      "GET /v2.0/floatingips": () => ({ status: 200, body: { floatingips: [] } }),
      "GET /v2.1/servers/detail": () => ({ status: 200, body: { servers: [] } }),
      "GET /v2.1/os-server-groups": () => ({ status: 200, body: { server_groups: [] } }),
      "GET /v2.0/security-groups": () => ({ status: 200, body: { security_groups: [] } }),
      "GET /v2.0/networks": () => ({ status: 200, body: { networks: [{ id: "net-1" }] } }),
      "GET /v2.0/subnets": () => ({ status: 200, body: { subnets: [] } }),
      "GET /v2.0/routers": () => ({ status: 200, body: { routers: [] } }),
      "DELETE /v2.0/networks/net-1": () => {
        deleted.push("network")
        return { status: 204 }
      }
    })
    return Effect.gen(function*() {
      const fiber = yield* deleteByTag({ options }).pipe(Effect.provide(fake.layer), Effect.forkChild)
      yield* TestClock.adjust("2 minutes")
      expect(deleted).toEqual(["lb"])
      lb.status = "DELETED"
      yield* TestClock.adjust("10 seconds")
      yield* Fiber.join(fiber)
      expect(deleted).toEqual(["lb", "network"])
    })
  })

  it.effect("a network still holding ports fails loudly, naming the network and the remedy", () => {
    const fake = makeFakeOpenStack({
      "GET /v2/lbaas/loadbalancers": () => ({ status: 200, body: { loadbalancers: [] } }),
      "GET /v2.0/floatingips": () => ({ status: 200, body: { floatingips: [] } }),
      "GET /v2.1/servers/detail": () => ({ status: 200, body: { servers: [] } }),
      "GET /v2.1/os-server-groups": () => ({ status: 200, body: { server_groups: [] } }),
      "GET /v2.0/security-groups": () => ({ status: 200, body: { security_groups: [] } }),
      "GET /v2.0/networks": () => ({ status: 200, body: { networks: [{ id: "net-1" }] } }),
      "GET /v2.0/subnets": () => ({ status: 200, body: { subnets: [] } }),
      "GET /v2.0/routers": () => ({ status: 200, body: { routers: [] } }),
      "DELETE /v2.0/networks/net-1": () => ({
        status: 409,
        body: { NeutronError: { message: "There are one or more ports still in use on the network." } }
      })
    })
    return Effect.gen(function*() {
      const failure = yield* Effect.flip(deleteByTag({ options }))
      expect(failure).toMatchObject({
        _tag: "ResourceConflict",
        kind: "network-in-use",
        ref: expect.stringContaining("net-1")
      })
      expect(failure).toMatchObject({ ref: expect.stringContaining("ports") })
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("listClusterResources aggregates servers/network/secgroup/lb into an Inventory", () => {
    const fake = makeFakeOpenStack({
      "GET /v2.1/servers/detail": () => ({
        status: 200,
        body: { servers: [{ id: "srv-1", name: "master-1", addresses: {}, metadata: { "kumulo-config-hash": "abc" } }] }
      }),
      "GET /v2.0/networks": () => ({ status: 200, body: { networks: [{ id: "net-1" }] } }),
      "GET /v2.0/subnets": () => ({ status: 200, body: { subnets: [] } }),
      "GET /v2.0/routers": () => ({ status: 200, body: { routers: [] } }),
      "GET /v2.0/security-groups": () => ({ status: 200, body: { security_groups: [{ id: "sg-1" }] } }),
      "GET /v2/lbaas/loadbalancers": () => ({ status: 200, body: { loadbalancers: [] } })
    })
    return Effect.gen(function*() {
      const inventory = yield* listClusterResources({ options })
      expect(inventory.servers).toEqual([{ id: "srv-1", name: "master-1", ip: "", configHash: "abc" }])
      expect(inventory.networks).toEqual([{ id: "net-1", cidr: "" }])
      expect(inventory.securityGroups).toEqual([{ id: "sg-1" }])
      expect(inventory.loadBalancers).toEqual([])
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("resolveImage resolves via alias, exact name, then fuzzy fallback", () => {
    const fake = makeFakeOpenStack({
      "GET /v2/images": (request) => {
        const name = new URL(request.url).searchParams.get("name")
        if (name === "Ubuntu 24.04") return { status: 200, body: { images: [{ id: IMG_1, name: "Ubuntu 24.04" }] } }
        if (name === "debian") return { status: 200, body: { images: [] } }
        return { status: 200, body: { images: [{ id: IMG_2, name: "Debian 12 (GenericCloud)" }] } }
      }
    })
    return Effect.gen(function*() {
      const aliased = yield* resolveImage({ options, ref: "ubuntu-24.04" })
      expect(aliased).toBe(IMG_1)
      const fuzzy = yield* resolveImage({ options, ref: "debian" })
      expect(fuzzy).toBe(IMG_2)
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("ensureServer deletes an existing ERROR-state server and recreates it", () => {
    let deleted = false
    const fake = makeFakeOpenStack({
      "GET /v2.1/servers": () => ({ status: 200, body: { servers: deleted ? [] : [{ id: "srv-broken" }] } }),
      "GET /v2.1/servers/srv-broken": () => deleted ? { status: 404 } : { status: 200, body: { server: { id: "srv-broken", status: "ERROR" } } },
      "DELETE /v2.1/servers/srv-broken": () => {
        deleted = true
        return { status: 204 }
      },
      "GET /v2.1/os-server-groups": () => ({ status: 200, body: { server_groups: [{ id: "grp-masters", name: "kumulo-prod-masters" }] } }),
      "POST /v2.1/servers": () => ({ status: 202, body: { server: { id: "srv-new" } } }),
      "GET /v2.1/servers/srv-new": () => ({
        status: 200,
        body: { server: { id: "srv-new", status: "ACTIVE", addresses: { "kumulo-prod": [{ addr: "10.0.0.9" }] } } }
      })
    })
    return Effect.gen(function*() {
      const info = yield* ensureServer({ options, spec: { name: "master-1", role: "master", flavor: "b2-7", image: "img-1", tag: "prod" } })
      expect(info).toEqual({ id: "srv-new", name: "master-1", ip: "10.0.0.9" })
      expect(deleted).toBe(true)
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("ensureServer tears down a server that never reaches ACTIVE", () => {
    let deleted = false
    const fake = makeFakeOpenStack({
      "GET /v2.1/servers": () => ({ status: 200, body: { servers: [] } }),
      "GET /v2.1/os-server-groups": () => ({ status: 200, body: { server_groups: [{ id: "grp-masters", name: "kumulo-prod-masters" }] } }),
      "POST /v2.1/servers": () => ({ status: 202, body: { server: { id: "srv-1" } } }),
      "GET /v2.1/servers/srv-1": () => deleted ? { status: 404 } : { status: 200, body: { server: { id: "srv-1", status: "ERROR" } } },
      "DELETE /v2.1/servers/srv-1": () => {
        deleted = true
        return { status: 204 }
      }
    })
    return Effect.gen(function*() {
      const error = yield* Effect.flip(
        ensureServer({ options, spec: { name: "master-1", role: "master", flavor: "b2-7", image: "img-1", tag: "prod" } })
      )
      expect(error).toBeInstanceOf(ProvisioningTimeout)
      expect(deleted).toBe(true)
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("resolveImage follows Glance's `next` link instead of stopping at page one", () => {
    const fake = makeFakeOpenStack({
      "GET /v2/images": (request) => {
        const params = new URL(request.url).searchParams
        if (params.get("name") !== null) return { status: 200, body: { images: [] } }
        if (params.get("marker") === IMG_1) return { status: 200, body: { images: [{ id: IMG_2, name: "Debian 12 (GenericCloud)" }] } }
        return { status: 200, body: { images: [{ id: IMG_1, name: "Ubuntu 24.04" }], next: `/v2/images?marker=${IMG_1}` } }
      }
    })
    return Effect.gen(function*() {
      expect(yield* resolveImage({ options, ref: "debian" })).toBe(IMG_2)
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("listClusterResources follows Nova's `servers_links` pagination", () => {
    const fake = makeFakeOpenStack({
      "GET /v2.1/servers/detail": (request) =>
        new URL(request.url).searchParams.get("marker") === "srv-1"
          ? { status: 200, body: { servers: [{ id: "srv-2", name: "worker-1", addresses: {} }] } }
          : {
            status: 200,
            body: {
              servers: [{ id: "srv-1", name: "master-1", addresses: {} }],
              servers_links: [{ rel: "next", href: "https://compute.example.com/v2.1/servers?marker=srv-1" }]
            }
          },
      "GET /v2.0/networks": () => ({ status: 200, body: { networks: [] } }),
      "GET /v2.0/security-groups": () => ({ status: 200, body: { security_groups: [] } }),
      "GET /v2/lbaas/loadbalancers": () => ({ status: 200, body: { loadbalancers: [] } })
    })
    return Effect.gen(function*() {
      const inventory = yield* listClusterResources({ options })
      expect(inventory.servers.map((server) => server.id)).toEqual(["srv-1", "srv-2"])
    }).pipe(Effect.provide(fake.layer))
  })

  const _fakeFloatingIps = (tag: string) => {
    const fips: Array<Record<string, string>> = []
    return {
      fips,
      orphan: () => fips.forEach((fip) => delete fip["port_id"]),
      ...makeFakeOpenStack({
        "GET /v2.0/networks": (request) =>
          new URL(request.url).searchParams.get("router:external") === "true"
            ? { status: 200, body: { networks: [{ id: "ext-net", name: "Ext-Net" }] } }
            : { status: 200, body: { networks: [{ id: "net-1", name: `kumulo-${tag}` }] } },
        "GET /v2.0/floatingips": (request) => {
          const description = new URL(request.url).searchParams.get("description")
          return { status: 200, body: { floatingips: fips.filter((fip) => fip.description === description) } }
        },
        "POST /v2.0/floatingips": (request) => {
          const index = fips.length + 1
          const fip = { id: `fip-${index}`, floating_ip_address: `203.0.113.${index}`, ..._postedFloatingIp(requestJson(request)) }
          fips.push(fip)
          return { status: 201, body: { floatingip: fip } }
        },
        "PUT /v2.0/floatingips/fip-1": (request) => {
          const patch = _postedFloatingIp(requestJson(request))
          const fip = Object.assign(fips[0] ?? {}, patch)
          return { status: 200, body: { floatingip: fip } }
        },
        "DELETE /v2.0/floatingips/fip-1": () => {
          fips.length = 0
          return { status: 204 }
        }
      })
    }
  }

  it.effect("ensureFloatingIp allocates on the external network and associates it to the VIP port in one call", () => {
    const fake = _fakeFloatingIps("prod")
    return Effect.gen(function*() {
      const info = yield* ensureFloatingIp({ options, portId: "port-vip" })
      expect(info).toEqual({ id: "fip-1", address: "203.0.113.1" })
      expect(fake.fips).toEqual([{
        id: "fip-1",
        floating_ip_address: "203.0.113.1",
        floating_network_id: "ext-net",
        port_id: "port-vip",
        description: "kumulo-prod"
      }])
      expect(fake.calls().filter((call) => call.url.includes("router%3Aexternal=true")).length).toBe(1)
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("ensureFloatingIp re-associates an adopted floating IP orphaned by a recreated load balancer", () => {
    const fake = _fakeFloatingIps("prod")
    return Effect.gen(function*() {
      yield* ensureFloatingIp({ options, portId: "port-vip" })
      fake.orphan()
      const info = yield* ensureFloatingIp({ options, portId: "port-vip-2" })
      expect(info).toEqual({ id: "fip-1", address: "203.0.113.1" })
      expect(fake.fips[0]?.["port_id"]).toBe("port-vip-2")
      expect(fake.calls().filter((call) => call.method === "POST").length).toBe(1)
    }).pipe(Effect.provide(fake.layer))
  })

  const _tagArb = fc.stringMatching(/^[a-z][a-z0-9-]{0,12}$/)

  it.effect.prop(
    "ensureFloatingIp is idempotent: the second call adopts the first's allocation, keyed by description",
    [_tagArb],
    ([tag]) => {
      const fake = _fakeFloatingIps(tag)
      const scoped = { ...options, tag }
      return Effect.gen(function*() {
        const first = yield* ensureFloatingIp({ options: scoped, portId: "port-vip" })
        const second = yield* ensureFloatingIp({ options: scoped, portId: "port-vip" })
        expect(second).toEqual(first)
        expect(first.address).not.toBe("")
        expect(fake.calls().filter((call) => call.method === "POST").length).toBe(1)
        expect(fake.calls().some((call) => call.url.includes(`description=kumulo-${tag}`))).toBe(true)
      }).pipe(Effect.provide(fake.layer))
    }
  )

  it.effect("releaseFloatingIp deletes the cluster's floating IP and is a no-op when there is none", () => {
    const fake = _fakeFloatingIps("prod")
    return Effect.gen(function*() {
      yield* releaseFloatingIp({ options })
      expect(fake.calls().filter((call) => call.method === "DELETE")).toEqual([])
      yield* ensureFloatingIp({ options, portId: "port-vip" })
      yield* releaseFloatingIp({ options })
      expect(fake.calls().filter((call) => call.method === "DELETE").length).toBe(1)
      yield* releaseFloatingIp({ options })
      expect(fake.calls().filter((call) => call.method === "DELETE").length).toBe(1)
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("resolveFlavor fails with ResourceNotFound when nothing matches", () => {
    const fake = makeFakeOpenStack({
      "GET /v2.1/flavors": () => ({ status: 200, body: { flavors: [] } }),
      "GET /v2.1/flavors/detail": () => ({ status: 200, body: { flavors: [] } })
    })
    return Effect.gen(function*() {
      const exit = yield* Effect.flip(resolveFlavor({ options, ref: "nope" }))
      expect(exit).toBeInstanceOf(ResourceNotFound)
    }).pipe(Effect.provide(fake.layer))
  })
})

// landmine: OVH sends ipv4/ipv6_address_scope as null and l2_adjacency as boolean, all typed string by the Neutron spec
const _OVH_NETWORK = {
  id: "net-1",
  name: "kumulo-prod",
  ipv4_address_scope: null,
  ipv6_address_scope: null,
  l2_adjacency: true,
  qos_policy_id: null
}

it.effect("decodes the network shape OVH actually returns, on create and on list", () => {
  const fake = makeFakeOpenStack({
    "GET /v2.0/networks": () => ({ status: 200, body: { networks: [_OVH_NETWORK] } }),
    "POST /v2.0/networks": () => ({ status: 201, body: { network: _OVH_NETWORK } }),
    "GET /v2.0/subnets": () => ({ status: 200, body: { subnets: [{ id: "sub-1", cidr: "10.0.0.0/24" }] } }),
    "POST /v2.0/subnets": () => ({ status: 201, body: { subnet: { id: "sub-1", cidr: "10.0.0.0/24" } } })
  })
  return Effect.gen(function*() {
    const found = yield* findNetwork({ options, spec: { cidr: "10.0.0.0/24" } })
    expect(found?.id).toBe("net-1")
    const info = yield* ensureNetwork({ options, spec: { cidr: "10.0.0.0/24" } })
    expect(info.id).toBe("net-1")
  }).pipe(Effect.provide(fake.layer))
})

describe("hasGateway", () => {
  const _routersFake = (routers: ReadonlyArray<{ readonly id: string; readonly name: string }>) =>
    makeFakeOpenStack({ "GET /v2.0/routers": () => ({ status: 200, body: { routers } }) })

  it.effect("reports an existing gateway by the cluster's router name", () =>
    Effect.gen(function*() {
      expect(yield* hasGateway({ options, name: "kumulo-prod" })).toBe(true)
    }).pipe(Effect.provide(_routersFake([{ id: "router-1", name: "kumulo-prod" }]).layer)))

  it.effect("reports none when the project has no such router", () =>
    Effect.gen(function*() {
      expect(yield* hasGateway({ options, name: "kumulo-prod" })).toBe(false)
    }).pipe(Effect.provide(_routersFake([]).layer)))

})
