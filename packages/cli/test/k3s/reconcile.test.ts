import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Ref } from "effect"
import {
  CloudProvider,
  DnsProvider,
  K8sClient,
  VolumeProvider
} from "@kumulo/core"
import type { K3sClusterConfigEncoded, DesiredRecord, K8sManifest, ServerInfo } from "@kumulo/core"
import { Ssh, SshCommandError } from "@kumulo/distro-k3s"
import { CloudCredentialEnv } from "../../src/k3s/env.ts"
import { applyK3sEffect, deleteK3sEffect, k3sStatusEffect, orphanedWorkers } from "../../src/k3s/reconcile.ts"
import { decodeK3sTestConfig } from "../fixtures.ts"

// Item 3 — the injectable K8sClient seam: a fake `K8sClient` Layer proves
// the drain phase takes its client from context instead of a real
// kubeconfig/HTTP round-trip. Just enough behavior for `drainAndRemove`
// (cordon=apply, drain=list+evict, delete=delete) to succeed.
const _isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null
const _emptyManifests: ReadonlyArray<K8sManifest> = []

const _fakeK8sClientLayer = (cordonedNodes: Array<string>): Layer.Layer<K8sClient> =>
  Layer.succeed(K8sClient, {
    get: () => Effect.die("not used by drain"),
    list: () => Effect.succeed(_emptyManifests),
    apply: (_ref, manifest) =>
      Effect.sync(() => {
        const metadata = manifest["metadata"]
        const name = _isRecord(metadata) ? metadata["name"] : undefined
        if (typeof name === "string") cordonedNodes.push(name)
        return manifest
      }),
    delete: () => Effect.void,
    evict: () => Effect.void
  })

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
  api_server: { high_availability: true, allowed_cidrs: ["203.0.113.0/24"] },
  ssh: { public_key_path: "~/.ssh/id_ed25519.pub", allowed_cidrs: ["203.0.113.0/24"] },
  masters: { flavor: "b3-8", count: 3, image: "ubuntu-24.04" },
  worker_pools: [{ name: "general", flavor: "b3-16", count: 2 }],
  dns: {
    module: "ovh",
    zone: "example.com",
    ttl: 300,
    records: [{ name: "api.test-k3s", target: "api_server" }]
  },
  volumes: {
    module: "cinder",
    managed: [{ name: "pg-data", size_gb: 10, type: "high-speed", retain: true }]
  },
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

const CloudCredentialEnvFake = Layer.succeed(CloudCredentialEnv, {
  provider: "openstack",
  authUrl: "",
  region: "GRA11",
  applicationCredentialId: "",
  applicationCredentialSecret: ""
})

// Tracking fakes (not no-ops) so create/delete can assert DNS + retained
// volume + reverse-teardown-order behavior, not just that the calls compile.
interface VolumeCalls {
  readonly ensured: Array<string>
  readonly deleted: Array<string>
}
const _trackingVolumeProvider = (calls: VolumeCalls) =>
  Layer.succeed(VolumeProvider, {
    ensureVolume: (v: { readonly name: string }) =>
      Effect.sync(() => {
        calls.ensured.push(v.name)
        return { id: `vol-${v.name}`, name: v.name }
      }),
    listClusterVolumes: () => Effect.succeed([{ id: "vol-1", name: "pg-data" }]),
    deleteVolume: (v: { readonly id: string }) => Effect.sync(() => calls.deleted.push(v.id)),
    staticPvManifest: () => ({ apiVersion: "v1", kind: "PersistentVolume" })
  })
interface DnsCalls {
  readonly ensured: Array<ReadonlyArray<DesiredRecord>>
  readonly removed: Array<string>
}
const _trackingDnsProvider = (calls: DnsCalls) =>
  Layer.succeed(DnsProvider, {
    ensureRecords: (_zone: string, records: ReadonlyArray<DesiredRecord>) => Effect.sync(() => calls.ensured.push(records)),
    removeClusterRecords: (_zone: string, cluster: string) => Effect.sync(() => calls.removed.push(cluster))
  })

