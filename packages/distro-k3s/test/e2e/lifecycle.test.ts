import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Ref } from "effect"
import { applyServers, CloudProvider } from "@kumulo/core"
import type { K8sClient, K8sManifest, ResourceRef, ServerInfo, ServerSpec } from "@kumulo/core"
import { renderAgentInstallScript, renderServerInstallScript } from "../../src/bootstrap/install-script.ts"
import { installMasters, installWorkers } from "../../src/bootstrap/orchestrate.ts"
import type { NonEmptyMasters } from "../../src/bootstrap/token.ts"
import { resolveToken } from "../../src/bootstrap/token.ts"
import { makeSelfManagedDistro } from "../../src/distro/index.ts"
import { SshCommandError } from "../../src/ssh/errors.ts"
import type { SshHost } from "../../src/ssh/port.ts"
import { FakeSshLive } from "../ssh/fake-ssh.ts"

const TAG = "e2e-cluster"

// minimal local fake, cross-package test/ imports aren't a pattern used elsewhere in this repo.
const FakeCloudProviderLive: Layer.Layer<CloudProvider> = Layer.effect(
  CloudProvider,
  Effect.gen(function*() {
    const servers = yield* Ref.make<ReadonlyMap<string, ServerInfo>>(new Map())
    const lb = yield* Ref.make<{ readonly id: string; readonly vip: string } | undefined>(undefined)
    return {
      ensureNetwork: (spec) => Effect.succeed({ id: "net-1", cidr: spec.cidr }),
      findNetwork: (spec) => Effect.succeed({ id: "net-1", cidr: spec.cidr }),
      hasGateway: () => Effect.succeed(false),
      ensureSecurityGroups: (_spec) => Effect.succeed({ id: "sg-1" }),
      ensureLoadBalancer: (_spec) =>
        Ref.get(lb).pipe(
          Effect.flatMap((existing) => {
            if (existing !== undefined) return Effect.succeed(existing)
            const info = { id: "lb-1", vip: "10.0.0.100" }
            return Ref.set(lb, info).pipe(Effect.as(info))
          })
        ),
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
          Effect.asVoid
        ),
      deleteByTag: (_tag) => Ref.set(servers, new Map()),
      listClusterResources: (_tag) =>
        Ref.get(servers).pipe(
          Effect.map((map) => ({
            servers: [...map.values()],
            networks: [],
            securityGroups: [],
            loadBalancers: []
          }))
        ),
      resolveImage: (ref) => Effect.succeed(ref),
      resolveFlavor: (ref) => Effect.succeed(ref)
    }
  })
)

const _masterSpec = (n: number): ServerSpec => ({
  name: `master-${n}`,
  role: "master",
  flavor: "b2-7",
  image: "ubuntu-24.04",
  tag: TAG
})

const _workerSpec = (pool: string, n: number): ServerSpec => ({
  name: `${pool}-${n}`,
  role: "worker",
  flavor: "b2-7",
  image: "ubuntu-24.04",
  tag: TAG
})

const K3S_YAML = "server: https://127.0.0.1:6443\nname: default\n"

const _noopK8sClient: K8sClient["Service"] = {
  get: (ref: ResourceRef) => Effect.succeed({ apiVersion: "v1", kind: ref.kind }),
  list: (_ref: ResourceRef) => Effect.succeed([]),
  apply: (_ref: ResourceRef, manifest: K8sManifest) => Effect.succeed(manifest),
  delete: (_ref: ResourceRef) => Effect.void,
  evict: (_ns: string, _pod: string) => Effect.void
}

