import { Console, Effect } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import { AuthenticationFailed, makeK8sClient, parseKubeconfig, waitForDeploymentAvailable } from "@kumulo/core"
import type { CloudProvider, K3sClusterConfig, ResourceRef , K8sClient} from "@kumulo/core"
import { refForPlan, renderMastersPlan, renderUpgradePlan, renderWorkersPlan } from "@kumulo/distro-k3s"
import { refFor, systemUpgradeControllerManifests } from "@kumulo/addons"
import type { Ssh} from "@kumulo/distro-k3s";
import { SshLive } from "@kumulo/distro-k3s"
import { k3sPlanEffect } from "../k3s/plan.ts"
import { providerFor } from "../provider/registry.ts"
import { k8sHttpClientLayer } from "../k3s/k8s-http-client.ts"
import { applyK3s, deleteK3s, k3sStatus, kubeconfigK3s, kubeconfigK3sEffect } from "../k3s/reconcile.ts"
import type { K3sError, K3sStatus } from "../k3s/reconcile.ts"
import { OpenStackEnv, OS_ENV_KEYS, OS_SECRET_ENV_KEYS } from "../doctor-openstack/env.ts"
import { keystoneAuthCheck } from "../doctor-openstack/keystone-auth.ts"
import { microversionCheck, NOVA_MICROVERSION, probeMicroversion } from "../doctor-openstack/nova.ts"
import { fetchNovaLimits, quotaHeadroomCheck } from "../doctor-openstack/quota.ts"
import type { CinderAuth } from "@kumulo/volumes-cinder"
import type { DistroEntry, DistroUpgradeArgs } from "./types.ts"

const _statusK3s = Effect.fn(function*(config: K3sClusterConfig) {
  const info: K3sStatus = yield* k3sStatus(config)
  if (!info.exists) {
    yield* Console.log(`Cluster "${config.name}" does not exist.`)
    return
  }
  const nodes = info.nodes.length === 0
    ? "(none)"
    : info.nodes.map((n) => `${n.name} (${n.ready ? "Ready" : "NotReady"})`).join(", ")
  yield* Console.log(
    [`Cluster "${config.name}": running`, `  API endpoint: ${info.apiEndpoint}`, `  Nodes: ${nodes}`].join("\n")
  )
})

// `--dry-run` just renders the Plan CRs (the SUC plan for a new k3s
// version) without touching the cluster.
const _renderK3s = (
  { config, workerConcurrency }: { readonly config: K3sClusterConfig; readonly workerConcurrency: number }
) =>
  Effect.gen(function*() {
    const plan = renderUpgradePlan({ version: config.version, workerConcurrency })
    yield* Console.log(plan.map((manifest) => JSON.stringify(manifest, null, 2)).join("\n---\n"))
  })

const SUC_DEPLOYMENT_REF: ResourceRef = {
  path: "/apis/apps/v1/namespaces/system-upgrade/deployments/system-upgrade-controller",
  kind: "Deployment"
}

/** Builds a `K8sClient` against the already-provisioned cluster's own kubeconfig (ports-only, see `reconcile.ts`'s identical split). */
const _k8sClientForUpgradeEffect = (
  config: K3sClusterConfig
): Effect.Effect<K8sClient["Service"], K3sError, CloudProvider | Ssh | HttpClient.HttpClient> =>
  Effect.gen(function*() {
    const kubeconfig = yield* kubeconfigK3sEffect(config)
    const parsed = yield* parseKubeconfig(kubeconfig.content)
    const client = yield* Effect.provide(HttpClient.HttpClient, k8sHttpClientLayer({ auth: parsed.auth, caPem: parsed.caPem }))
    return makeK8sClient({ client, server: parsed.server })
  })

/** `_k8sClientForUpgradeEffect` wired to its live Layers. */
const _k8sClientForUpgrade = (
  config: K3sClusterConfig
): Effect.Effect<K8sClient["Service"], K3sError, OpenStackEnv | CinderAuth | HttpClient.HttpClient> =>
  _k8sClientForUpgradeEffect(config).pipe(
    Effect.provide(SshLive),
    Effect.provide(providerFor(config).cloudProviderLayer(config))
  )

// The Plan CRD is owned by the SUC controller — apply its manifests
// (idempotent SSA, no-op if the addon was already installed at create time)
// and only wait for the Deployment to become ready if this call is the one
// that just installed it.
const _ensureSucReady = (k8sClient: K8sClient["Service"]) =>
  Effect.gen(function*() {
    const alreadyInstalled = yield* k8sClient.get(SUC_DEPLOYMENT_REF).pipe(
      Effect.as(true),
      Effect.catchTag("ResourceNotFound", () => Effect.succeed(false))
    )
    yield* Effect.forEach(
      systemUpgradeControllerManifests(),
      (manifest) => k8sClient.apply(refFor(manifest), manifest),
      { discard: true }
    )
    if (!alreadyInstalled) {
      yield* waitForDeploymentAvailable({
        get: k8sClient.get,
        ref: SUC_DEPLOYMENT_REF,
        interval: "2 seconds",
        timeout: "2 minutes"
      })
    }
  })

