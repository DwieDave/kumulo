import { Effect, Layer, Redacted, Schema } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import { BootstrapFailed, CloudProvider, K8sClient, makeK8sClient, parseKubeconfig, PlanRejected, ResourceNotFound, VolumeProvider } from "@kumulo/core"
import type { AddonContext, AddonError, AuthenticationFailed, Capability, CloudError, DnsError, HttpTransportError, K8sManifest, Kubeconfig, ServerInfo, ServerSpec, VolumeError, ConfigInvalid, DnsProvider } from "@kumulo/core"
import type { K3sClusterConfig } from "../cluster-config.ts"

export type K3sError =
  | CloudError
  | PlanRejected
  | BootstrapFailed
  | ConfigInvalid
  | AddonError
  | DnsError
  | VolumeError
  | ResourceNotFound
  | AuthenticationFailed
  | HttpTransportError
import type {
  Ssh} from "@kumulo/distro-k3s";
import {
  drainAndRemove,
  fetchKubeconfig,
  resolveServerUrl,
  runBootstrap,
  SshLive
} from "@kumulo/distro-k3s"
import type { SshHost } from "@kumulo/distro-k3s"
import { installAddons, resolveAddons } from "@kumulo/addons"
import type { CinderAuth } from "@kumulo/volumes-cinder"
import { providerFor } from "../provider/registry.ts"
import type { OpenStackEnv } from "../doctor-openstack/env.ts"
import {
  CloudCredentialEnv,
  k3sCloudCredentialLayer,
  k3sHetznerVolumeProviderLayer,
  k3sVolumeProviderLayer,
  secGroupRules
} from "./env.ts"
import { k8sHttpClientLayer } from "./k8s-http-client.ts"
import { buildK3sServerSpecs } from "./plan.ts"
import { withRowProgress } from "../spinner.ts"
import { dnsProviderLayerFor, reconcileDns, removeDns } from "../dns.ts"

export interface K3sApplyResult {
  readonly apiEndpoint: string
  readonly kubeconfigPath: string
}

const CILIUM_CAPS: ReadonlyArray<Capability> = ["cilium"]
const NO_CAPS: ReadonlyArray<Capability> = []
const _capabilities = (config: K3sClusterConfig): ReadonlyArray<Capability> =>
  config.addons.cni === "cilium" ? CILIUM_CAPS : NO_CAPS

const _toHost = (info: ServerInfo): SshHost => ({ ip: info.ip, port: 22 })

const _requireNonEmpty = <A>(
  items: ReadonlyArray<A>,
  what: string
): Effect.Effect<readonly [A, ...Array<A>], BootstrapFailed> => {
  const [first, ...rest] = items
  return first === undefined
    ? Effect.fail(new BootstrapFailed({ node: "-", phase: "nodes", log: `no ${what} servers were created` }))
    : Effect.succeed([first, ...rest])
}

const _apiDnsFqdn = (config: K3sClusterConfig): string | undefined => {
  const dns = config.dns
  if (dns.module === "none") return undefined
  const name = dns.records.find((r) => r.target === "api_server")?.name
  return name === undefined ? undefined : `${name}.${dns.zone}`
}

const _tlsSans = (
  args: { readonly config: K3sClusterConfig; readonly masterIps: ReadonlyArray<string>; readonly lbVip: string }
): ReadonlyArray<string> => {
  const fqdn = _apiDnsFqdn(args.config)
  return [...args.masterIps, args.lbVip, ...(fqdn === undefined ? [] : [fqdn])]
}

interface Infra {
  readonly lbVip: string
  readonly masterInfos: ReadonlyArray<ServerInfo>
  readonly workerInfos: ReadonlyArray<ServerInfo>
}

const NO_REPLACE: ReadonlySet<string> = new Set()

