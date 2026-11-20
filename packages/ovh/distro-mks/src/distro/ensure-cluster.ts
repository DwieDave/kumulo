import { Effect } from "effect"
import { pollUntil, ProviderApiError } from "@kumulo/core"
import type { ManagedClusterInfo, ManagedDistroError } from "@kumulo/core"
import type { Mks } from "../client/mks.ts"
import { clusterDrift, driftConflict, MksClusterDrift } from "./cluster-drift.ts"
import type { MksClusterState } from "./cluster-drift.ts"
import { mapMksError } from "../errors.ts"

import { upgrade } from "./upgrade.ts"
import type { MksDriverConfig } from "./types.ts"

interface RawCluster {
  readonly id?: string
  readonly name?: string
  readonly status?: string
  readonly url?: string
  readonly version?: string
  readonly region?: string
  readonly privateNetworkId?: string | null
  readonly nodesSubnetId?: string | null
  readonly loadBalancersSubnetId?: string | null
}

export type MksClusterInfo = ManagedClusterInfo & MksClusterState

const _toInfo = (cluster: RawCluster): MksClusterInfo => ({
  id: cluster.id ?? "",
  apiEndpoint: cluster.url ?? "",
  status: cluster.status ?? "UNKNOWN",
  version: cluster.version,
  region: cluster.region,
  privateNetworkId: cluster.privateNetworkId,
  nodesSubnetId: cluster.nodesSubnetId,
  loadBalancersSubnetId: cluster.loadBalancersSubnetId
})

export const findClusterByName = (
  { mks, config }: { readonly mks: Mks; readonly config: MksDriverConfig }
): Effect.Effect<MksClusterInfo | undefined, ManagedDistroError> =>
  Effect.map(_findByName({ mks, config }), (cluster) => cluster && _toInfo(cluster))

const _findByName = (
  { mks, config }: { readonly mks: Mks; readonly config: MksDriverConfig }
): Effect.Effect<RawCluster | undefined, ManagedDistroError> =>
  Effect.gen(function*() {
    const ctx = { kind: "kube", ref: config.serviceName }
    const ids = yield* mapMksError({ self: mks.getCloudProjectServiceNameKube(config.serviceName, undefined), ctx })

    const clusters = yield* Effect.forEach(
      ids,
      (id) =>
        mapMksError({
          self: mks.getCloudProjectServiceNameKubeKubeId(config.serviceName, id, undefined),
          ctx: { kind: "kube", ref: id }
        }),
      { concurrency: 4 }
    )

    return clusters.find((cluster) => cluster.name === config.name)
  })

const _create = (
  { mks, config }: { readonly mks: Mks; readonly config: MksDriverConfig }
): Effect.Effect<RawCluster, ManagedDistroError> =>
  mapMksError({
    self: mks.postCloudProjectServiceNameKube(config.serviceName, {
      payload: {
        name: config.name,
        region: config.region,
        version: config.version,
        privateNetworkId: config.privateNetworkId,
        nodesSubnetId: config.nodesSubnetId,
        loadBalancersSubnetId: config.loadBalancersSubnetId
      }
    }),
    ctx: { kind: "kube", ref: config.name }
  })

const _awaitReady = (
  { mks, config, kubeId }: { readonly mks: Mks; readonly config: MksDriverConfig; readonly kubeId: string }
): Effect.Effect<RawCluster, ManagedDistroError> =>
  pollUntil({
    check: mapMksError({
      self: mks.getCloudProjectServiceNameKubeKubeId(config.serviceName, kubeId, undefined),
      ctx: { kind: "kube", ref: kubeId }
    }),
    isDone: (cluster) => cluster.status === "READY",
    interval: "3 seconds",
    timeout: "10 minutes",
    kind: "mks-cluster",
    ref: kubeId
  })

// An id-less cluster would poll and upgrade the empty kubeId forever, so it fails here instead.
const _requireId = (cluster: RawCluster): Effect.Effect<string, ManagedDistroError> =>
  cluster.id === undefined || cluster.id === ""
    ? Effect.fail(
      new ProviderApiError({ operation: `kube ${cluster.name ?? ""}`, status: 200, body: "response omitted the cluster id" })
    )
    : Effect.succeed(cluster.id)

// Cluster drift never destroys a cluster to converge; an immutable field (region) fails here before anything is written.
const _convergeCluster = (
  { cluster, kubeId, mks, config }: {
    readonly mks: Mks
    readonly config: MksDriverConfig
    readonly cluster: RawCluster
    readonly kubeId: string
  }
): Effect.Effect<void, ManagedDistroError> => {
  const desired = { ...config, privateNetwork: config.privateNetworkId !== undefined }
  const drift = clusterDrift({ desired, actual: _toInfo(cluster) })

  if (MksClusterDrift.$is("None")(drift)) return Effect.void

  if (MksClusterDrift.$is("Blocked")(drift)) return Effect.fail(driftConflict(drift))

  return upgrade({
    mks,
    ref: { serviceName: config.serviceName, kubeId },
    strategy: "NEXT_MINOR"
  })
}

export const ensureCluster = (
  { mks, config }: { readonly mks: Mks; readonly config: MksDriverConfig }
): Effect.Effect<MksClusterInfo, ManagedDistroError> =>
  Effect.gen(function*() {
    const existing = yield* _findByName({ mks, config })

    const cluster = existing ?? (yield* _create({ mks, config }))
    const kubeId = yield* _requireId(cluster)

    if (existing !== undefined) yield* _convergeCluster({ cluster: existing, kubeId, mks, config })
    const ready = yield* _awaitReady({ mks, config, kubeId })

    return _toInfo(ready)
  })