// Applies the SUC Plan CRs through the in-house k8s SSA client:
// masters first (workers' `prepare` step polls the masters Plan by name, so
// applying it second would only cost an extra reconcile loop, not correctness).
export const applyK3sUpgradeWith = (
  { config, workerConcurrency, k8sClient }: {
    readonly config: K3sClusterConfig
    readonly workerConcurrency: number
    readonly k8sClient: K8sClient["Service"]
  }
) =>
  Effect.gen(function*() {
    yield* _ensureSucReady(k8sClient)
    const masters = renderMastersPlan(config.version)
    const workers = renderWorkersPlan({ version: config.version, concurrency: workerConcurrency })
    yield* k8sClient.apply(refForPlan(masters), masters)
    yield* k8sClient.apply(refForPlan(workers), workers)
    yield* Console.log(
      `Applied SUC Plans for k3s ${config.version} on cluster "${config.name}" (workers @ concurrency ${workerConcurrency}).`
    )
  })

const _applyK3s = (
  { config, workerConcurrency }: { readonly config: K3sClusterConfig; readonly workerConcurrency: number }
) =>
  Effect.gen(function*() {
    const k8sClient = yield* _k8sClientForUpgrade(config)
    yield* applyK3sUpgradeWith({ config, workerConcurrency, k8sClient })
  })

const _upgradeK3s = ({ config, dryRun, workerConcurrency }: DistroUpgradeArgs<K3sClusterConfig>) =>
  dryRun ? _renderK3s({ config, workerConcurrency }) : _applyK3s({ config, workerConcurrency })

const _plannedInstanceCount = (config: K3sClusterConfig): number =>
  config.masters.count + config.worker_pools.reduce((total, pool) => total + pool.count, 0)

// ponytail: only the checks constructible from `OpenStackEnv` + config.
// `octaviaCapabilityCheck` needs a `ProviderProfile` and
// `resourceResolutionCheck` a live `CloudProvider` — neither is in
// `DistroServices`; add them here once an entry carries them.
const _k3sDoctorChecks = Effect.fn(function*({ config }: { readonly config: K3sClusterConfig }) {
  const env = yield* OpenStackEnv
  const client = yield* HttpClient.HttpClient
  const keystone = env.keystone
  const region = env.region ?? config.auth.region
  if (keystone === undefined) {
    const unavailable = Effect.fail(new AuthenticationFailed({ hint: env.unavailableReason ?? "OpenStack auth unavailable" }))
    return [keystoneAuthCheck({ token: unavailable })]
  }
  return [
    keystoneAuthCheck({ token: keystone.token }),
    microversionCheck({
      probe: probeMicroversion({ client, keystone, region, microversion: NOVA_MICROVERSION }),
      microversion: NOVA_MICROVERSION
    }),
    quotaHeadroomCheck({
      limits: fetchNovaLimits({ client, keystone, region }),
      plannedInstanceCount: _plannedInstanceCount(config)
    })
  ]
})

export const k3sEntry: DistroEntry<K3sClusterConfig> = {
  kind: "k3s",
  // Object storage is only wired for the ovh-mks path (scope.md).
  supportsObjectStorage: false,
  plan: (config: K3sClusterConfig) =>
    k3sPlanEffect(config).pipe(Effect.provide(providerFor(config).cloudProviderLayer(config))),
  deletePlanActions: (config: K3sClusterConfig) =>
    Effect.succeed([{ _tag: "Delete" as const, name: `cluster/${config.name}` }]),
  apply: (a) =>
    applyK3s(a).pipe(
      Effect.map((result) => ({
        summary: `Cluster "${a.config.name}" is up (${result.apiEndpoint}); kubeconfig at ${result.kubeconfigPath}.`
      }))
    ),
  delete: deleteK3s,
  kubeconfig: kubeconfigK3s,
  deletedLabel: "cluster",
  // `applyK3s` reconciles volumes internally and logs nothing per-row.
  appliedPrefixes: [],
  status: _statusK3s,
  upgrade: _upgradeK3s,
  credentialsLabel: "openstack",
  // The full OS_* set `loadCredentials` reads — only some are required
  // (depends on auth.method); presence is shown for all so the operator sees
  // which auth path will be picked.
  requiredEnvVars: [...OS_ENV_KEYS, ...OS_SECRET_ENV_KEYS],
  doctorChecks: _k3sDoctorChecks
}
