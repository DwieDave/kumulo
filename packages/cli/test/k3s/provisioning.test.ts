import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { layerNoop } from "effect/FileSystem"
import { CloudProvider, DnsProvider, K8sClient, VolumeProvider } from "@kumulo/core"
import type { Inventory, ServerInfo, ServerSpec } from "@kumulo/core"
import { Ssh } from "@kumulo/distro-k3s"
import { PlanAction } from "@kumulo/core"
import { applyK3sEffect, deleteK3sWithCdn, k3sStatusEffect, kubeconfigK3sEffect } from "../../src/k3s/reconcile.ts"
import { k3sDeletePlanActions, k3sPlanFor, nodeRoleOf } from "../../src/k3s/plan.ts"
import { baseEncodedConfig, decodeK3sTestConfig } from "../fixtures.ts"

const KUBECONFIG = [
  "apiVersion: v1",
  "clusters:",
  "- cluster: { server: https://127.0.0.1:6443 }",
  "  name: default",
  "users:",
  "- name: default",
  "  user: { token: t }",
  "contexts:",
  "- context: { cluster: default, user: default }",
  "  name: default",
  "current-context: default",
  ""
].join("\n")

interface Calls {
  readonly specs: Array<ServerSpec>
  lbEnsured: number
}

const _fakeCloud = (
  { calls, inventory }: { readonly calls: Calls; readonly inventory: Inventory }
): Layer.Layer<CloudProvider> =>
  Layer.succeed(CloudProvider, {
    ensureNetwork: (spec) => Effect.succeed({ id: "net-1", cidr: spec.cidr }),
    findNetwork: (spec) => Effect.succeed({ id: "net-1", cidr: spec.cidr }),
    hasGateway: () => Effect.succeed(false),
    ensureSecurityGroups: () => Effect.succeed({ id: "sg-1" }),
    ensureLoadBalancer: () =>
      Effect.sync(() => {
        calls.lbEnsured += 1

        return { id: "lb-1", vip: "10.0.0.100" }
      }),
    ensureServer: (spec) =>
      Effect.sync((): ServerInfo => {
        calls.specs.push(spec)

        return { id: spec.name, name: spec.name, ip: `10.0.1.${calls.specs.length}`, role: spec.role }
      }),
    deleteServer: () => Effect.void,
    deleteByTag: () => Effect.void,
    listClusterResources: () => Effect.succeed(inventory),
    resolveImage: (ref) => Effect.succeed(ref),
    resolveFlavor: (ref) => Effect.succeed(ref)
  })

const _ssh = Layer.succeed(Ssh, {
  exec: () => Effect.succeed("ok"),
  readFile: (_host, path) => Effect.succeed(path.endsWith("k3s.yaml") ? KUBECONFIG : "token"),
  waitReady: () => Effect.void
})

const _fs = layerNoop({
  readFileString: () => Effect.succeed("ssh-ed25519 AAAA test\n"),
  writeFileString: () => Effect.void,
  chmod: () => Effect.void,
  rename: () => Effect.void,
  remove: () => Effect.void
})

const _dns = Layer.succeed(DnsProvider, { ensureRecords: () => Effect.void, removeClusterRecords: () => Effect.void })

const _volumes = (deleted: Array<string>) =>
  Layer.succeed(VolumeProvider, {
    ensureVolume: (v: { readonly name: string }) => Effect.succeed({ id: `vol-${v.name}`, name: v.name }),
    listClusterVolumes: () =>
      Effect.succeed([{ id: "v-keep", name: "keep" }, { id: "v-del", name: "scratch" }, { id: "v-other", name: "stray" }]),
    deleteVolume: (v: { readonly id: string }) => Effect.sync(() => void deleted.push(v.id)),
    staticPvManifest: () => ({ apiVersion: "v1", kind: "PersistentVolume" })
  })

const _empty: Inventory = { servers: [], networks: [], securityGroups: [], loadBalancers: [] }

const _master: ServerInfo = { id: "m1", name: "kumulo-prod-eu-master-masters-1", ip: "10.0.1.1", role: "master" }

const _k8s = () =>
  Layer.succeed(K8sClient, {
    get: () => Effect.die("unused"),
    list: () => Effect.succeed([]),
    apply: () => Effect.die("unused"),
    delete: () => Effect.die("unused"),
    evict: () => Effect.die("unused")
  })

const _ha = decodeK3sTestConfig(baseEncodedConfig)

const _nonHa = decodeK3sTestConfig({ ...baseEncodedConfig, api_server: { high_availability: false, allowed_cidrs: [] }, masters: { ...baseEncodedConfig.masters, count: 1 } })