// ponytail: local, minimal fakes (not reused across packages) — a
// package doesn't import a sibling's test/ fixtures.
const _fakeCloudProviderLive = (deletedServers: Array<string> = []): Layer.Layer<CloudProvider> => Layer.effect(
  CloudProvider,
  Effect.gen(function*() {
    const servers = yield* Ref.make<ReadonlyMap<string, ServerInfo>>(new Map())
    return {
      ensureNetwork: (spec) => Effect.succeed({ id: "net-1", cidr: spec.cidr }),
      findNetwork: (spec) => Effect.succeed({ id: "net-1", cidr: spec.cidr }),
      hasGateway: () => Effect.succeed(false),
      ensureSecurityGroups: () => Effect.succeed({ id: "sg-1" }),
      ensureLoadBalancer: () => Effect.succeed({ id: "lb-1", vip: "10.0.0.100" }),
      ensureServer: (spec) =>
        Ref.get(servers).pipe(
          Effect.flatMap((map) => {
            const existing = map.get(spec.name)
            if (existing !== undefined) return Effect.succeed(existing)
            const info: ServerInfo = { id: `srv-${map.size + 1}`, name: spec.name, ip: `10.0.0.${map.size + 1}` }
            return Ref.update(servers, (current) => new Map(current).set(spec.name, info)).pipe(Effect.as(info))
          })
        ),
      deleteServer: (ref) =>
        Ref.update(servers, (current) => new Map([...current].filter(([name]) => name !== ref.name))).pipe(
          Effect.tap(() => Effect.sync(() => deletedServers.push(ref.name))),
          Effect.asVoid
        ),
      deleteByTag: () => Ref.set(servers, new Map()),
      listClusterResources: () =>
        Ref.get(servers).pipe(
          Effect.map((map) => ({ servers: [...map.values()], networks: [], securityGroups: [], loadBalancers: [] }))
        ),
      resolveImage: (ref) => Effect.succeed(ref),
      resolveFlavor: (ref) => Effect.succeed(ref)
    }
  })
)

// Records every command actually executed via `Ssh.exec` (not merely
// rendered), plus how many times each readiness gate fires.
interface SshLog {
  readonly executed: Array<{ readonly host: string; readonly command: string }>
  readonly cloudInitGates: Array<string>
  readonly clusterInfoGates: Array<string>
}
const _FakeSshLive = (log: SshLog): Layer.Layer<Ssh> =>
  Layer.succeed(Ssh, {
    exec: (host, command) => {
      if (command.startsWith("test -f")) {
        log.cloudInitGates.push(host.ip)
        return Effect.succeed("")
      }
      if (command === "kubectl cluster-info") {
        log.clusterInfoGates.push(host.ip)
        return Effect.succeed("")
      }
      log.executed.push({ host: host.ip, command })
      return Effect.succeed("ok")
    },
    readFile: (host, path) =>
      path.endsWith("k3s.yaml")
        ? Effect.succeed(K3S_KUBECONFIG)
        : Effect.fail(new SshCommandError({ host: host.ip, command: `cat ${path}`, cause: "no token yet" })),
    waitReady: () => Effect.void
  })

const _configWithWorkerCount = (count: number) => decodeK3sTestConfig({ ..._encoded, worker_pools: [{ name: "general", flavor: "b3-16", count }] })

