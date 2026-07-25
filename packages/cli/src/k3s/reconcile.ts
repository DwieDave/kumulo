import { Effect, Layer, Redacted, Schema } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import {
  BootstrapFailed,
  CloudProvider,
  ConfigInvalid,
  DnsProvider,
  K8sClient,
  makeK8sClient,
  parseKubeconfig,
  ResourceNotFound,
  VolumeProvider
} from "@kumulo/core"
import type {
  AddonContext,
  AddonError,
  AuthenticationFailed,
  Capability,
  CloudError,
  ClusterConfig,
  DnsError,
  HttpTransportError,
  K8sManifest,
  Kubeconfig,
  ServerInfo,
  VolumeError
} from "@kumulo/core"

export type K3sError =
  | CloudError
  | BootstrapFailed
  | ConfigInvalid
  | AddonError
  | DnsError
  | VolumeError
  | ResourceNotFound
  | AuthenticationFailed
  | HttpTransportError
import {
  drainAndRemove,
  fetchKubeconfig,
  resolveServerUrl,
  runBootstrap,
  Ssh,
  SshLive
} from "@kumulo/distro-k3s"
import type { SshHost } from "@kumulo/distro-k3s"
import { installAddons, resolveAddons } from "@kumulo/addons"
import { CinderAuth } from "@kumulo/volumes-cinder"
import { OpenStackEnv } from "../doctor-openstack/env.ts"
import {
  CloudCredentialEnv,
  k3sCloudCredentialLayer,
  k3sCloudProviderLayer,
  k3sHetznerCloudProviderLayer,
  k3sHetznerVolumeProviderLayer,
  k3sVolumeProviderLayer,
  secGroupRules
} from "./env.ts"
import { k8sHttpClientLayer } from "./k8s-http-client.ts"
import { buildK3sServerSpecs } from "./plan.ts"
import { dnsProviderLayerFor, reconcileDns, removeDns } from "../dns.ts"

export interface K3sApplyResult {
  readonly apiEndpoint: string
  readonly kubeconfigPath: string
}

const CILIUM_CAPS: ReadonlyArray<Capability> = ["cilium"]
const NO_CAPS: ReadonlyArray<Capability> = []
const _capabilities = (config: ClusterConfig): ReadonlyArray<Capability> =>
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

// TLS SANs: every master IP + the LB VIP + the DNS api record when
// configured (127.0.0.1 is always added by `renderServerInstallScript` itself).
const _apiDnsRecordName = (config: ClusterConfig): string | undefined =>
  config.dns.module === "none" ? undefined : config.dns.records.find((r) => r.target === "api_server")?.name

const _apiDnsFqdn = (config: ClusterConfig): string | undefined => {
  const name = _apiDnsRecordName(config)
  return name === undefined ? undefined : `${name}.${config.dns.zone}`
}

const _tlsSans = (
  args: { readonly config: ClusterConfig; readonly masterIps: ReadonlyArray<string>; readonly lbVip: string }
): ReadonlyArray<string> => {
  const fqdn = _apiDnsFqdn(args.config)
  return [...args.masterIps, args.lbVip, ...(fqdn === undefined ? [] : [fqdn])]
}

interface Infra {
  readonly lbVip: string
  readonly masterInfos: ReadonlyArray<ServerInfo>
  readonly workerInfos: ReadonlyArray<ServerInfo>
}

/** Network → Security → LB → Nodes (ServerGroups is absorbed into `ensureServer`). */
const _provisionInfra = (config: ClusterConfig): Effect.Effect<Infra, CloudError, CloudProvider> =>
  Effect.gen(function*() {
    const cloudProvider = yield* CloudProvider
    yield* cloudProvider.ensureNetwork({ cidr: config.network.cidr })
    yield* cloudProvider.ensureSecurityGroups({ rules: secGroupRules(config) })
    const lb = yield* cloudProvider.ensureLoadBalancer({ members: [] })

    const specs = buildK3sServerSpecs(config)
    const masterSpecs = specs.filter((s) => s.role === "master")
    const workerSpecs = specs.filter((s) => s.role === "worker")
    const masterInfos = yield* Effect.forEach(masterSpecs, cloudProvider.ensureServer, { concurrency: masterSpecs.length })
    const workerInfos = yield* Effect.forEach(workerSpecs, cloudProvider.ensureServer, { concurrency: 10 })
    return { lbVip: lb.vip, masterInfos, workerInfos }
  })

/** Bootstrap: real SSH-executed install (`runBootstrap`), readiness-gated; returns master 1. */
const _bootstrap = (config: ClusterConfig, infra: Infra): Effect.Effect<SshHost, BootstrapFailed, Ssh> =>
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

