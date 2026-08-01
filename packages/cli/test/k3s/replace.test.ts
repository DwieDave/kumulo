import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Ref } from "effect"
import { FastCheck as fc } from "effect/testing"
import { CloudProvider, configHash, DnsProvider, VolumeProvider } from "@kumulo/core"
import { namesToReplace } from "@kumulo/core"
import type { ServerInfo, ServerSpec, TaggedResource } from "@kumulo/core"
import type { K3sClusterConfig, K3sClusterConfigEncoded } from "../../src/cluster-config.ts"
import { Ssh, SshCommandError } from "@kumulo/distro-k3s"
import { CloudCredentialEnv } from "../../src/k3s/env.ts"
import { applyK3sEffect } from "../../src/k3s/reconcile.ts"
import { buildK3sNodes, k3sPlanFor } from "../../src/k3s/plan.ts"
import { rejectUnconfirmedReplace } from "../../src/commands.ts"
import { decodeK3sTestConfig } from "../fixtures.ts"

const K3S_KUBECONFIG = [
  "apiVersion: v1",
  "clusters:",
  "- cluster: { server: https://127.0.0.1:6443 }",
  "  name: default",
  "users:",
  "- name: default",
  "  user: { token: faketoken }",
  "contexts:",
  "- context: { cluster: default, user: default }",
  "  name: default",
  "current-context: default",
  ""
].join("\n")

const _encoded: K3sClusterConfigEncoded = {
  name: "test-k3s",
  provider: "generic",
  distro: "k3s",
  version: "v1.31.4+k3s1",
  auth: { method: "application_credential", region: "GRA11" },
  network: { cidr: "10.0.0.0/16", public_access: "bastionless" },
  api_server: { high_availability: false, allowed_cidrs: ["203.0.113.0/24"] },
  ssh: { public_key_path: "~/.ssh/id_ed25519.pub", allowed_cidrs: ["203.0.113.0/24"] },
  masters: { flavor: "b3-8", count: 1, image: "ubuntu-24.04" },
  worker_pools: [{ name: "general", flavor: "b3-16", count: 2 }],
  dns: { module: "none" },
  volumes: { module: "none" },
  object_storage: { module: "none" },
  secrets: { sink: "none" },
  addons: {
    cloud_controller_manager: false,
    cinder_csi: { enabled: false, default_volume_type: "high-speed" },
    hcloud_csi: { enabled: false },
    system_upgrade_controller: false,
    cni: "flannel"
  },
  k3s: { extra_server_args: [], extra_agent_args: [] }
}

const _config = decodeK3sTestConfig(_encoded)
const _withWorkerFlavor = (flavor: string) => decodeK3sTestConfig({ ..._encoded, worker_pools: [{ name: "general", flavor, count: 2 }] })
const _withMasterFlavor = (flavor: string) => decodeK3sTestConfig({ ..._encoded, masters: { ..._encoded.masters, flavor } })

type Event = { readonly kind: "create" | "delete"; readonly name: string }
interface Store {
  readonly events: Array<Event>
  readonly servers: Ref.Ref<ReadonlyMap<string, ServerInfo>>
}

const _recordingCloudProvider = (store: Store): Layer.Layer<CloudProvider> =>
  Layer.succeed(CloudProvider, {
    ensureNetwork: (spec) => Effect.succeed({ id: "net-1", cidr: spec.cidr }),
    findNetwork: (spec) => Effect.succeed({ id: "net-1", cidr: spec.cidr }),
    hasGateway: () => Effect.succeed(false),
    ensureSecurityGroups: () => Effect.succeed({ id: "sg-1" }),
    ensureLoadBalancer: () => Effect.succeed({ id: "lb-1", vip: "10.0.0.100" }),
    ensureServer: (spec: ServerSpec) =>
      Ref.get(store.servers).pipe(
        Effect.flatMap((map) => {
          const existing = map.get(spec.name)
          if (existing !== undefined) return Effect.succeed(existing)
          const info: ServerInfo = {
            id: `srv-${store.events.length + 1}`,
            name: spec.name,
            ip: `10.0.0.${map.size + 1}`,
            configHash: configHash(spec)
          }
          store.events.push({ kind: "create", name: spec.name })
          return Ref.update(store.servers, (current) => new Map(current).set(spec.name, info)).pipe(Effect.as(info))
        })
      ),
    deleteServer: (ref) =>
      Ref.update(store.servers, (current) => new Map([...current].filter(([name]) => name !== ref.name))).pipe(
        Effect.tap(() => Effect.sync(() => store.events.push({ kind: "delete", name: ref.name }))),
        Effect.asVoid
      ),
    deleteByTag: () => Ref.set(store.servers, new Map()),
    listClusterResources: () =>
      Ref.get(store.servers).pipe(
        Effect.map((map) => ({ servers: [...map.values()], networks: [], securityGroups: [], loadBalancers: [] }))
      ),
    resolveImage: (ref) => Effect.succeed(ref),
    resolveFlavor: (ref) => Effect.succeed(ref)
  })

