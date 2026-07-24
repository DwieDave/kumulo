import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { CapabilityMissing, ResourceNotFound } from "@kumulo/core"
import {
  deleteByTag,
  ensureLoadBalancer,
  ensureNetwork,
  ensureSecurityGroups,
  ensureServer,
  ensureServerGroups,
  listClusterResources,
  resolveFlavor,
  resolveImage,
  type CloudProviderOptions
} from "../../src/provider/cloud-provider.ts"
import { makeFakeOpenStack } from "./fake-openstack.ts"

const options: CloudProviderOptions = {
  tag: "prod",
  region: "gra",
  octaviaEnabled: true,
  imageAliases: { "ubuntu-24.04": "Ubuntu 24.04" }
}

describe("openstack CloudProvider", () => {
  it.effect("ensureNetwork creates then reuses by name", () => {
    let created = false
    const fake = makeFakeOpenStack({
      "GET /v2.0/networks": () =>
        created ? { status: 200, body: { networks: [{ id: "net-1" }] } } : { status: 200, body: { networks: [] } },
      "POST /v2.0/networks": () => {
        created = true
        return { status: 201, body: { network: { id: "net-1" } } }
      },
      "POST /v2.0/subnets": () => ({ status: 201, body: { subnet: { id: "sub-1" } } })
    })
    return Effect.gen(function*() {
      const first = yield* ensureNetwork({ options, spec: { cidr: "10.0.0.0/24" } })
      const second = yield* ensureNetwork({ options, spec: { cidr: "10.0.0.0/24" } })
      expect(first).toEqual({ id: "net-1", cidr: "10.0.0.0/24" })
      expect(second).toEqual({ id: "net-1", cidr: "10.0.0.0/24" })
      expect(fake.calls().filter((call) => call.method === "POST" && call.url.includes("/v2.0/networks")).length).toBe(1)
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("ensureSecurityGroups decodes security group rules and tolerates already-applied (409) rules", () => {
    const fake = makeFakeOpenStack({
      "GET /v2.0/security-groups": () => ({ status: 200, body: { security_groups: [] } }),
      "POST /v2.0/security-groups": () => ({ status: 201, body: { security_group: { id: "sg-1" } } }),
      "POST /v2.0/security-group-rules": () => ({ status: 409 })
    })
    const rules = [
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
    return Effect.gen(function*() {
      const exit = yield* Effect.flip(ensureSecurityGroups({ options, spec: { rules: [{ nonsense: true }] } }))
      expect(exit).toBeInstanceOf(ResourceNotFound)
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("ensureServerGroups is idempotent per role", () => {
    const fake = makeFakeOpenStack({
      "GET /v2.1/os-server-groups": () => ({ status: 200, body: { server_groups: [{ id: "grp-masters" }] } })
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

  it.effect("ensureServer creates, waits for ACTIVE, and re-ensures idempotently by name", () => {
    const fake = makeFakeOpenStack({
      "GET /v2.1/servers": () => ({ status: 200, body: { servers: [] } }),
      "GET /v2.1/os-server-groups": () => ({ status: 200, body: { server_groups: [{ id: "grp-masters" }] } }),
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
    const fake = makeFakeOpenStack({
      "GET /v2/lbaas/loadbalancers": () => ({ status: 200, body: { loadbalancers: [{ id: "lb-1" }] } }),
      "DELETE /v2/lbaas/loadbalancers/lb-1": () => {
        deleted.push("lb")
        return { status: 204 }
      },
      "GET /v2.1/servers": () => ({ status: 200, body: { servers: [{ id: "srv-1" }] } }),
      "DELETE /v2.1/servers/srv-1": () => {
        deleted.push("server")
        return { status: 204 }
      },
      "GET /v2.1/os-server-groups": () => ({ status: 200, body: { server_groups: [{ id: "grp-1" }] } }),
      "DELETE /v2.1/os-server-groups/grp-1": () => {
        deleted.push("server-group")
        return { status: 204 }
      },
      "GET /v2.0/security-groups": () => ({ status: 200, body: { security_groups: [{ id: "sg-1" }] } }),
      "DELETE /v2.0/security-groups/sg-1": () => {
        deleted.push("security-group")
        return { status: 204 }
      },
      "GET /v2.0/networks": () => ({ status: 200, body: { networks: [{ id: "net-1" }] } }),
      "DELETE /v2.0/networks/net-1": () => {
        deleted.push("network")
        return { status: 204 }
      }
    })
    return Effect.gen(function*() {
      yield* deleteByTag({ options })
      expect(deleted).toEqual(["lb", "server", "server-group", "server-group", "security-group", "network"])
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("listClusterResources aggregates servers/network/secgroup/lb into an Inventory", () => {
    const fake = makeFakeOpenStack({
      "GET /v2.1/servers": () => ({ status: 200, body: { servers: [{ id: "srv-1", name: "master-1", addresses: {} }] } }),
      "GET /v2.0/networks": () => ({ status: 200, body: { networks: [{ id: "net-1" }] } }),
      "GET /v2.0/security-groups": () => ({ status: 200, body: { security_groups: [{ id: "sg-1" }] } }),
      "GET /v2/lbaas/loadbalancers": () => ({ status: 200, body: { loadbalancers: [] } })
    })
    return Effect.gen(function*() {
      const inventory = yield* listClusterResources({ options })
      expect(inventory.servers).toEqual([{ id: "srv-1", name: "master-1", ip: "" }])
      expect(inventory.networks).toEqual([{ id: "net-1", cidr: "" }])
      expect(inventory.securityGroups).toEqual([{ id: "sg-1" }])
      expect(inventory.loadBalancers).toEqual([])
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("resolveImage resolves via alias, exact name, then fuzzy fallback", () => {
    const fake = makeFakeOpenStack({
      "GET /v2/images": (request) => {
        const name = new URL(request.url).searchParams.get("name")
        if (name === "Ubuntu 24.04") return { status: 200, body: { images: [{ id: "img-1", name: "Ubuntu 24.04" }] } }
        if (name === "debian") return { status: 200, body: { images: [] } }
        return { status: 200, body: { images: [{ id: "img-2", name: "Debian 12 (GenericCloud)" }] } }
      }
    })
    return Effect.gen(function*() {
      const aliased = yield* resolveImage({ options, ref: "ubuntu-24.04" })
      expect(aliased).toBe("img-1")
      const fuzzy = yield* resolveImage({ options, ref: "debian" })
      expect(fuzzy).toBe("img-2")
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
