import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { ResourceNotFound } from "@kumulo/core"
import type { SecGroupRule } from "@kumulo/core"
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
import { makeFakeHcloud, requestJson } from "./fake-hcloud.ts"
import * as fixture from "./fixtures.ts"

const options: CloudProviderOptions = { tag: "prod", location: "fsn1" }

const _page = (request: { readonly url: string }): string => new URL(request.url).searchParams.get("page") ?? "1"

describe("hetzner CloudProvider", () => {
  it.effect("ensureNetwork creates then reuses by name", () => {
    let created = false
    const fake = makeFakeHcloud({
      "GET /networks": () => ({
        status: 200,
        body: { networks: created ? [fixture.network({ id: 1, name: "kumulo-prod" })] : [], meta: fixture.meta() }
      }),
      "POST /networks": () => {
        created = true
        return { status: 201, body: { network: fixture.network({ id: 1, name: "kumulo-prod" }) } }
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

  // The cluster label is what `deleteByTag`/`listClusterResources` find
  // resources by, and the generated request schema types `labels` as an
  // empty struct — a payload encoding that dropped it would orphan every
  // resource this provider creates.
  it.effect("ensureNetwork sends the cluster label on create", () => {
    let payload: unknown
    const fake = makeFakeHcloud({
      "GET /networks": () => ({ status: 200, body: { networks: [], meta: fixture.meta() } }),
      "POST /networks": (request) => {
        payload = requestJson(request)
        return { status: 201, body: { network: fixture.network({ id: 1, name: "kumulo-prod" }) } }
      }
    })
    return Effect.gen(function*() {
      yield* ensureNetwork({ options, spec: { cidr: "10.0.0.0/24" } })
      expect(payload).toMatchObject({ labels: { "kumulo-cluster": "prod" } })
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("ensureSecurityGroups decodes firewall rules and (re-)applies them via set_rules", () => {
    const fake = makeFakeHcloud({
      "GET /firewalls": () => ({ status: 200, body: { firewalls: [], meta: fixture.meta() } }),
      "POST /firewalls": () => ({ status: 201, body: { firewall: fixture.firewall({ id: 5, name: "kumulo-prod" }) } }),
      "POST /firewalls/5/actions/set_rules": () => ({ status: 201, body: { actions: [] } })
    })
    const rules: ReadonlyArray<SecGroupRule> = [
      { protocol: "tcp", portMin: 22, portMax: 22, remoteCidr: "1.2.3.0/24" },
      { protocol: "tcp", remoteCidr: "10.0.0.0/24" }
    ]
    return Effect.gen(function*() {
      const info = yield* ensureSecurityGroups({ options, spec: { rules } })
      expect(info).toEqual({ id: "5" })
      expect(fake.calls().some((call) => call.method === "POST" && call.url.includes("/v1/firewalls/5/actions/set_rules"))).toBe(true)
    }).pipe(Effect.provide(fake.layer))
  })

  // hcloud Firewalls have neither an `any` protocol nor a security-group
  // self-reference, so those two neutral rules cannot be translated.
  it.effect("ensureSecurityGroups fails on rules hcloud cannot express", () => {
    const fake = makeFakeHcloud({
      "GET /firewalls": () => ({ status: 200, body: { firewalls: [fixture.firewall({ id: 5, name: "kumulo-prod" })], meta: fixture.meta() } })
    })
    return Effect.gen(function*() {
      const exit = yield* Effect.flip(ensureSecurityGroups({ options, spec: { rules: [{ protocol: "any", remoteCidr: "0.0.0.0/0" }] } }))
      expect(exit).toBeInstanceOf(ResourceNotFound)
      const selfRef = yield* Effect.flip(ensureSecurityGroups({ options, spec: { rules: [{ protocol: "tcp", remoteGroupSelf: true }] } }))
      expect(selfRef).toBeInstanceOf(ResourceNotFound)
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("ensureLoadBalancer creates targeting the cluster label selector, then reuses by name", () => {
    let created = false
    const lb = fixture.loadBalancer({ id: 7, name: "kumulo-prod", ip: "5.6.7.8" })
    const fake = makeFakeHcloud({
      "GET /load_balancers": () => ({ status: 200, body: { load_balancers: created ? [lb] : [], meta: fixture.meta() } }),
      "POST /load_balancers": () => {
        created = true
        return { status: 201, body: { load_balancer: lb, action: fixture.action({ id: 1 }) } }
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
      "GET /placement_groups": () => ({
        status: 200,
        body: { placement_groups: [fixture.placementGroup({ id: 3, name: "kumulo-prod-masters" })], meta: fixture.meta() }
      })
    })
    return Effect.gen(function*() {
      const id = yield* ensurePlacementGroup({ options, role: "master" })
      expect(id).toBe(3)
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("ensureServer creates, waits for the create Action, and re-ensures idempotently by name", () => {
    const fake = makeFakeHcloud({
      "GET /servers": () => ({ status: 200, body: { servers: [], meta: fixture.meta() } }),
      "GET /placement_groups": () => ({
        status: 200,
        body: { placement_groups: [fixture.placementGroup({ id: 3, name: "kumulo-prod-masters" })], meta: fixture.meta() }
      }),
      "POST /servers": () => ({
        status: 201,
        body: {
          server: fixture.server({ id: 10, name: "master-1", ip: "1.2.3.4" }),
          action: fixture.action({ id: 99, status: "running" }),
          next_actions: [],
          root_password: null
        }
      }),
      "GET /actions/99": () => ({ status: 200, body: { action: fixture.action({ id: 99 }) } })
    })
    return Effect.gen(function*() {
      const info = yield* ensureServer({ options, spec: { name: "master-1", role: "master", flavor: "cx22", image: "ubuntu-24.04", tag: "prod" } })
      expect(info).toEqual({ id: "10", name: "master-1", ip: "1.2.3.4" })
      expect(fake.calls().filter((call) => call.method === "POST" && call.url.includes("/v1/servers")).length).toBe(1)
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("ensureServer fails with ProvisioningTimeout when the create Action errors", () => {
    const fake = makeFakeHcloud({
      "GET /servers": () => ({ status: 200, body: { servers: [], meta: fixture.meta() } }),
      "GET /placement_groups": () => ({
        status: 200,
        body: { placement_groups: [fixture.placementGroup({ id: 3, name: "kumulo-prod-masters" })], meta: fixture.meta() }
      }),
      "POST /servers": () => ({
        status: 201,
        body: {
          server: fixture.server({ id: 10, name: "master-1", status: "initializing", ip: null }),
          action: fixture.action({ id: 99, status: "running" }),
          next_actions: [],
          root_password: null
        }
      }),
      "GET /actions/99": () => ({
        status: 200,
        body: { action: fixture.action({ id: 99, status: "error", error: { code: "boom", message: "quota" } }) }
      })
    })
    return Effect.gen(function*() {
      const exit = yield* Effect.flip(ensureServer({ options, spec: { name: "master-1", role: "master", flavor: "cx22", image: "ubuntu-24.04", tag: "prod" } }))
      expect(exit._tag).toBe("ProvisioningTimeout")
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("deleteServer waits for the delete Action to complete", () => {
    const fake = makeFakeHcloud({
      "DELETE /servers/10": () => ({ status: 200, body: { action: fixture.action({ id: 100, status: "running" }) } }),
      "GET /actions/100": () => ({ status: 200, body: { action: fixture.action({ id: 100 }) } })
    })
    return Effect.gen(function*() {
      yield* deleteServer({ id: "10", name: "master-1", ip: "" })
      expect(fake.calls().some((call) => call.url.includes("/v1/actions/100"))).toBe(true)
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
      "GET /load_balancers": () => ({
        status: 200,
        body: { load_balancers: [fixture.loadBalancer({ id: 1, name: "kumulo-prod" })], meta: fixture.meta() }
      }),
      "DELETE /load_balancers/1": () => {
        deleted.push("lb")
        return { status: 204 }
      },
      "GET /servers": () => ({ status: 200, body: { servers: [fixture.server({ id: 2, name: "kumulo-prod" })], meta: fixture.meta() } }),
      "DELETE /servers/2": () => {
        deleted.push("server")
        return { status: 200, body: {} }
      },
      "GET /placement_groups": () => ({
        status: 200,
        body: { placement_groups: [fixture.placementGroup({ id: 3, name: "kumulo-prod-masters" })], meta: fixture.meta() }
      }),
      "DELETE /placement_groups/3": () => {
        deleted.push("placement-group")
        return { status: 204 }
      },
      "GET /firewalls": () => ({ status: 200, body: { firewalls: [fixture.firewall({ id: 4, name: "kumulo-prod" })], meta: fixture.meta() } }),
      "DELETE /firewalls/4": () => {
        deleted.push("firewall")
        return { status: 204 }
      },
      "GET /networks": () => ({ status: 200, body: { networks: [fixture.network({ id: 5, name: "kumulo-prod" })], meta: fixture.meta() } }),
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
      "GET /servers": () => ({
        status: 200,
        body: { servers: [fixture.server({ id: 1, name: "master-1", ip: "1.2.3.4" })], meta: fixture.meta() }
      }),
      "GET /networks": () => ({ status: 200, body: { networks: [fixture.network({ id: 2, name: "kumulo-prod" })], meta: fixture.meta() } }),
      "GET /firewalls": () => ({ status: 200, body: { firewalls: [fixture.firewall({ id: 3, name: "kumulo-prod" })], meta: fixture.meta() } }),
      "GET /load_balancers": () => ({ status: 200, body: { load_balancers: [], meta: fixture.meta() } })
    })
    return Effect.gen(function*() {
      const inventory = yield* listClusterResources({ options })
      expect(inventory.servers).toEqual([{ id: "1", name: "master-1", ip: "1.2.3.4" }])
      expect(inventory.networks).toEqual([{ id: "2", cidr: "" }])
      expect(inventory.securityGroups).toEqual([{ id: "3" }])
      expect(inventory.loadBalancers).toEqual([])
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("listClusterResources follows pagination instead of stopping at page 1", () => {
    const fake = makeFakeHcloud({
      "GET /servers": (request) =>
        _page(request) === "1"
          ? { status: 200, body: { servers: [fixture.server({ id: 1, name: "master-1", ip: "1.2.3.4" })], meta: fixture.meta(2) } }
          : { status: 200, body: { servers: [fixture.server({ id: 2, name: "worker-1", ip: "5.6.7.8" })], meta: fixture.meta() } },
      "GET /networks": () => ({ status: 200, body: { networks: [], meta: fixture.meta() } }),
      "GET /firewalls": () => ({ status: 200, body: { firewalls: [], meta: fixture.meta() } }),
      "GET /load_balancers": () => ({ status: 200, body: { load_balancers: [], meta: fixture.meta() } })
    })
    return Effect.gen(function*() {
      const inventory = yield* listClusterResources({ options })
      expect(inventory.servers).toEqual([
        { id: "1", name: "master-1", ip: "1.2.3.4" },
        { id: "2", name: "worker-1", ip: "5.6.7.8" }
      ])
      expect(fake.calls().filter((call) => call.url.includes("/v1/servers")).every((call) => call.url.includes("per_page=50"))).toBe(true)
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("deleteByTag deletes servers found on later pages", () => {
    const deleted: Array<string> = []
    const _ok = (id: string) => {
      deleted.push(id)
      return { status: 200, body: {} } as const
    }
    const fake = makeFakeHcloud({
      "GET /load_balancers": () => ({ status: 200, body: { load_balancers: [], meta: fixture.meta() } }),
      "GET /servers": (request) =>
        _page(request) === "2"
          ? { status: 200, body: { servers: [fixture.server({ id: 2, name: "worker-1" })], meta: fixture.meta() } }
          : { status: 200, body: { servers: [fixture.server({ id: 1, name: "master-1" })], meta: fixture.meta(2) } },
      "DELETE /servers/1": () => _ok("1"),
      "DELETE /servers/2": () => _ok("2"),
      "GET /placement_groups": () => ({ status: 200, body: { placement_groups: [], meta: fixture.meta() } }),
      "GET /firewalls": () => ({ status: 200, body: { firewalls: [], meta: fixture.meta() } }),
      "GET /networks": () => ({ status: 200, body: { networks: [], meta: fixture.meta() } })
    })
    return Effect.gen(function*() {
      yield* deleteByTag({ options })
      expect(deleted).toEqual(["1", "2"])
    }).pipe(Effect.provide(fake.layer))
  })

  it.effect("resolveImage resolves via exact name, then fuzzy fallback restricted to system images", () => {
    const fake = makeFakeHcloud({
      "GET /images": (request) => {
        const name = new URL(request.url).searchParams.get("name")
        if (name === "ubuntu-24.04") {
          return { status: 200, body: { images: [fixture.image({ id: 1, name: "ubuntu-24.04" })], meta: fixture.meta() } }
        }
        if (name === "debian-12") return { status: 200, body: { images: [], meta: fixture.meta() } }
        return { status: 200, body: { images: [fixture.image({ id: 2, name: "debian-12-generic-cloud" })], meta: fixture.meta() } }
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
      "GET /server_types": () => ({ status: 200, body: { server_types: [], meta: fixture.meta() } })
    })
    return Effect.gen(function*() {
      const exit = yield* Effect.flip(resolveFlavor({ ref: "cx99" }))
      expect(exit).toBeInstanceOf(ResourceNotFound)
    }).pipe(Effect.provide(fake.layer))
  })
})
