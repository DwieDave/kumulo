import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Ref } from "effect"
import {
  CloudProvider,
  decodeConfig,
  DnsProvider,
  VolumeProvider
} from "@kumulo/core"
import type { ClusterConfigEncoded, ServerInfo } from "@kumulo/core"
import { Ssh, SshCommandError } from "@kumulo/distro-k3s"
import { OpenStackEnv } from "../../src/doctor-openstack/env.ts"
import { applyK3sEffect, deleteK3sEffect } from "../../src/k3s/reconcile.ts"

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

const _encoded: ClusterConfigEncoded = {
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
  dns: { module: "none", zone: "example.com", ttl: 300, records: [] },
  volumes: { module: "none", retained: [] },
  addons: {
    cloud_controller_manager: false,
    cinder_csi: { enabled: false, default_volume_type: "high-speed" },
    system_upgrade_controller: false,
    cni: "flannel"
  },
  k3s: { extra_server_args: [], extra_agent_args: [] }
}
const _config = Effect.runSync(decodeConfig(_encoded))

const OpenStackEnvFake = Layer.succeed(OpenStackEnv, {
  keystone: undefined,
  region: "GRA11",
  unavailableReason: undefined
})
const NoopVolumeProvider = Layer.succeed(VolumeProvider, {
  ensureVolume: () => Effect.die("not used in this test"),
  listClusterVolumes: () => Effect.succeed([]),
  deleteVolume: () => Effect.void,
  staticPvManifest: () => ({ apiVersion: "v1", kind: "PersistentVolume" })
})
const NoopDnsProvider = Layer.succeed(DnsProvider, {
  ensureRecords: () => Effect.void,
  removeClusterRecords: () => Effect.void
})

// ponytail: local, minimal fakes (not reused across packages) — same
// precedent as `distro-k3s/test/e2e/lifecycle.test.ts`'s own note on why a
// package doesn't import a sibling's test/ fixtures.
const FakeCloudProviderLive: Layer.Layer<CloudProvider> = Layer.effect(
  CloudProvider,
  Effect.gen(function*() {
    const servers = yield* Ref.make<ReadonlyMap<string, ServerInfo>>(new Map())
    return {
      ensureNetwork: (spec) => Effect.succeed({ id: "net-1", cidr: spec.cidr }),
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

// Records every command actually executed via `Ssh.exec` (not merely rendered).
const _FakeSshLive = (executed: Array<{ readonly host: string; readonly command: string }>): Layer.Layer<Ssh> =>
  Layer.succeed(Ssh, {
    exec: (host, command) => {
      if (command.startsWith("test -f") || command === "kubectl cluster-info") return Effect.succeed("")
      executed.push({ host: host.ip, command })
      return Effect.succeed("ok")
    },
    readFile: (host, path) =>
      path.endsWith("k3s.yaml")
        ? Effect.succeed(K3S_KUBECONFIG)
        : Effect.fail(new SshCommandError({ host: host.ip, command: `cat ${path}`, cause: "no token yet" })),
    waitReady: () => Effect.void
  })

describe("k3s CLI composition root (FR-2.3/FR-5)", () => {
  it.effect("provisions HA masters + a worker pool and actually executes the install scripts over Ssh", () =>
    Effect.gen(function*() {
      const executed: Array<{ readonly host: string; readonly command: string }> = []

      const result = yield* applyK3sEffect({ config: _config, configDir: "/tmp" }).pipe(
        Effect.provide(_FakeSshLive(executed)),
        Effect.provide(NoopVolumeProvider),
        Effect.provide(NoopDnsProvider),
        Effect.provide(OpenStackEnvFake),
        Effect.provide(FakeCloudProviderLive)
      )

      expect(result.apiEndpoint).toBe("10.0.0.100")
      expect(result.kubeconfigPath).toBe("/tmp/test-k3s.kubeconfig")

      // 3 masters + 2 workers, every one's install script actually executed
      // (not merely rendered) over the fake `Ssh` — the gap this task closes.
      expect(executed).toHaveLength(5)
      expect(executed.filter((e) => e.command.includes("--cluster-init"))).toHaveLength(1)
      expect(executed.filter((e) => e.command.includes("agent"))).toHaveLength(2)
    }))

  it.effect("delete tears down by tag (FR-2.6)", () =>
    Effect.gen(function*() {
      yield* deleteK3sEffect(_config).pipe(
        Effect.provide(NoopVolumeProvider),
        Effect.provide(NoopDnsProvider),
        Effect.provide(FakeCloudProviderLive)
      )
    }))
})