describe("k3s CLI composition root", () => {
  it.effect("create: provisions HA masters + a worker pool, DNS, retained volume, TLS SANs, readiness gates, kubeconfig", () =>
    Effect.gen(function*() {
      const log: SshLog = { executed: [], cloudInitGates: [], clusterInfoGates: [] }
      const dnsCalls: DnsCalls = { ensured: [], removed: [] }
      const volumeCalls: VolumeCalls = { ensured: [], deleted: [] }

      const result = yield* applyK3sEffect({ config: _config, configDir: "/tmp" }).pipe(
        Effect.provide(_FakeSshLive(log)),
        Effect.provide(_trackingVolumeProvider(volumeCalls)),
        Effect.provide(_trackingDnsProvider(dnsCalls)),
        Effect.provide(CloudCredentialEnvFake),
        Effect.provide(_fakeCloudProviderLive())
      )

      expect(result.apiEndpoint).toBe("10.0.0.100")
      expect(result.kubeconfigPath).toBe("/tmp/test-k3s.kubeconfig")

      // 3 masters + 2 workers, every one's install script actually executed
      // (not merely rendered) over the fake `Ssh`.
      expect(log.executed).toHaveLength(5)
      expect(log.executed.filter((e) => e.command.includes("--cluster-init"))).toHaveLength(1)
      expect(log.executed.filter((e) => e.command.includes("agent"))).toHaveLength(2)

      // Readiness gates: cloud-init+ssh before every node, cluster-info once for master 1.
      expect(log.cloudInitGates).toHaveLength(5)
      expect(log.clusterInfoGates).toHaveLength(1)

      // TLS SANs: every master IP + the LB VIP + the DNS api record FQDN.
      const masterScripts = log.executed.filter((e) => e.command.includes("--cluster-init") || e.command.includes("--server https://10.0.0."))
      for (const { command } of masterScripts) {
        expect(command).toContain("--tls-san='10.0.0.100'") // LB VIP (shell-quoted)
        expect(command).toContain("--tls-san='api.test-k3s.example.com'") // DNS api record (shell-quoted)
      }

      // DNS: the api_server target record was ensured against the LB VIP, with
      // the TXT ownership record that lets the next apply recognise it as ours.
      expect(dnsCalls.ensured).toHaveLength(1)
      expect(dnsCalls.ensured[0]).toEqual([
        { name: "api.test-k3s", target: "10.0.0.100" },
        { name: "api.test-k3s", target: "kumulo.cluster=test-k3s" }
      ])

      // Volumes: the retained volume was ensured (created).
      expect(volumeCalls.ensured).toEqual(["pg-data"])
    }))

  it.effect("scale up: re-applying with an added worker only bootstraps the new node's join, existing nodes stay idempotent", () =>
    Effect.gen(function*() {
      const log: SshLog = { executed: [], cloudInitGates: [], clusterInfoGates: [] }
      const deletedServers: Array<string> = []
      const cloudLayer = _fakeCloudProviderLive(deletedServers)
      const sshLayer = _FakeSshLive(log)
      const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(
          Effect.provide(sshLayer),
          Effect.provide(_trackingVolumeProvider({ ensured: [], deleted: [] })),
          Effect.provide(_trackingDnsProvider({ ensured: [], removed: [] })),
          Effect.provide(CloudCredentialEnvFake),
          Effect.provide(cloudLayer)
        )

      yield* provide(applyK3sEffect({ config: _configWithWorkerCount(2), configDir: "/tmp" }))
      expect(log.executed).toHaveLength(5) // 3 masters + 2 workers

      yield* provide(applyK3sEffect({ config: _configWithWorkerCount(3), configDir: "/tmp" }))
      // Every apply re-runs bootstrap against the full current inventory (the
      // install script itself is idempotent shell) — 3 masters + 3 workers this time.
      expect(log.executed).toHaveLength(5 + 6)
      expect(deletedServers).toEqual([])
    }))

  it.effect("scale down: drains (through the fake K8sClient seam) AND deletes the orphaned worker's VM", () => {
    const log: SshLog = { executed: [], cloudInitGates: [], clusterInfoGates: [] }
    const deletedServers: Array<string> = []
    const cordonedNodes: Array<string> = []
    const k8sClientLayer = () => _fakeK8sClientLayer(cordonedNodes)
    return Effect.gen(function*() {
      yield* applyK3sEffect({ config: _configWithWorkerCount(2), configDir: "/tmp", k8sClientLayer })
      yield* applyK3sEffect({ config: _configWithWorkerCount(1), configDir: "/tmp", k8sClientLayer })
      expect(deletedServers).toEqual(["kumulo-test-k3s-worker-general-2"])
      expect(cordonedNodes).toEqual(["kumulo-test-k3s-worker-general-2"])
    }).pipe(
      // `CloudProvider` state (which servers exist) must persist across both
      // applies to prove the second one detects worker-2 as orphaned — one
      // `Effect.provide` for the whole sequence, not per-apply (a fresh
      // `Effect.provide` per call rebuilds the fake Layer, i.e. a fresh
      // in-memory store, each time).
      Effect.provide(_FakeSshLive(log)),
      Effect.provide(_trackingVolumeProvider({ ensured: [], deleted: [] })),
      Effect.provide(_trackingDnsProvider({ ensured: [], removed: [] })),
      Effect.provide(CloudCredentialEnvFake),
      Effect.provide(_fakeCloudProviderLive(deletedServers))
    )
  })

  it("scale down: a worker no longer in the desired spec set is the one that drains", () => {
    const workerInfos: ReadonlyArray<ServerInfo> = [
      { id: "1", name: "kumulo-test-k3s-worker-general-1", ip: "10.0.0.4" },
      { id: "2", name: "kumulo-test-k3s-worker-general-2", ip: "10.0.0.5" }
    ]
    // scaled down to count: 1 -> only "-general-1" remains desired.
    expect(orphanedWorkers({ config: _configWithWorkerCount(1), workerInfos }).map((w) => w.name))
      .toEqual(["kumulo-test-k3s-worker-general-2"])
    expect(orphanedWorkers({ config: _configWithWorkerCount(2), workerInfos })).toEqual([])
  })

  it.effect("delete: reverse teardown — retained volume kept, owned DNS records removed, servers deleted by tag", () =>
    Effect.gen(function*() {
      const dnsCalls: DnsCalls = { ensured: [], removed: [] }
      const volumeCalls: VolumeCalls = { ensured: [], deleted: [] }

      yield* deleteK3sEffect(_config).pipe(
        Effect.provide(_trackingVolumeProvider(volumeCalls)),
        Effect.provide(_trackingDnsProvider(dnsCalls)),
        Effect.provide(_fakeCloudProviderLive())
      )

      // `retain: true` -> never deleted.
      expect(volumeCalls.deleted).toEqual([])
      // Owned DNS records for this cluster's zone are removed.
      expect(dnsCalls.removed).toEqual(["test-k3s"])
    }))
})

