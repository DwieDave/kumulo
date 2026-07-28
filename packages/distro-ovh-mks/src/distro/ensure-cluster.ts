import { Effect } from "effect"
import type { ManagedClusterInfo, MksError } from "@kumulo/core"
import type { Mks } from "../client/mks.ts"
import { clusterDrift, driftConflict } from "./cluster-drift.ts"
import type { MksClusterState } from "./cluster-drift.ts"
import { mapMksError } from "./errors.ts"
import { pollUntil } from "./status.ts"
import { upgrade } from "./upgrade.ts"
import type { MksClusterConfig } from "./types.ts"

interface RawCluster {
  readonly id?: string
  readonly name?: string
  readonly status?: string
  readonly url?: string
  readonly version?: string
  readonly region?: string
  /** `null` is OVH's "no private network"; distinct from a field it never sent. */
  readonly privateNetworkId?: string | null
}

/** `ManagedClusterInfo` plus the cluster-scoped fields drift detection compares (§`cluster-drift.ts`). */
export type MksClusterInfo = ManagedClusterInfo & MksClusterState

const _toInfo = (cluster: RawCluster): MksClusterInfo => ({
  id: cluster.id ?? "",
  apiEndpoint: cluster.url ?? "",
  status: cluster.status ?? "UNKNOWN",
  version: cluster.version,
  region: cluster.region,
  privateNetworkId: cluster.privateNetworkId
})

/** Resolves the cluster by name only — never creates one: a missing cluster is a no-op, not a provisioning trigger. */
export const findClusterByName = (
  { mks, config }: { readonly mks: Mks; readonly config: MksClusterConfig }
): Effect.Effect<MksClusterInfo | undefined, MksError> =>
  Effect.map(_findByName({ mks, config }), (cluster) => cluster && _toInfo(cluster))

const _findByName = (
  { mks, config }: { readonly mks: Mks; readonly config: MksClusterConfig }
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
  { mks, config }: { readonly mks: Mks; readonly config: MksClusterConfig }
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
  { mks, config, kubeId }: { readonly mks: Mks; readonly config: MksClusterConfig; readonly kubeId: string }
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

/**
 * Cluster-level drift, converged before anything is written: a supported
 * version bump becomes OVH's own `NEXT_MINOR` update, and an immutable field
 * (region) fails here — the single point every write routes through, so a
 * refusal costs zero mutations. Never destroys a cluster to converge.
 */
const _convergeCluster = (
  { cluster, mks, config }: { readonly mks: Mks; readonly config: MksClusterConfig; readonly cluster: RawCluster }
): Effect.Effect<void, MksError> => {
  // By here the network reconcile has run, so a configured network means a
  // resolved `privateNetworkId` — the presence flag needs no separate source.
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

/** Create-or-update the MKS control plane, then poll to `READY`. */
export const ensureCluster = (
  { mks, config }: { readonly mks: Mks; readonly config: MksClusterConfig }
): Effect.Effect<MksClusterInfo, MksError> =>
  Effect.gen(function*() {
    const existing = yield* _findByName({ mks, config })
    if (existing !== undefined) yield* _convergeCluster({ cluster: existing, mks, config })
    const cluster = existing ?? (yield* _create({ mks, config }))
    const ready = yield* _awaitReady({ mks, config, kubeId: cluster.id ?? "" })
    return _toInfo(ready)
  })
