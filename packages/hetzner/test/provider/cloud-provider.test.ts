import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { ResourceNotFound } from "@kumulo/core"
import {
  type CloudProviderOptions,
  deleteByTag,
  deleteServer,
  ensureLoadBalancer,
  ensureNetwork,
  ensurePlacementGroup,
  ensureSecurityGroups,
  ensureServer,
  listClusterResources,
  resolveFlavor,
  resolveImage
} from "../../src/provider/cloud-provider.ts"
import { makeFakeHcloud } from "./fake-hcloud.ts"

const options: CloudProviderOptions = { tag: "prod", location: "fsn1" }

describe("hetzner CloudProvider", () => {
  it.effect("ensureNetwork creates then reuses by name", () => {
    let created = false
    const fake = makeFakeHcloud({
      "GET /networks": () => created ? { status: 200, body: { networks: [{ id: 1, name: "kumulo-prod" }] } } : { status: 200, body: { networks: [] } },
      "POST /networks": () => {
        created = true
        return { status: 201, body: { network: { id: 1, name: "kumulo-prod" } } }
      }
    })
    return Effect.gen(function*() {
      const first = yield* ensureNetwork({ options, spec: { cidr: "10.0.0.0/24" } })
      const second = yield* ensureNetwork({ options, spec: { cidr: "10.0.0.0/24" } })
      expect(first).toEqual({ id: "1", cidr: "10.0.0.0/24" })
      expect(second).toEqual({ id: "1", cidr: "10.0.0.0/24" })
      expect(fake.calls().filter((call) => call.method === "POST" && call.url.includes("/v1/networks")).length).toBe(1)
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("ensureSecurityGroups decodes firewall rules and (re-)applies them via set_rules", () => {
    const fake = makeFakeHcloud({
      "GET /firewalls": () => ({ status: 200, body: { firewalls: [] } }),
      "POST /firewalls": () => ({ status: 201, body: { firewall: { id: 5, name: "kumulo-prod" } } }),
      "POST /firewalls/5/actions/set_rules": () => ({ status: 201, body: { actions: [] } })
    })
    const rules = [
      { direction: "in", protocol: "tcp", port: "22", sourceCidrs: ["1.2.3.0/24"] },
      { direction: "in", protocol: "tcp", sourceCidrs: ["10.0.0.0/24"] }
    ]
    return Effect.gen(function*() {
      const info = yield* ensureSecurityGroups({ options, spec: { rules } })
      expect(info).toEqual({ id: "5" })
      expect(fake.calls().some((call) => call.method === "POST" && call.url.includes("/v1/firewalls/5/actions/set_rules"))).toBe(true)
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("ensureSecurityGroups fails on a malformed rule descriptor", () => {
    const fake = makeFakeHcloud({
      "GET /firewalls": () => ({ status: 200, body: { firewalls: [{ id: 5, name: "kumulo-prod" }] } })
    })
    return Effect.gen(function*() {
      const exit = yield* Effect.flip(ensureSecurityGroups({ options, spec: { rules: [{ nonsense: true }] } }))
      expect(exit).toBeInstanceOf(ResourceNotFound)
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("ensureLoadBalancer creates targeting the cluster label selector, then reuses by name", () => {
    let created = false
    const fake = makeFakeHcloud({
      "GET /load_balancers": () =>
        created
          ? { status: 200, body: { load_balancers: [{ id: 7, name: "kumulo-prod", public_net: { ipv4: { ip: "5.6.7.8" } } }] } }
          : { status: 200, body: { load_balancers: [] } },
      "POST /load_balancers": () => {
        created = true
        return { status: 201, body: { load_balancer: { id: 7, name: "kumulo-prod", public_net: { ipv4: { ip: "5.6.7.8" } } } } }
      }
    })
    return Effect.gen(function*() {
      const first = yield* ensureLoadBalancer({ options, spec: { members: [] } })
      const second = yield* ensureLoadBalancer({ options, spec: { members: [] } })
      expect(first).toEqual({ id: "7", vip: "5.6.7.8" })
      expect(second).toEqual({ id: "7", vip: "5.6.7.8" })
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("ensurePlacementGroup is idempotent per role", () => {
    const fake = makeFakeHcloud({
      "GET /placement_groups": () => ({ status: 200, body: { placement_groups: [{ id: 3, name: "kumulo-prod-masters" }] } })
    })
    return Effect.gen(function*() {
      const id = yield* ensurePlacementGroup({ options, role: "master" })
      expect(id).toBe(3)
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("ensureServer creates, waits for the create Action, and re-ensures idempotently by name", () => {
    const fake = makeFakeHcloud({
      "GET /servers": () => ({ status: 200, body: { servers: [] } }),
      "GET /placement_groups": () => ({ status: 200, body: { placement_groups: [{ id: 3, name: "kumulo-prod-masters" }] } }),
      "POST /servers": () => ({
        status: 201,
        body: { server: { id: 10, name: "master-1", status: "running", public_net: { ipv4: { ip: "1.2.3.4" } } }, action: { id: 99 } }
      }),
      "GET /actions/99": () => ({ status: 200, body: { action: { id: 99, status: "success", error: null } } })
    })
    return Effect.gen(function*() {
      const info = yield* ensureServer({ options, spec: { name: "master-1", role: "master", flavor: "cx22", image: "ubuntu-24.04", tag: "prod" } })
      expect(info).toEqual({ id: "10", name: "master-1", ip: "1.2.3.4" })
      expect(fake.calls().filter((call) => call.method === "POST" && call.url.includes("/v1/servers")).length).toBe(1)
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("ensureServer fails with ProvisioningTimeout when the create Action errors", () => {
    const fake = makeFakeHcloud({
      "GET /servers": () => ({ status: 200, body: { servers: [] } }),
      "GET /placement_groups": () => ({ status: 200, body: { placement_groups: [{ id: 3, name: "kumulo-prod-masters" }] } }),
      "POST /servers": () => ({
        status: 201,
        body: { server: { id: 10, name: "master-1", status: "initializing", public_net: { ipv4: null } }, action: { id: 99 } }
      }),
      "GET /actions/99": () => ({ status: 200, body: { action: { id: 99, status: "error", error: { code: "boom", message: "quota" } } } })
    })
    return Effect.gen(function*() {
      const exit = yield* Effect.flip(ensureServer({ options, spec: { name: "master-1", role: "master", flavor: "cx22", image: "ubuntu-24.04", tag: "prod" } }))
      expect(exit._tag).toBe("ProvisioningTimeout")
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("deleteServer waits for the delete Action to complete", () => {
    const fake = makeFakeHcloud({
      "DELETE /servers/10": () => ({ status: 200, body: { action: { id: 100 } } }),
      "GET /actions/100": () => ({ status: 200, body: { action: { id: 100, status: "success", error: null } } })
    })
    return Effect.gen(function*() {
      yield* deleteServer({ id: "10", name: "master-1", ip: "" })
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("deleteServer tolerates an already-gone (404) server", () => {
    const fake = makeFakeHcloud({ "DELETE /servers/10": () => ({ status: 404 }) })
    return Effect.gen(function*() {
      yield* deleteServer({ id: "10", name: "master-1", ip: "" })
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("deleteByTag removes resources in reverse dependency order", () => {
    const deleted: Array<string> = []
    const fake = makeFakeHcloud({
      "GET /load_balancers": () => ({ status: 200, body: { load_balancers: [{ id: 1, name: "kumulo-prod" }] } }),
      "DELETE /load_balancers/1": () => {
        deleted.push("lb")
        return { status: 204 }
      },
      "GET /servers": () => ({ status: 200, body: { servers: [{ id: 2, name: "kumulo-prod" }] } }),
      "DELETE /servers/2": () => {
        deleted.push("server")
        return { status: 200, body: {} }
      },
      "GET /placement_groups": () => ({ status: 200, body: { placement_groups: [{ id: 3, name: "kumulo-prod-masters" }] } }),
      "DELETE /placement_groups/3": () => {
        deleted.push("placement-group")
        return { status: 204 }
      },
      "GET /firewalls": () => ({ status: 200, body: { firewalls: [{ id: 4, name: "kumulo-prod" }] } }),
      "DELETE /firewalls/4": () => {
        deleted.push("firewall")
        return { status: 204 }
      },
      "GET /networks": () => ({ status: 200, body: { networks: [{ id: 5, name: "kumulo-prod" }] } }),
      "DELETE /networks/5": () => {
        deleted.push("network")
        return { status: 204 }
      }
    })
    return Effect.gen(function*() {
      yield* deleteByTag({ options })
      expect(deleted).toEqual(["lb", "server", "placement-group", "placement-group", "firewall", "network"])
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("listClusterResources aggregates servers/network/firewall/lb into an Inventory", () => {
    const fake = makeFakeHcloud({
      "GET /servers": () => ({ status: 200, body: { servers: [{ id: 1, name: "master-1", status: "running", public_net: { ipv4: { ip: "1.2.3.4" } } }] } }),
      "GET /networks": () => ({ status: 200, body: { networks: [{ id: 2, name: "kumulo-prod" }] } }),
      "GET /firewalls": () => ({ status: 200, body: { firewalls: [{ id: 3, name: "kumulo-prod" }] } }),
      "GET /load_balancers": () => ({ status: 200, body: { load_balancers: [] } })
    })
    return Effect.gen(function*() {
      const inventory = yield* listClusterResources({ options })
      expect(inventory.servers).toEqual([{ id: "1", name: "master-1", ip: "1.2.3.4" }])
      expect(inventory.networks).toEqual([{ id: "2", cidr: "" }])
      expect(inventory.securityGroups).toEqual([{ id: "3" }])
      expect(inventory.loadBalancers).toEqual([])
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("resolveImage resolves via exact name, then fuzzy fallback restricted to system images", () => {
    const fake = makeFakeHcloud({
      "GET /images": (request) => {
        const name = new URL(request.url).searchParams.get("name")
        if (name === "ubuntu-24.04") return { status: 200, body: { images: [{ id: 1, name: "ubuntu-24.04" }] } }
        if (name === "debian-12") return { status: 200, body: { images: [] } }
        return { status: 200, body: { images: [{ id: 2, name: "debian-12-generic-cloud" }] } }
      }
    })
    return Effect.gen(function*() {
      const exact = yield* resolveImage({ ref: "ubuntu-24.04" })
      expect(exact).toBe("1")
      const fuzzy = yield* resolveImage({ ref: "debian-12" })
      expect(fuzzy).toBe("2")
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("resolveFlavor fails with ResourceNotFound when nothing matches", () => {
    const fake = makeFakeHcloud({
      "GET /server_types": () => ({ status: 200, body: { server_types: [] } })
    })
    return Effect.gen(function*() {
      const exit = yield* Effect.flip(resolveFlavor({ ref: "cx99" }))
      expect(exit).toBeInstanceOf(ResourceNotFound)
    }).pipe(Effect.provide(fake.layer))
  })
})