const _FakeSshLive = Layer.succeed(Ssh, {
  exec: () => Effect.succeed("ok"),
  readFile: (host, path) =>
    path.endsWith("k3s.yaml")
      ? Effect.succeed(K3S_KUBECONFIG)
      : Effect.fail(new SshCommandError({ host: host.ip, command: `cat ${path}`, cause: "no token" })),
  waitReady: () => Effect.void
})

const _FakeDns = Layer.succeed(DnsProvider, { ensureRecords: () => Effect.void, removeClusterRecords: () => Effect.void })
const _FakeVolumes = Layer.succeed(VolumeProvider, {
  ensureVolume: (v: { readonly name: string }) => Effect.succeed({ id: `vol-${v.name}`, name: v.name }),
  listClusterVolumes: () => Effect.succeed([]),
  deleteVolume: () => Effect.void,
  staticPvManifest: () => ({ apiVersion: "v1", kind: "PersistentVolume" })
})
const _FakeCred = Layer.succeed(CloudCredentialEnv, {
  provider: "openstack",
  authUrl: "",
  region: "GRA11",
  applicationCredentialId: "",
  applicationCredentialSecret: ""
})

const _makeStore = Effect.map(Ref.make<ReadonlyMap<string, ServerInfo>>(new Map()), (servers): Store => ({ events: [], servers }))

const _run = <A, E>(store: Store, effect: Effect.Effect<A, E, CloudProvider | Ssh | DnsProvider | VolumeProvider | CloudCredentialEnv>) =>
  effect.pipe(
    Effect.provide(_FakeSshLive),
    Effect.provide(_FakeVolumes),
    Effect.provide(_FakeDns),
    Effect.provide(_FakeCred),
    Effect.provide(_recordingCloudProvider(store))
  )

const _observed = (store: Store): Effect.Effect<ReadonlyArray<TaggedResource>> =>
  Ref.get(store.servers).pipe(Effect.map((map) => [...map.values()].map((s) => ({ name: s.name, configHash: s.configHash }))))

const _planFor = (config: K3sClusterConfig, store: Store) =>
  _observed(store).pipe(Effect.map((observed) => k3sPlanFor({ config, observed, infra: { network: true, securityGroups: true, loadBalancer: true } })))

const WORKER_1 = "kumulo-test-k3s-worker-general-1"