// safety: replacing every master at once wipes etcd quorum, control-plane replace is refused outright
const _refuseMasterReplace = (
  specs: ReadonlyArray<ServerSpec>,
  replace: ReadonlySet<string>
): Effect.Effect<void, PlanRejected> => {
  const masters = specs.filter((spec) => spec.role === "master" && replace.has(spec.name)).map((spec) => spec.name)
  return masters.length === 0 ? Effect.void : Effect.fail(
    new PlanRejected({
      reason:
        `control-plane nodes cannot be replaced in place (${masters.join(", ")}): it would destroy etcd quorum. ` +
        `Delete and recreate the cluster, or revert the masters' config.`
    })
  )
}

// safety: drifted servers are deleted (and awaited gone) before ensureServer recreates them
const _deleteDrifted = (
  { config, replace }: { readonly config: K3sClusterConfig; readonly replace: ReadonlySet<string> }
): Effect.Effect<void, CloudError, CloudProvider> =>
  Effect.gen(function*() {
    const cloudProvider = yield* CloudProvider
    const inventory = yield* cloudProvider.listClusterResources(config.name)
    yield* Effect.forEach(
      inventory.servers.filter((server) => replace.has(server.name)),
      cloudProvider.deleteServer,
      { concurrency: 5, discard: true }
    )
  })

const _provisionInfra = (
  config: K3sClusterConfig,
  replace: ReadonlySet<string>
): Effect.Effect<Infra, CloudError | PlanRejected, CloudProvider> =>
  Effect.gen(function*() {
    const cloudProvider = yield* CloudProvider
    const lb = yield* withRowProgress({
      match: (name) =>
        name.startsWith("network/") || name.startsWith("security-group/") || name.startsWith("load-balancer/"),
      effect: Effect.gen(function*() {
        yield* cloudProvider.ensureNetwork({ cidr: config.network.cidr })
        yield* cloudProvider.ensureSecurityGroups({ rules: secGroupRules(config) })
        return yield* cloudProvider.ensureLoadBalancer({ members: [] })
      })
    })

    const specs = buildK3sServerSpecs(config)
    yield* _refuseMasterReplace(specs, replace)
    if (replace.size > 0) yield* _deleteDrifted({ config, replace })
    const masterSpecs = specs.filter((s) => s.role === "master")
    const workerSpecs = specs.filter((s) => s.role === "worker")
    const masterInfos = yield* Effect.forEach(masterSpecs, cloudProvider.ensureServer, { concurrency: masterSpecs.length })
    const workerInfos = yield* Effect.forEach(workerSpecs, cloudProvider.ensureServer, { concurrency: 10 })
    return { lbVip: lb.vip, masterInfos, workerInfos }
  })

const _bootstrap = (config: K3sClusterConfig, infra: Infra): Effect.Effect<SshHost, BootstrapFailed, Ssh> =>
  Effect.gen(function*() {
    const masters = yield* _requireNonEmpty(infra.masterInfos.map(_toHost), "master")
    yield* runBootstrap({
      masters,
      workers: infra.workerInfos.map(_toHost),
      k3sVersion: config.version,
      tlsSans: _tlsSans({ config, masterIps: infra.masterInfos.map((m) => m.ip), lbVip: infra.lbVip }),
      cloudControllerManager: config.addons.cloud_controller_manager,
      cni: config.addons.cni,
      extraServerArgs: config.k3s.extra_server_args,
      extraAgentArgs: config.k3s.extra_agent_args
    })
    return masters[0]
  })

export const k8sClientLive = (
  { config, master1 }: { readonly config: K3sClusterConfig; readonly master1: SshHost }
): Layer.Layer<K8sClient, BootstrapFailed | ConfigInvalid, Ssh> =>
  Layer.effect(
    K8sClient,
    Effect.gen(function*() {
      const raw = yield* fetchKubeconfig({ master1, clusterName: config.name, serverUrl: `https://${master1.ip}:6443` })
      const parsed = yield* parseKubeconfig(raw.content)
      const client = yield* Effect.provide(HttpClient.HttpClient, k8sHttpClientLayer({ auth: parsed.auth, caPem: parsed.caPem }))
      return makeK8sClient({ client, server: parsed.server })
    })
  )

