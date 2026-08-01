import { Effect } from "effect"
import type { ManagedClusterInfo, MksError } from "@kumulo/core"
import type { Mks } from "../client/mks.ts"
import { clusterDrift, driftConflict } from "./cluster-drift.ts"
import type { MksClusterState } from "./cluster-drift.ts"
import { mapMksError } from "./errors.ts"
import { pollUntil } from "./status.ts"
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
): Effect.Effect<MksClusterInfo | undefined, MksError> =>
  Effect.map(_findByName({ mks, config }), (cluster) => cluster && _toInfo(cluster))

const _findByName = (
  { mks, config }: { readonly mks: Mks; readonly config: MksDriverConfig }
): Effect.Effect<RawCluster | undefined, MksError> =>
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
): Effect.Effect<RawCluster, MksError> =>
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
): Effect.Effect<RawCluster, MksError> =>
  pollUntil({
    check: mapMksError({
      self: mks.getCloudProjectServiceNameKubeKubeId(config.serviceName, kubeId, undefined),
      ctx: { kind: "kube", ref: kubeId }
    }),
    isDone: (cluster) => cluster.status === "READY",
    interval: "3 seconds",
    timeout: "10 minutes",
    ref: kubeId
  })

// Cluster drift never destroys a cluster to converge; an immutable field (region) fails here before anything is written.
const _convergeCluster = (
  { cluster, mks, config }: { readonly mks: Mks; readonly config: MksDriverConfig; readonly cluster: RawCluster }
): Effect.Effect<void, MksError> => {
  const desired = { ...config, privateNetwork: config.privateNetworkId !== undefined }
  const drift = clusterDrift({ desired, actual: _toInfo(cluster) })
  if (drift._tag === "None") return Effect.void
  if (drift._tag === "Blocked") return Effect.fail(driftConflict(drift))
  return upgrade({
    mks,
    ref: { serviceName: config.serviceName, kubeId: cluster.id ?? "" },
    strategy: "NEXT_MINOR"
  })
}

export const ensureCluster = (
  { mks, config }: { readonly mks: Mks; readonly config: MksDriverConfig }
): Effect.Effect<MksClusterInfo, MksError> =>
  Effect.gen(function*() {
    const existing = yield* _findByName({ mks, config })
    if (existing !== undefined) yield* _convergeCluster({ cluster: existing, mks, config })
    const cluster = existing ?? (yield* _create({ mks, config }))
    const ready = yield* _awaitReady({ mks, config, kubeId: cluster.id ?? "" })
    return _toInfo(ready)
  })