/**
 * Injectable K8sClient seam: a `K8sClient` `Layer` built from master
 * 1's own (unrewritten) kubeconfig, fetched over `Ssh` — Addons/scale-down
 * drain/`status` all take `K8sClient` from context instead of a hand-threaded
 * parameter, so production wiring stays identical (`k8sClientLive` is the
 * default) while tests can `Effect.provide` a fake `K8sClient` Layer instead.
 */
export const k8sClientLive = (
  { config, master1 }: { readonly config: ClusterConfig; readonly master1: SshHost }
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

/** Addons phase — `CloudCredentialEnv`'s union tag picks the CCM/CSI credential shape `@kumulo/addons` needs (R11). */
const _installAddons = (config: ClusterConfig): Effect.Effect<void, AddonError, CloudCredentialEnv | K8sClient> =>
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

/** Volumes phase: skipped for `volumes.module: none` — "cinder" and "hcloud" both converge through the resolved `VolumeProvider` (R2). */
const _reconcileVolumes = (config: ClusterConfig): Effect.Effect<void, VolumeError, VolumeProvider> =>
  config.volumes.module === "none"
    ? Effect.void
    : Effect.gen(function*() {
      const provider = yield* VolumeProvider
      yield* Effect.forEach(
        config.volumes.managed,
        (v) => provider.ensureVolume({ name: v.name, sizeGb: v.size_gb, type: v.type, retain: v.retain }),
        { discard: true }
      )
    })

/** Any currently-running worker not in the desired spec set (exported for direct unit testing, no k8s client needed). */
export const orphanedWorkers = (
  { config, workerInfos }: { readonly config: ClusterConfig; readonly workerInfos: ReadonlyArray<ServerInfo> }
): ReadonlyArray<ServerInfo> => {
  const desiredNames = new Set(buildK3sServerSpecs(config).filter((s) => s.role === "worker").map((s) => s.name))
  return workerInfos.filter((info) => !desiredNames.has(info.name))
}

/**
 * Scale-down: `infra.workerInfos` only covers this apply's *desired*
 * specs (`ensureServer` is create-if-missing-by-name, it never reports a
 * server that's no longer desired) — orphan detection needs the actual
 * tagged inventory instead, filtered to workers by the same naming
 * convention `kubeconfigK3sEffect` uses to pick out masters.
 */
const _drainOrphanedWorkers = (
  config: ClusterConfig
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

/** Kubeconfig phase: LB VIP / DNS name / master IP precedence, written 0600 to `<name>.kubeconfig`. */
const _writeKubeconfig = (
  config: ClusterConfig,
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

/** `config.provider` → `CloudProvider` Layer (R2/R7) — every apply/delete/kubeconfig/status entry point below dispatches through this. */
const _cloudProviderLayerFor = (
  config: ClusterConfig
): Layer.Layer<CloudProvider, AuthenticationFailed, OpenStackEnv | HttpClient.HttpClient> =>
  config.provider === "hetzner" ? k3sHetznerCloudProviderLayer(config) : k3sCloudProviderLayer(config)

/**
 * `volumes.module` → `VolumeProvider` Layer. `"none"` and `"cinder"` both
 * resolve through the existing Cinder-backed Layer (lazy, never-failing at
 * build time — safe even when nothing is ever converged); only `"hcloud"`
 * needs `HCLOUD_TOKEN`.
 */
const _volumeProviderLayerFor = (
  config: ClusterConfig
): Layer.Layer<VolumeProvider, AuthenticationFailed, CinderAuth | HttpClient.HttpClient> =>
  config.volumes.module === "hcloud" ? k3sHetznerVolumeProviderLayer(config) : k3sVolumeProviderLayer({ tag: config.name })

// The full self-managed (k3s) phase pipeline, expressed purely against the
// ports (`CloudProvider`/`Ssh`/`DnsProvider`/`VolumeProvider`/`CloudCredentialEnv`) —
// kept separate from `applyK3s`'s live Layer wiring below so tests can
// drive it against fake `CloudProvider`/`Ssh` Layers instead.
//
// `k8sClientLayer` defaults to `k8sClientLive` (the real, kubeconfig-derived
// client) — production callers (`applyK3s`) never pass it, so wiring is
// identical; tests pass a fake `K8sClient` Layer to drive the Addons/drain
// phases without a real kubeconfig/HTTP round-trip.
export const applyK3sEffect = (
  { config, configDir, k8sClientLayer = k8sClientLive }: {
    readonly config: ClusterConfig
    readonly configDir: string
    readonly k8sClientLayer?: (
      args: { readonly config: ClusterConfig; readonly master1: SshHost }
    ) => Layer.Layer<K8sClient, BootstrapFailed | ConfigInvalid, Ssh>
  }
): Effect.Effect<K3sApplyResult, K3sError, CloudProvider | Ssh | DnsProvider | VolumeProvider | CloudCredentialEnv> =>
  Effect.gen(function*() {
    const infra = yield* _provisionInfra(config)
    const master1 = yield* _bootstrap(config, infra)
    yield* Effect.gen(function*() {
      yield* _installAddons(config)
      yield* _drainOrphanedWorkers(config)
    }).pipe(Effect.provide(k8sClientLayer({ config, master1 })))
    yield* reconcileDns({ config, apiTarget: { kind: "ip", value: infra.lbVip } })
    yield* _reconcileVolumes(config)
    const kubeconfigPath = yield* _writeKubeconfig(config, master1, infra.lbVip, configDir)
    return { apiEndpoint: infra.lbVip, kubeconfigPath }
  })

/** `applyK3sEffect` wired to its live Layers, `config.provider`/`config.dns.module`/`config.volumes.module`-dispatched (R2/R6). */
export const applyK3s = (
  args: { readonly config: ClusterConfig; readonly configDir: string }
): Effect.Effect<K3sApplyResult, K3sError, OpenStackEnv | CinderAuth | HttpClient.HttpClient> =>
  applyK3sEffect(args).pipe(
    Effect.provide(SshLive),
    Effect.provide(_volumeProviderLayerFor(args.config)),
    Effect.provide(dnsProviderLayerFor(args.config)),
    Effect.provide(_cloudProviderLayerFor(args.config)),
    Effect.provide(k3sCloudCredentialLayer(args.config))
  )

/** Delete: inventory-by-tag, `retain: true` volumes skipped; ports-only, see `applyK3sEffect`. */
export const deleteK3sEffect = (
  config: ClusterConfig
): Effect.Effect<void, K3sError, CloudProvider | DnsProvider | VolumeProvider> =>
  Effect.gen(function*() {
    const volumeProvider = yield* VolumeProvider
    const cloudProvider = yield* CloudProvider
    if (config.volumes.module !== "none") {
      const existing = yield* volumeProvider.listClusterVolumes(config.name)
      for (const vol of existing) {
        const retained = config.volumes.managed.find((r) => r.name === vol.name)?.retain ?? false
        if (!retained) yield* volumeProvider.deleteVolume({ id: vol.id })
      }
    }
    yield* removeDns(config)
    yield* cloudProvider.deleteByTag(config.name)
  })

/** `deleteK3sEffect` wired to its live Layers. */
export const deleteK3s = (config: ClusterConfig): Effect.Effect<void, K3sError, OpenStackEnv | CinderAuth | HttpClient.HttpClient> =>
  deleteK3sEffect(config).pipe(
    Effect.provide(_volumeProviderLayerFor(config)),
    Effect.provide(dnsProviderLayerFor(config)),
    Effect.provide(_cloudProviderLayerFor(config))
  )

/** Kubeconfig: resolves the tagged inventory + LB, re-fetches from master 1; ports-only, see `applyK3sEffect`. */
export const kubeconfigK3sEffect = (config: ClusterConfig): Effect.Effect<Kubeconfig, K3sError, CloudProvider | Ssh> =>
  Effect.gen(function*() {
    const cloudProvider = yield* CloudProvider
    const inventory = yield* cloudProvider.listClusterResources(config.name)
    const masterInfo = inventory.servers.find((s) => s.name.includes("-master-"))
    if (masterInfo === undefined) return yield* Effect.fail(new ResourceNotFound({ kind: "server", ref: config.name }))
    const lb = yield* cloudProvider.ensureLoadBalancer({ members: [] })
    const serverUrl = resolveServerUrl({ lbVip: lb.vip, apiDnsName: _apiDnsFqdn(config), masterIp: masterInfo.ip })
    return yield* fetchKubeconfig({ master1: _toHost(masterInfo), clusterName: config.name, serverUrl })
  })

/** `kubeconfigK3sEffect` wired to its live Layers. */
export const kubeconfigK3s = (
  config: ClusterConfig
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

// kumulo: WHY lenient decode — a Node manifest missing/malformed
// metadata.name or status.conditions decodes to the same "not ready" /
// "" defaults the manual guards previously fell back to, rather than
// failing status reporting outright.
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

/**
 * k3s status: inventory via `CloudProvider` by tag, node health via
 * `K8sClient` (same `k8sClientLive` production wiring as `applyK3sEffect`,
 * built from master 1's kubeconfig once the cluster's inventory says it exists).
 */
export const k3sStatusEffect = (
  { config, k8sClientLayer = k8sClientLive }: {
    readonly config: ClusterConfig
    readonly k8sClientLayer?: (
      args: { readonly config: ClusterConfig; readonly master1: SshHost }
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

/** `k3sStatusEffect` wired to its live Layers. */
export const k3sStatus = (
  config: ClusterConfig
): Effect.Effect<K3sStatus, K3sError, OpenStackEnv | CinderAuth | HttpClient.HttpClient> =>
  k3sStatusEffect({ config }).pipe(
    Effect.provide(SshLive),
    Effect.provide(_cloudProviderLayerFor(config))
  )