const _installAddons = (config: K3sClusterConfig): Effect.Effect<void, AddonError, CloudCredentialEnv | K8sClient> =>
  Effect.gen(function*() {
    const k8sClient = yield* K8sClient
    const cred = yield* CloudCredentialEnv
    const cloudCredential = cred.provider === "hetzner"
      ? { provider: "hetzner" as const, token: Redacted.value(cred.token) }
      : {
        provider: "openstack" as const,
        authUrl: cred.authUrl,
        region: cred.region,
        applicationCredentialId: cred.applicationCredentialId,
        applicationCredentialSecret: cred.applicationCredentialSecret
      }
    const addons = resolveAddons({ distro: "k3s", addons: config.addons, capabilities: _capabilities(config), cloudCredential })
    const ctx: AddonContext = { clusterName: config.name, capabilities: _capabilities(config) }
    yield* installAddons({ k8sClient, addons, ctx })
  })

const _reconcileVolumes = (config: K3sClusterConfig): Effect.Effect<void, VolumeError, VolumeProvider> => {
  const volumes = config.volumes
  return volumes.module === "none"
    ? Effect.void
    : Effect.gen(function*() {
      const provider = yield* VolumeProvider
      yield* Effect.forEach(
        volumes.managed,
        (v) => provider.ensureVolume({ name: v.name, sizeGb: v.size_gb, type: v.type, retain: v.retain }),
        { discard: true }
      )
    })
}

export const orphanedWorkers = (
  { config, workerInfos }: { readonly config: K3sClusterConfig; readonly workerInfos: ReadonlyArray<ServerInfo> }
): ReadonlyArray<ServerInfo> => {
  const desiredNames = new Set(buildK3sServerSpecs(config).filter((s) => s.role === "worker").map((s) => s.name))
  return workerInfos.filter((info) => !desiredNames.has(info.name))
}

const _drainOrphanedWorkers = (
  config: K3sClusterConfig
): Effect.Effect<void, BootstrapFailed | CloudError, CloudProvider | K8sClient> =>
  Effect.gen(function*() {
    const cloudProvider = yield* CloudProvider
    const k8sClient = yield* K8sClient
    const inventory = yield* cloudProvider.listClusterResources(config.name)
    const existingWorkers = inventory.servers.filter((s) => s.name.includes("-worker-"))
    const orphaned = orphanedWorkers({ config, workerInfos: existingWorkers })
    yield* Effect.forEach(
      orphaned,
      (info) =>
        drainAndRemove({ client: k8sClient, node: { name: info.name, role: "worker" } }).pipe(
          Effect.andThen(cloudProvider.deleteServer(info))
        ),
      { discard: true }
    )
  })

const _writeKubeconfig = (
  config: K3sClusterConfig,
  master1: SshHost,
  lbVip: string,
  configDir: string
): Effect.Effect<string, BootstrapFailed, Ssh> =>
  Effect.gen(function*() {
    const serverUrl = resolveServerUrl({ lbVip, apiDnsName: _apiDnsFqdn(config), masterIp: master1.ip })
    const kubeconfig = yield* fetchKubeconfig({ master1, clusterName: config.name, serverUrl })
    const path = `${configDir}/${config.name}.kubeconfig`
    yield* Effect.promise(() => import("node:fs/promises").then((fs) => fs.writeFile(path, kubeconfig.content, { mode: 0o600 })))
    return path
  })

const _cloudProviderLayerFor = (
  config: K3sClusterConfig
): Layer.Layer<CloudProvider, AuthenticationFailed, OpenStackEnv | HttpClient.HttpClient> =>
  providerFor(config).cloudProviderLayer(config)

const _volumeProviderLayerFor = (
  config: K3sClusterConfig
): Layer.Layer<VolumeProvider, AuthenticationFailed, CinderAuth | HttpClient.HttpClient> =>
  config.volumes.module === "hcloud" ? k3sHetznerVolumeProviderLayer(config) : k3sVolumeProviderLayer({ tag: config.name })