describe("k3s provisioning", () => {
  it.effect("sends ssh key user-data and the cluster network to every server", () =>
    Effect.gen(function*() {
      const calls: Calls = { specs: [], lbEnsured: 0 }

      yield* applyK3sEffect({ providerAddons: [], config: _ha, configDir: "/tmp" }).pipe(
        Effect.provide([_ssh, _fs, _dns, _volumes([]), _fakeCloud({ calls, inventory: _empty })])
      )

      expect(calls.specs).toHaveLength(5)

      for (const spec of calls.specs) {
        expect(spec.networkId).toBe("net-1")
        expect(spec.userData).toContain("ssh-ed25519 AAAA test")
        expect(spec.userData).toContain(`hostname: ${spec.name}`)
        expect(spec.userData).toContain("name: root")
      }
    }))

  it.effect("non-HA skips the load balancer and uses the master ip as the API endpoint", () =>
    Effect.gen(function*() {
      const calls: Calls = { specs: [], lbEnsured: 0 }

      const result = yield* applyK3sEffect({ providerAddons: [], config: _nonHa, configDir: "/tmp" }).pipe(
        Effect.provide([_ssh, _fs, _dns, _volumes([]), _fakeCloud({ calls, inventory: _empty })])
      )

      expect(calls.lbEnsured).toBe(0)
      expect(result.apiEndpoint).toBe("10.0.1.1")
    }))

  it("non-HA plans have no load-balancer row", () => {
    const names = k3sPlanFor({ config: _nonHa, observed: [] }).actions.map((a) => a.name)
    expect(names.some((n) => n.startsWith("load-balancer/"))).toBe(false)

    const haNames = k3sPlanFor({ config: _ha, observed: [] }).actions.map((a) => a.name)
    expect(haNames).toContain("load-balancer/prod-eu")
  })

  it.effect("status reads the VIP from inventory and never creates a load balancer", () =>
    Effect.gen(function*() {
      const calls: Calls = { specs: [], lbEnsured: 0 }
      const inventory: Inventory = { ..._empty, servers: [_master], loadBalancers: [{ id: "lb", vip: "10.9.9.9" }] }

      const status = yield* k3sStatusEffect({ config: _ha, k8sClientLayer: _k8s }).pipe(
        Effect.provide([_ssh, _fakeCloud({ calls, inventory })])
      )

      expect(calls.lbEnsured).toBe(0)
      expect(status.apiEndpoint).toBe("10.9.9.9")
    }))

  it.effect("kubeconfig without a load balancer targets the master and creates nothing", () =>
    Effect.gen(function*() {
      const calls: Calls = { specs: [], lbEnsured: 0 }

      const kubeconfig = yield* kubeconfigK3sEffect(_ha).pipe(
        Effect.provide([_ssh, _fakeCloud({ calls, inventory: { ..._empty, servers: [_master] } })])
      )

      expect(calls.lbEnsured).toBe(0)
      expect(kubeconfig.content).toContain("https://10.0.1.1:6443")
    }))

  it("classifies roles from ServerInfo.role, falling back to the naming prefix", () => {
    expect(nodeRoleOf({ config: _ha, server: { name: "anything", role: "worker" } })).toBe("worker")
    expect(nodeRoleOf({ config: _ha, server: { name: "kumulo-prod-eu-master-masters-1" } })).toBe("master")
    expect(nodeRoleOf({ config: _ha, server: { name: "kumulo-prod-eu-worker-general-2" } })).toBe("worker")
    expect(nodeRoleOf({ config: _ha, server: { name: "kumulo-other-worker-x-1" } })).toBeUndefined()
  })

  describe("delete", () => {
    const _withVolumes = decodeK3sTestConfig({
      ...baseEncodedConfig,
      volumes: {
        module: "cinder",
        managed: [
          { name: "keep", size_gb: 10, type: "high-speed", retain: true },
          { name: "scratch", size_gb: 10, type: "high-speed", retain: false }
        ]
      }
    })

    it.effect("deletes only configured, non-retained volumes", () =>
      Effect.gen(function*() {
        const deleted: Array<string> = []
        const calls: Calls = { specs: [], lbEnsured: 0 }

        yield* deleteK3sWithCdn({ config: _withVolumes, cdn: undefined }).pipe(
          Effect.provide([_dns, _volumes(deleted), _fakeCloud({ calls, inventory: _empty })])
        )

        expect(deleted).toEqual(["v-del"])
      }))

    it.effect("delete plan rows match: configured volumes only, retained as NoOp", () =>
      Effect.gen(function*() {
        const calls: Calls = { specs: [], lbEnsured: 0 }

        const actions = yield* k3sDeletePlanActions(_withVolumes).pipe(
          Effect.provide(_fakeCloud({ calls, inventory: _empty }))
        )

        const volumeRows = actions.filter((a) => a.name.startsWith("volume/"))

        expect(volumeRows.map((a) => [a._tag, a.name])).toEqual([
          ["NoOp", "volume/keep (retained)"],
          ["Delete", "volume/scratch"]
        ])
        expect(volumeRows.some((a) => PlanAction.$is("Delete")(a) && a.name.includes("stray"))).toBe(false)
      }))
  })
})
