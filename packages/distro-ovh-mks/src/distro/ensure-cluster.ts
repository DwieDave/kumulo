import { Effect } from "effect"
import type { ManagedClusterInfo, MksError } from "@kumulo/core"
import type { Mks } from "../client/mks.ts"
import { mapMksError } from "./errors.ts"
import { pollUntil } from "./status.ts"
import type { MksClusterConfig } from "./types.ts"

interface RawCluster {
  readonly id?: string
  readonly name?: string
  readonly status?: string
  readonly url?: string
}

const _toInfo = (cluster: RawCluster): ManagedClusterInfo => ({
  id: cluster.id ?? "",
  apiEndpoint: cluster.url ?? "",
  status: cluster.status ?? "UNKNOWN"
})

/** Resolves the cluster by name only — never creates one: a missing cluster is a no-op, not a provisioning trigger. */
export const findClusterByName = (
  { mks, config }: { readonly mks: Mks; readonly config: MksClusterConfig }
): Effect.Effect<ManagedClusterInfo | undefined, MksError> =>
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
        nodesSubnetId: config.nodesSubnetId
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

/** Create-or-update the MKS control plane, then poll to `READY`. */
export const ensureCluster = (
  { mks, config }: { readonly mks: Mks; readonly config: MksClusterConfig }
): Effect.Effect<ManagedClusterInfo, MksError> =>
  Effect.gen(function*() {
    const existing = yield* _findByName({ mks, config })
    const cluster = existing ?? (yield* _create({ mks, config }))
    const ready = yield* _awaitReady({ mks, config, kubeId: cluster.id ?? "" })
    return _toInfo(ready)
  })