export const applyK3sEffect = (
  { config, configDir, replace = NO_REPLACE, k8sClientLayer = k8sClientLive }: {
    readonly config: K3sClusterConfig
    readonly configDir: string
    readonly replace?: ReadonlySet<string>
    readonly k8sClientLayer?: (
      args: { readonly config: K3sClusterConfig; readonly master1: SshHost }
    ) => Layer.Layer<K8sClient, BootstrapFailed | ConfigInvalid, Ssh>
  }
): Effect.Effect<K3sApplyResult, K3sError, CloudProvider | Ssh | DnsProvider | VolumeProvider | CloudCredentialEnv> =>
  Effect.gen(function*() {
    const nodeRow = (name: string): boolean => name.startsWith(`kumulo-${config.name}-`)
    const { infra, master1 } = yield* withRowProgress({
      match: nodeRow,
      effect: Effect.gen(function*() {
        const infra = yield* _provisionInfra(config, replace)
        const master1 = yield* _bootstrap(config, infra)
        yield* Effect.gen(function*() {
          yield* _installAddons(config)
          yield* _drainOrphanedWorkers(config)
        }).pipe(Effect.provide(k8sClientLayer({ config, master1 })))
        return { infra, master1 }
      })
    })
    yield* withRowProgress({
      match: (name) => name.startsWith("dns/"),
      effect: reconcileDns({ config, targets: { api_server: { kind: "ip", value: infra.lbVip } } })
    })
    yield* withRowProgress({
      match: (name) => name.startsWith("volume/"),
      effect: _reconcileVolumes(config)
    })
    const kubeconfigPath = yield* _writeKubeconfig(config, master1, infra.lbVip, configDir)
    return { apiEndpoint: infra.lbVip, kubeconfigPath }
  })

export const applyK3s = (
  args: { readonly config: K3sClusterConfig; readonly configDir: string; readonly replace?: ReadonlySet<string> }
): Effect.Effect<K3sApplyResult, K3sError, OpenStackEnv | CinderAuth | HttpClient.HttpClient> =>
  applyK3sEffect(args).pipe(
    Effect.provide(SshLive),
    Effect.provide(_volumeProviderLayerFor(args.config)),
    Effect.provide(dnsProviderLayerFor(args.config)),
    Effect.provide(_cloudProviderLayerFor(args.config)),
    Effect.provide(k3sCloudCredentialLayer(args.config))
  )

export const deleteK3sEffect = (
  config: K3sClusterConfig
): Effect.Effect<void, K3sError, CloudProvider | DnsProvider | VolumeProvider> =>
  Effect.gen(function*() {
    const volumeProvider = yield* VolumeProvider
    const cloudProvider = yield* CloudProvider
    const volumes = config.volumes
    if (volumes.module !== "none") {
      yield* withRowProgress({
        match: (name) => name.startsWith("volume/"),
        effect: Effect.gen(function*() {
          const existing = yield* volumeProvider.listClusterVolumes(config.name)
          for (const vol of existing) {
            const retained = volumes.managed.find((r) => r.name === vol.name)?.retain ?? false
            if (!retained) yield* volumeProvider.deleteVolume({ id: vol.id })
          }
        })
      })
    }
    yield* removeDns(config)
    yield* withRowProgress({
      match: (name) =>
        name.startsWith(`kumulo-${config.name}-`) || name.startsWith("network/") ||
        name.startsWith("security-group/") || name.startsWith("load-balancer/"),
      effect: cloudProvider.deleteByTag(config.name)
    })
  })

export const deleteK3s = (config: K3sClusterConfig): Effect.Effect<void, K3sError, OpenStackEnv | CinderAuth | HttpClient.HttpClient> =>
  deleteK3sEffect(config).pipe(
    Effect.provide(_volumeProviderLayerFor(config)),
    Effect.provide(dnsProviderLayerFor(config)),
    Effect.provide(_cloudProviderLayerFor(config))
  )