const _nodeManifest = (name: string, ready: boolean): K8sManifest => ({
  apiVersion: "v1",
  kind: "Node",
  metadata: { name },
  status: { conditions: [{ type: "Ready", status: ready ? "True" : "False" }] }
})

const _statusK8sClientLayer = (nodes: ReadonlyArray<K8sManifest>) => () => Layer.succeed(K8sClient, {
  get: () => Effect.die("not used by status"),
  list: () => Effect.succeed(nodes),
  apply: () => Effect.die("not used by status"),
  delete: () => Effect.die("not used by status"),
  evict: () => Effect.die("not used by status")
})

describe("k3s status", () => {
  it.effect("reports \"does not exist\" when the tagged inventory has no master", () =>
    Effect.gen(function*() {
      const log: SshLog = { executed: [], cloudInitGates: [], clusterInfoGates: [] }
      const status = yield* k3sStatusEffect({ config: _config }).pipe(
        Effect.provide(_FakeSshLive(log)),
        Effect.provide(_fakeCloudProviderLive())
      )
      expect(status).toEqual({ exists: false, nodes: [] })
    }))

  it.effect("treats a node with malformed metadata/status as not-ready/unnamed instead of failing (lenient decode)", () =>
    Effect.gen(function*() {
      const log: SshLog = { executed: [], cloudInitGates: [], clusterInfoGates: [] }
      const malformed: K8sManifest = { apiVersion: "v1", kind: "Node", metadata: "not-an-object", status: "not-an-object" }

      const status = yield* applyK3sEffect({ config: _config, configDir: "/tmp" }).pipe(
        Effect.andThen(() => k3sStatusEffect({ config: _config, k8sClientLayer: _statusK8sClientLayer([malformed]) })),
        Effect.provide(_FakeSshLive(log)),
        Effect.provide(_trackingVolumeProvider({ ensured: [], deleted: [] })),
        Effect.provide(_trackingDnsProvider({ ensured: [], removed: [] })),
        Effect.provide(CloudCredentialEnvFake),
        Effect.provide(_fakeCloudProviderLive())
      )

      expect(status.nodes).toEqual([{ name: "", ready: false }])
    }))

  it.effect("reports the LB endpoint + per-node Ready condition once the cluster exists", () =>
    Effect.gen(function*() {
      const log: SshLog = { executed: [], cloudInitGates: [], clusterInfoGates: [] }
      const nodes = [_nodeManifest("kumulo-test-k3s-master-masters-1", true), _nodeManifest("kumulo-test-k3s-worker-general-1", false)]

      const status: { exists: boolean; apiEndpoint?: string; nodes: ReadonlyArray<{ name: string; ready: boolean }> } =
        yield* applyK3sEffect({ config: _config, configDir: "/tmp" }).pipe(
          Effect.andThen(() => k3sStatusEffect({ config: _config, k8sClientLayer: _statusK8sClientLayer(nodes) })),
          Effect.provide(_FakeSshLive(log)),
          Effect.provide(_trackingVolumeProvider({ ensured: [], deleted: [] })),
          Effect.provide(_trackingDnsProvider({ ensured: [], removed: [] })),
          Effect.provide(CloudCredentialEnvFake),
          Effect.provide(_fakeCloudProviderLive())
        )

      expect(status.exists).toBe(true)
      expect(status.apiEndpoint).toBe("10.0.0.100")
      expect(status.nodes).toEqual([
        { name: "kumulo-test-k3s-master-masters-1", ready: true },
        { name: "kumulo-test-k3s-worker-general-1", ready: false }
      ])
    }))
})