describe("k3s full lifecycle", () => {
  it.effect("provisions HA masters + 2 pools, bootstraps, and fetches a rewritten kubeconfig", () =>
    Effect.gen(function*() {
      const specs = [
        _masterSpec(1),
        _masterSpec(2),
        _masterSpec(3),
        _workerSpec("pool-a", 1),
        _workerSpec("pool-a", 2),
        _workerSpec("pool-b", 1)
      ]

      const runNodesPhase = applyServers({ specs, concurrency: 6 })
      yield* runNodesPhase
      yield* runNodesPhase

      const cloudProvider = yield* CloudProvider
      const inventory = yield* cloudProvider.listClusterResources(TAG)
      expect(inventory.servers).toHaveLength(6)
      expect(new Set(inventory.servers.map((s) => s.name))).toEqual(new Set(specs.map((s) => s.name)))

      const masterHosts: NonEmptyMasters = [
        { ip: "10.0.0.1", port: 22 },
        { ip: "10.0.0.2", port: 22 },
        { ip: "10.0.0.3", port: 22 }
      ]
      const workerHosts: ReadonlyArray<SshHost> = [
        { ip: "10.0.0.4", port: 22 },
        { ip: "10.0.0.5", port: 22 }
      ]
      const sshLayer = FakeSshLive({
        readFile: (host, path) => Effect.fail(new SshCommandError({ host: host.ip, command: `cat ${path}`, cause: "no token file yet" }))
      })

      const { firstMaster, token } = yield* resolveToken(masterHosts).pipe(Effect.provide(sshLayer))
      expect(token).toMatch(/^[0-9a-f]{64}$/)
      expect(firstMaster).toEqual(masterHosts[0])

      const renderedMasterScripts: Array<string> = []
      yield* installMasters({
        masters: masterHosts,
        installOne: (host, isFirst) =>
          Effect.sync(() => {
            renderedMasterScripts.push(
              renderServerInstallScript({
                k3sVersion: "v1.31.2+k3s1",
                token,
                isFirstMaster: isFirst,
                firstMasterIp: firstMaster.ip,
                privateIp: host.ip,
                publicIp: host.ip,
                tlsSans: [host.ip],
                addons: { cloudControllerManager: false, cni: "flannel" },
                extraServerArgs: []
              })
            )
          })
      })
      expect(renderedMasterScripts).toHaveLength(3)
      expect(renderedMasterScripts[0]).toContain("--cluster-init")
      expect(renderedMasterScripts.slice(1).every((script) => script.includes(`--server https://${firstMaster.ip}:6443`)))
        .toBe(true)

      const renderedWorkerScripts: Array<string> = []
      yield* installWorkers({
        workers: workerHosts,
        installOne: (host) =>
          Effect.sync(() => {
            renderedWorkerScripts.push(
              renderAgentInstallScript({
                k3sVersion: "v1.31.2+k3s1",
                token,
                firstMasterIp: firstMaster.ip,
                privateIp: host.ip,
                publicIp: host.ip,
                nodeLabels: {},
                nodeTaints: [],
                extraAgentArgs: []
              })
            )
          })
      })
      expect(renderedWorkerScripts).toHaveLength(2)
      for (const script of renderedWorkerScripts) expect(script).toContain(`K3S_TOKEN='${token}'`)

      const lb = yield* cloudProvider.ensureLoadBalancer({ members: [] })
      const distro = makeSelfManagedDistro({
        clusterName: "e2e-cluster",
        sshPublicKey: "ssh-ed25519 AAAA...",
        ssh: { exec: () => Effect.succeed("ok"), readFile: () => Effect.succeed(K3S_YAML), waitReady: () => Effect.void },
        k8s: _noopK8sClient,
        master1: { ip: firstMaster.ip, port: 22 },
        lbVip: lb.vip
      })

      const kubeconfig = yield* distro.fetchKubeconfig({ host: firstMaster.ip, user: "root" }, firstMaster.ip)
      expect(kubeconfig.content).toContain(`server: https://${lb.vip}:6443`)
      expect(kubeconfig.content).toContain("name: e2e-cluster")

      yield* distro.drainAndRemove({ name: "pool-b-1", role: "worker" })
    }).pipe(Effect.provide(FakeCloudProviderLive)))
})