describe("confirmed replace actually executes", () => {
  it.effect("a drifted worker is deleted and recreated with the new hash", () =>
    Effect.gen(function*() {
      const store = yield* _makeStore
      yield* _run(store, applyK3sEffect({ config: _config, configDir: "/tmp" }))
      store.events.length = 0

      const drifted = _withWorkerFlavor("b3-32")
      const plan = yield* _run(store, _planFor(drifted, store))
      const replace = namesToReplace(plan)
      expect([...replace]).toEqual([WORKER_1, "kumulo-test-k3s-worker-general-2"])

      yield* _run(store, applyK3sEffect({ config: drifted, configDir: "/tmp", replace }))

      expect(store.events.filter((e) => e.name === WORKER_1).map((e) => e.kind)).toEqual(["delete", "create"])
      const after = yield* Ref.get(store.servers)
      const expected = configHash(buildK3sNodes(drifted).find((n) => n.spec.name === WORKER_1)?.spec)
      expect(after.get(WORKER_1)?.configHash).toBe(expected)
    }))

  it.effect("re-planning after the replace reaches convergence (all NoOp)", () =>
    Effect.gen(function*() {
      const store = yield* _makeStore
      yield* _run(store, applyK3sEffect({ config: _config, configDir: "/tmp" }))
      const drifted = _withWorkerFlavor("b3-32")
      const plan = yield* _run(store, _planFor(drifted, store))
      yield* _run(store, applyK3sEffect({ config: drifted, configDir: "/tmp", replace: namesToReplace(plan) }))

      const replanned = yield* _run(store, _planFor(drifted, store))
      expect(replanned.actions.every((a) => a._tag === "NoOp")).toBe(true)
    }))

  it.effect("without confirmation nothing is deleted or created", () =>
    Effect.gen(function*() {
      const store = yield* _makeStore
      yield* _run(store, applyK3sEffect({ config: _config, configDir: "/tmp" }))
      store.events.length = 0

      const drifted = _withWorkerFlavor("b3-32")
      yield* _run(store, applyK3sEffect({ config: drifted, configDir: "/tmp" }))
      expect(store.events).toEqual([])
    }))

  it.effect("an unconfirmed replace plan fails closed (non-zero exit)", () =>
    Effect.gen(function*() {
      const store = yield* _makeStore
      yield* _run(store, applyK3sEffect({ config: _config, configDir: "/tmp" }))
      const plan = yield* _run(store, _planFor(_withWorkerFlavor("b3-32"), store))

      const error = yield* Effect.flip(rejectUnconfirmedReplace(plan))
      expect(error._tag).toBe("PlanRejected")
      const noReplace = yield* _run(store, _planFor(_config, store))
      expect(yield* rejectUnconfirmedReplace(noReplace).pipe(Effect.as("ok"))).toBe("ok")
    }))

  it.effect("a node whose hash is absent is never replaced", () =>
    Effect.gen(function*() {
      const store = yield* _makeStore
      yield* _run(store, applyK3sEffect({ config: _config, configDir: "/tmp" }))
      yield* Ref.update(store.servers, (map) =>
        new Map([...map].map(([name, info]) => [name, { id: info.id, name: info.name, ip: info.ip }])))
      store.events.length = 0

      const drifted = _withWorkerFlavor("b3-32")
      const plan = yield* _run(store, _planFor(drifted, store))
      expect(plan.actions.every((a) => a._tag === "NoOp")).toBe(true)
      yield* _run(store, applyK3sEffect({ config: drifted, configDir: "/tmp", replace: namesToReplace(plan) }))
      expect(store.events).toEqual([])
    }))

  it.effect("replacing control-plane nodes is refused, and refused before anything is deleted", () =>
    Effect.gen(function*() {
      const store = yield* _makeStore
      yield* _run(store, applyK3sEffect({ config: _config, configDir: "/tmp" }))
      store.events.length = 0

      const drifted = _withMasterFlavor("b3-16")
      const plan = yield* _run(store, _planFor(drifted, store))
      const error = yield* _run(
        store,
        Effect.flip(applyK3sEffect({ config: drifted, configDir: "/tmp", replace: namesToReplace(plan) }))
      )
      expect(error._tag).toBe("PlanRejected")
      expect(store.events).toEqual([])
    }))

  it.effect.prop(
    "apply against an inventory stamped from the same config mutates nothing",
    [fc.integer({ min: 0, max: 3 }), fc.constantFrom("b3-8", "b3-16", "b3-32")],
    ([workers, flavor]) =>
      Effect.gen(function*() {
        const config = decodeK3sTestConfig({ ..._encoded, worker_pools: [{ name: "general", flavor, count: workers }] })
        const store = yield* _makeStore
        yield* _run(store, applyK3sEffect({ config, configDir: "/tmp" }))
        store.events.length = 0

        const plan = yield* _run(store, _planFor(config, store))
        yield* _run(store, applyK3sEffect({ config, configDir: "/tmp", replace: namesToReplace(plan) }))
        return store.events.length === 0 && plan.actions.every((a) => a._tag === "NoOp")
      })
  )
})
