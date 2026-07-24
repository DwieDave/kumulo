import { Console, Effect } from "effect"
import { Command, Flag } from "effect/unstable/cli"
import * as HttpClient from "effect/unstable/http/HttpClient"
import { K8sClient, makeK8sClient, parseKubeconfig, ResourceNotFound, waitForDeploymentAvailable } from "@kumulo/core"
import type { ClusterConfig, CloudProvider, ResourceRef } from "@kumulo/core"
import { findClusterByName, upgrade as upgradeMks } from "@kumulo/distro-ovh-mks"
import { refForPlan, renderMastersPlan, renderUpgradePlan, renderWorkersPlan } from "@kumulo/distro-k3s"
import { refFor, systemUpgradeControllerManifests } from "@kumulo/addons"
import { Ssh, SshLive } from "@kumulo/distro-k3s"
import { loadConfig } from "../config.ts"
import { k3sCloudProviderLayer } from "../k3s/env.ts"
import { k8sHttpClientLayer } from "../k3s/k8s-http-client.ts"
import type { K3sError } from "../k3s/reconcile.ts"
import { kubeconfigK3sEffect } from "../k3s/reconcile.ts"
import { MksEnv } from "../mks/env.ts"
import { kumulo } from "../root.ts"
import type { OpenStackEnv } from "../doctor-openstack/env.ts"
import type { CinderAuth } from "@kumulo/volumes-cinder"

const strategyFlag = Flag.choiceWithValue("strategy", [
  ["latest-patch", "LATEST_PATCH" as const],
  ["next-minor", "NEXT_MINOR" as const]
]).pipe(
  Flag.withDefault("LATEST_PATCH" as const),
  Flag.withDescription("ovh-mks only: upgrade to the latest patch of the current minor, or the next minor")
)
const workerConcurrencyFlag = Flag.integer("worker-concurrency").pipe(
  Flag.withDefault(1),
  Flag.withDescription("k3s only: how many worker nodes the SUC agent Plan upgrades at once")
)

// OVH drives the upgrade itself via its API; there's no local plan
// to render, just a lookup (by name, same as every other mks command) + the
// update call.
const _upgradeMks = (
  { config, strategy, yes }: { readonly config: ClusterConfig; readonly strategy: "LATEST_PATCH" | "NEXT_MINOR"; readonly yes: boolean }
) =>
  Effect.gen(function*() {
    if (!yes) {
      yield* Console.log(`Re-run with --yes to upgrade cluster "${config.name}" (strategy: ${strategy}).`)
      return
    }
    const { mks, serviceName } = yield* MksEnv
    const info = yield* findClusterByName({ mks, config: { serviceName, name: config.name, region: config.auth.region, worker_pools: [] } })
    if (info === undefined) return yield* Effect.fail(new ResourceNotFound({ kind: "kube", ref: config.name }))
    yield* upgradeMks({ mks, ref: { serviceName, kubeId: info.id }, strategy })
    yield* Console.log(`Upgrade requested for cluster "${config.name}" (strategy: ${strategy}).`)
  })

// `--dry-run` just renders the Plan CRs (the SUC plan for a new k3s
// version) without touching the cluster.
const _renderK3s = (
  { config, workerConcurrency }: { readonly config: ClusterConfig; readonly workerConcurrency: number }
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
  config: ClusterConfig
): Effect.Effect<K8sClient["Service"], K3sError, CloudProvider | Ssh | HttpClient.HttpClient> =>
  Effect.gen(function*() {
    const kubeconfig = yield* kubeconfigK3sEffect(config)
    const parsed = yield* parseKubeconfig(kubeconfig.content)
    const client = yield* Effect.provide(HttpClient.HttpClient, k8sHttpClientLayer({ auth: parsed.auth, caPem: parsed.caPem }))
    return makeK8sClient({ client, server: parsed.server })
  })

/** `_k8sClientForUpgradeEffect` wired to its live Layers. */
const _k8sClientForUpgrade = (
  config: ClusterConfig
): Effect.Effect<K8sClient["Service"], K3sError, OpenStackEnv | CinderAuth | HttpClient.HttpClient> =>
  _k8sClientForUpgradeEffect(config).pipe(
    Effect.provide(SshLive),
    Effect.provide(k3sCloudProviderLayer(config))
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
    readonly config: ClusterConfig
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
  { config, workerConcurrency }: { readonly config: ClusterConfig; readonly workerConcurrency: number }
) =>
  Effect.gen(function*() {
    const k8sClient = yield* _k8sClientForUpgrade(config)
    yield* applyK3sUpgradeWith({ config, workerConcurrency, k8sClient })
  })

export const upgrade = Command.make(
  "upgrade",
  { strategy: strategyFlag, workerConcurrency: workerConcurrencyFlag },
  Effect.fn(function*({ strategy, workerConcurrency }) {
    const root = yield* kumulo
    const config = yield* loadConfig(root.config)
    if (config.distro === "ovh-mks") return yield* _upgradeMks({ config, strategy, yes: root.yes })
    if (root.dryRun) return yield* _renderK3s({ config, workerConcurrency })
    yield* _applyK3s({ config, workerConcurrency })
  })
).pipe(Command.withDescription("Upgrade the cluster: applies SUC Plans for k3s, drives the OVH API for ovh-mks"))