export const kubeconfigK3sEffect = (config: K3sClusterConfig): Effect.Effect<Kubeconfig, K3sError, CloudProvider | Ssh> =>
  Effect.gen(function*() {
    const cloudProvider = yield* CloudProvider
    const inventory = yield* cloudProvider.listClusterResources(config.name)
    const masterInfo = inventory.servers.find((s) => s.name.includes("-master-"))
    if (masterInfo === undefined) return yield* Effect.fail(new ResourceNotFound({ kind: "server", ref: config.name }))
    const lb = yield* cloudProvider.ensureLoadBalancer({ members: [] })
    const serverUrl = resolveServerUrl({ lbVip: lb.vip, apiDnsName: _apiDnsFqdn(config), masterIp: masterInfo.ip })
    return yield* fetchKubeconfig({ master1: _toHost(masterInfo), clusterName: config.name, serverUrl })
  })

export const kubeconfigK3s = (
  config: K3sClusterConfig
): Effect.Effect<Kubeconfig, K3sError, OpenStackEnv | CinderAuth | HttpClient.HttpClient> =>
  kubeconfigK3sEffect(config).pipe(
    Effect.provide(SshLive),
    Effect.provide(_cloudProviderLayerFor(config))
  )

export interface K3sNodeStatus {
  readonly name: string
  readonly ready: boolean
}

export interface K3sStatus {
  readonly exists: boolean
  readonly apiEndpoint?: string
  readonly nodes: ReadonlyArray<K3sNodeStatus>
}

const NODES_REF = { path: "/api/v1/nodes", kind: "Node" }

const _NodeStatusShape = Schema.Struct({
  metadata: Schema.optional(Schema.Struct({ name: Schema.optional(Schema.String) })),
  status: Schema.optional(Schema.Struct({
    conditions: Schema.optional(Schema.Array(Schema.Struct({ type: Schema.String, status: Schema.String })))
  }))
})

const _decodeNodeStatus = (manifest: K8sManifest) => Schema.decodeUnknownExit(_NodeStatusShape)(manifest)

const _nodeReady = (manifest: K8sManifest): boolean => {
  const decoded = _decodeNodeStatus(manifest)
  if (decoded._tag !== "Success") return false
  return decoded.value.status?.conditions?.some((c) => c.type === "Ready" && c.status === "True") ?? false
}

const _nodeName = (manifest: K8sManifest): string => {
  const decoded = _decodeNodeStatus(manifest)
  return decoded._tag === "Success" ? decoded.value.metadata?.name ?? "" : ""
}

export const k3sStatusEffect = (
  { config, k8sClientLayer = k8sClientLive }: {
    readonly config: K3sClusterConfig
    readonly k8sClientLayer?: (
      args: { readonly config: K3sClusterConfig; readonly master1: SshHost }
    ) => Layer.Layer<K8sClient, BootstrapFailed | ConfigInvalid, Ssh>
  }
): Effect.Effect<K3sStatus, K3sError, CloudProvider | Ssh> =>
  Effect.gen(function*() {
    const cloudProvider = yield* CloudProvider
    const inventory = yield* cloudProvider.listClusterResources(config.name)
    const masterInfo = inventory.servers.find((s) => s.name.includes("-master-"))
    if (masterInfo === undefined) return { exists: false, nodes: [] }
    const lb = yield* cloudProvider.ensureLoadBalancer({ members: [] })
    const nodes = yield* Effect.gen(function*() {
      const client = yield* K8sClient
      const manifests = yield* client.list(NODES_REF)
      return manifests.map((m) => ({ name: _nodeName(m), ready: _nodeReady(m) }))
    }).pipe(Effect.provide(k8sClientLayer({ config, master1: _toHost(masterInfo) })))
    return { exists: true, apiEndpoint: lb.vip, nodes }
  })

export const k3sStatus = (
  config: K3sClusterConfig
): Effect.Effect<K3sStatus, K3sError, OpenStackEnv | CinderAuth | HttpClient.HttpClient> =>
  k3sStatusEffect({ config }).pipe(
    Effect.provide(SshLive),
    Effect.provide(_cloudProviderLayerFor(config))
  )
