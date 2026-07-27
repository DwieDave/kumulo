import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { CapabilityMissing, ProvisioningTimeout, ResourceNotFound, ResponseDecodeError, type SecGroupSpec } from "@kumulo/core"
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

// Glance validates its image ids against the UUID pattern.
const IMG_1 = "11111111-1111-4111-8111-111111111111"
const IMG_2 = "22222222-2222-4222-8222-222222222222"

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
    // The rules reach the port from untyped config, so the runtime decode still
    // guards even though `SecGroupRule` rejects this shape at compile time.
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
    const fake = makeFakeOpenStack({
      "GET /v2/lbaas/loadbalancers": () => ({ status: 200, body: { loadbalancers: [{ id: "lb-1", name: "kumulo-prod" }] } }),
      "DELETE /v2/lbaas/loadbalancers/lb-1": () => {
        deleted.push("lb")
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
      "GET /v2.1/servers/detail": () => ({
        status: 200,
        body: { servers: [{ id: "srv-1", name: "master-1", addresses: {}, metadata: { "kumulo-config-hash": "abc" } }] }
      }),
      "GET /v2.0/networks": () => ({ status: 200, body: { networks: [{ id: "net-1" }] } }),
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

  // Regression: a server that boots to ERROR used to be re-adopted by name on
  // every later apply, so the cluster could never be repaired.
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
