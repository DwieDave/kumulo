import { Effect, Layer } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import {
  BootstrapFailed,
  CloudProvider,
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
  ConfigInvalid,
  DesiredRecord,
  DnsError,
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
import { k3sCloudProviderLayer, k3sDnsProviderLayer, k3sVolumeProviderLayer, secGroupRules } from "./env.ts"
import { k8sHttpClientLayer } from "./k8s-http-client.ts"
import { buildK3sServerSpecs } from "./plan.ts"

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

// FR-5.3 — TLS SANs: every master IP + the LB VIP + the DNS api record when
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

/** FR-2.3/FR-2.4 — Network → Security → LB → Nodes (ServerGroups is absorbed into `ensureServer`, FR-5.7). */
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

/** FR-5.1-5.4/D7 — Bootstrap: real SSH-executed install (`runBootstrap`), readiness-gated; returns master 1. */
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

const _cloudConfFromEnv = (region: string) => ({
  authUrl: process.env["OS_AUTH_URL"] ?? "",
  region,
  applicationCredentialId: process.env["OS_APPLICATION_CREDENTIAL_ID"] ?? "",
  applicationCredentialSecret: process.env["OS_APPLICATION_CREDENTIAL_SECRET"] ?? ""
})

/**
 * Injectable K8sClient seam (item 3): a `K8sClient` `Layer` built from master
 * 1's own (unrewritten) kubeconfig, fetched over `Ssh` — Addons/scale-down
 * drain/`status` all take `K8sClient` from context instead of a hand-threaded
 * parameter, so production wiring stays identical (`k8sClientLive` is the
 * default) while tests can `Effect.provide` a fake `K8sClient` Layer instead.
 */
export const k8sClientLive = (
  config: ClusterConfig,
  master1: SshHost
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

/** FR-9.1/D5 — Addons phase. */
const _installAddons = (config: ClusterConfig): Effect.Effect<void, AddonError, OpenStackEnv | K8sClient> =>
  Effect.gen(function*() {
    const k8sClient = yield* K8sClient
    const env = yield* OpenStackEnv
    const cloudConf = _cloudConfFromEnv(env.region ?? "")
    const addons = resolveAddons({ distro: "k3s", addons: config.addons, capabilities: _capabilities(config), cloudConf })
    const ctx: AddonContext = { clusterName: config.name, capabilities: _capabilities(config) }
    yield* installAddons({ k8sClient, addons, ctx })
  })

/** FR-7 — DNS phase: only wired for `dns.module: ovh` (the only implemented `DnsProvider`). */
const _reconcileDns = (config: ClusterConfig, apiTarget: string): Effect.Effect<void, DnsError, DnsProvider> =>
  config.dns.module !== "ovh"
    ? Effect.void
    : Effect.gen(function*() {
      const dns = yield* DnsProvider
      const records: ReadonlyArray<DesiredRecord> = config.dns.records.map((r) => ({
        name: r.name,
        target: r.target === "api_server" ? apiTarget : r.target
      }))
      yield* dns.ensureRecords(config.dns.zone, records)
    })

/** FR-8 — Volumes phase: only wired for `volumes.module: cinder`. */
const _reconcileVolumes = (config: ClusterConfig): Effect.Effect<void, VolumeError, VolumeProvider> =>
  config.volumes.module !== "cinder"
    ? Effect.void
    : Effect.gen(function*() {
      const provider = yield* VolumeProvider
      yield* Effect.forEach(
        config.volumes.retained,
        (v) => provider.ensureVolume({ name: v.name, sizeGb: v.size_gb, type: v.type, retain: v.retain }),
        { discard: true }
      )
    })

/** FR-2.7 — any currently-running worker not in the desired spec set (exported for direct unit testing, no k8s client needed). */
export const orphanedWorkers = (
  { config, workerInfos }: { readonly config: ClusterConfig; readonly workerInfos: ReadonlyArray<ServerInfo> }
): ReadonlyArray<ServerInfo> => {
  const desiredNames = new Set(buildK3sServerSpecs(config).filter((s) => s.role === "worker").map((s) => s.name))
  return workerInfos.filter((info) => !desiredNames.has(info.name))
}

/**
 * FR-2.7 — scale-down: `infra.workerInfos` only covers this apply's *desired*
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

/** FR-5.5 — Kubeconfig phase: LB VIP / DNS name / master IP precedence, written 0600 to `<name>.kubeconfig`. */
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

const _noopDns = { ensureRecords: () => Effect.void, removeClusterRecords: () => Effect.void }

const _dnsLayer = (config: ClusterConfig): Layer.Layer<DnsProvider, AuthenticationFailed, HttpClient.HttpClient> =>
  config.dns.module === "ovh" ? k3sDnsProviderLayer() : Layer.succeed(DnsProvider, _noopDns)

// FR-2.3/FR-5/FR-10.1 — the full self-managed (k3s) phase pipeline, in
// `SELF_MANAGED_PHASES` order, expressed purely against the ports
// (`CloudProvider`/`Ssh`/`DnsProvider`/`VolumeProvider`/`OpenStackEnv`) —
// kept separate from `applyK3s`'s live Layer wiring below so tests can
// drive it against fake `CloudProvider`/`Ssh` Layers instead.
//
// `k8sClientLayer` (item 3's seam) defaults to `k8sClientLive` (the real,
// kubeconfig-derived client) — production callers (`applyK3s`) never pass
// it, so wiring is identical; tests pass a fake `K8sClient` Layer to drive
// the Addons/drain phases without a real kubeconfig/HTTP round-trip.
export const applyK3sEffect = (
  { config, configDir, k8sClientLayer = k8sClientLive }: {
    readonly config: ClusterConfig
    readonly configDir: string
    readonly k8sClientLayer?: (
      config: ClusterConfig,
      master1: SshHost
    ) => Layer.Layer<K8sClient, BootstrapFailed | ConfigInvalid, Ssh>
  }
): Effect.Effect<K3sApplyResult, K3sError, CloudProvider | Ssh | DnsProvider | VolumeProvider | OpenStackEnv> =>
  Effect.gen(function*() {
    const infra = yield* _provisionInfra(config)
    const master1 = yield* _bootstrap(config, infra)
    yield* Effect.gen(function*() {
      yield* _installAddons(config)
      yield* _drainOrphanedWorkers(config)
    }).pipe(Effect.provide(k8sClientLayer(config, master1)))
    yield* _reconcileDns(config, infra.lbVip)
    yield* _reconcileVolumes(config)
    const kubeconfigPath = yield* _writeKubeconfig(config, master1, infra.lbVip, configDir)
    return { apiEndpoint: infra.lbVip, kubeconfigPath }
  })

/** FR-2.3/FR-5/FR-10.1 — `applyK3sEffect` wired to its live Layers (OpenStack `CloudProvider`, real SSH, dns-ovh, Cinder). */
export const applyK3s = (
  args: { readonly config: ClusterConfig; readonly configDir: string }
): Effect.Effect<K3sApplyResult, K3sError, OpenStackEnv | CinderAuth | HttpClient.HttpClient> =>
  applyK3sEffect(args).pipe(
    Effect.provide(SshLive),
    Effect.provide(k3sVolumeProviderLayer({ tag: args.config.name })),
    Effect.provide(_dnsLayer(args.config)),
    Effect.provide(k3sCloudProviderLayer(args.config))
  )

/** FR-2.6 — delete: inventory-by-tag, `retain: true` volumes skipped (AC-7); ports-only, see `applyK3sEffect`. */
export const deleteK3sEffect = (
  config: ClusterConfig
): Effect.Effect<void, K3sError, CloudProvider | DnsProvider | VolumeProvider> =>
  Effect.gen(function*() {
    const volumeProvider = yield* VolumeProvider
    const cloudProvider = yield* CloudProvider
    if (config.volumes.module === "cinder") {
      const existing = yield* volumeProvider.listClusterVolumes(config.name)
      for (const vol of existing) {
        const retained = config.volumes.retained.find((r) => r.name === vol.name)?.retain ?? false
        if (!retained) yield* volumeProvider.deleteVolume({ id: vol.id })
      }
    }
    if (config.dns.module === "ovh") {
      const dns = yield* DnsProvider
      yield* dns.removeClusterRecords(config.dns.zone, config.name)
    }
    yield* cloudProvider.deleteByTag(config.name)
  })

/** FR-2.6 — `deleteK3sEffect` wired to its live Layers. */
export const deleteK3s = (config: ClusterConfig): Effect.Effect<void, K3sError, OpenStackEnv | CinderAuth | HttpClient.HttpClient> =>
  deleteK3sEffect(config).pipe(
    Effect.provide(k3sVolumeProviderLayer({ tag: config.name })),
    Effect.provide(_dnsLayer(config)),
    Effect.provide(k3sCloudProviderLayer(config))
  )

/** FR-6.2/FR-2.1 — kubeconfig: resolves the tagged inventory + LB, re-fetches from master 1; ports-only, see `applyK3sEffect`. */
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

/** FR-6.2/FR-2.1 — `kubeconfigK3sEffect` wired to its live Layers. */
export const kubeconfigK3s = (
  config: ClusterConfig
): Effect.Effect<Kubeconfig, K3sError, OpenStackEnv | CinderAuth | HttpClient.HttpClient> =>
  kubeconfigK3sEffect(config).pipe(
    Effect.provide(SshLive),
    Effect.provide(k3sCloudProviderLayer(config))
  )
