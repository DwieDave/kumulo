import { Effect } from "effect"
import { mapUpcloudError } from "@kumulo/upcloud"
import type { UksCluster } from "@kumulo/upcloud"
import type { ManagedClusterInfo, MksError } from "@kumulo/core"
import { clusterDrift, driftConflict } from "./cluster-drift.ts"
import type { UksClusterState } from "./cluster-drift.ts"
import { ownershipLabels } from "./ownership.ts"
import { pollUntil } from "./status.ts"
import type { UksClients, UksClusterConfig } from "./types.ts"

export type UksClusterInfo = ManagedClusterInfo & UksClusterState & { readonly uuid: string; readonly name: string }

// kumulo: UpCloud's cluster response has no API endpoint field; fetchKubeconfig is the real connection info, so apiEndpoint stays empty here
const _toInfo = (cluster: UksCluster): UksClusterInfo => ({
  id: cluster.uuid,
  uuid: cluster.uuid,
  name: cluster.name,
  apiEndpoint: "",
  status: cluster.state,
  zone: cluster.zone,
  plan: cluster.plan,
  networkCidr: cluster.network_cidr,
  storageEncryption: cluster.storage_encryption !== undefined,
  privateNodeGroups: cluster.private_node_groups
})

export const findClusterByName = (
  { clients, name }: { readonly clients: UksClients; readonly name: string }
): Effect.Effect<UksClusterInfo | undefined, MksError> =>
  mapUpcloudError({ self: clients.uks.list(), ctx: { kind: "uks-cluster", ref: name } }).pipe(
    Effect.map((clusters) => clusters.find((cluster) => cluster.name === name)),
    Effect.map((cluster) => cluster && _toInfo(cluster))
  )

const _storageEncryption = (enabled: boolean | undefined): string | undefined => (enabled ? "data-at-rest" : undefined)

const _create = (
  { clients, config, networkUuid, owner }: {
    readonly clients: UksClients
    readonly config: UksClusterConfig
    readonly networkUuid: string
    readonly owner: string
  }
): Effect.Effect<UksCluster, MksError> =>
  mapUpcloudError({
    self: clients.uks.create({
      name: config.name,
      zone: config.zone,
      version: config.version,
      network: networkUuid,
      network_cidr: config.network.cidr,
      plan: config.plan,
      control_plane_ip_filter: config.control_plane_ip_filter,
      storage_encryption: _storageEncryption(config.storage_encryption),
      labels: ownershipLabels({ spec: config, owner })
    }),
    ctx: { kind: "uks-cluster", ref: config.name }
  })

const _awaitRunning = (
  { clients, uuid }: { readonly clients: UksClients; readonly uuid: string }
): Effect.Effect<UksCluster, MksError> =>
  pollUntil({
    check: mapUpcloudError({ self: clients.uks.get(uuid), ctx: { kind: "uks-cluster", ref: uuid } }),
    isDone: (cluster) => cluster.state === "running",
    interval: "3 seconds",
    timeout: "10 minutes",
    kind: "uks-cluster",
    ref: uuid
  })

const _reconcilePatchable = (
  { clients, cluster, config, owner }: {
    readonly clients: UksClients
    readonly cluster: UksCluster
    readonly config: UksClusterConfig
    readonly owner: string
  }
): Effect.Effect<void, MksError> => {
  const desiredFilter = config.control_plane_ip_filter
  const desiredLabels = ownershipLabels({ spec: config, owner })
  const filterDrift = JSON.stringify(desiredFilter ?? []) !== JSON.stringify(cluster.control_plane_ip_filter ?? [])
  const labelDrift = JSON.stringify(desiredLabels) !== JSON.stringify(cluster.labels ?? [])
  if (!filterDrift && !labelDrift) return Effect.void
  return mapUpcloudError({
    self: clients.uks.patch(cluster.uuid, { control_plane_ip_filter: desiredFilter, labels: desiredLabels }),
    ctx: { kind: "uks-cluster", ref: cluster.uuid }
  }).pipe(Effect.asVoid)
}

// creation-time-only fields never move under a patch; clusterDrift refuses before anything is written
const _refuseCreationDrift = (
  { cluster, config }: { readonly cluster: UksCluster; readonly config: UksClusterConfig }
): Effect.Effect<void, MksError> => {
  const drift = clusterDrift({
    desired: { zone: config.zone, plan: config.plan, networkCidr: config.network.cidr, storageEncryption: config.storage_encryption },
    actual: _toInfo(cluster)
  })
  return drift._tag === "None" ? Effect.void : Effect.fail(driftConflict(drift))
}

export const ensureCluster = (
  { clients, config, networkUuid, owner }: {
    readonly clients: UksClients
    readonly config: UksClusterConfig
    readonly networkUuid: string
    readonly owner: string
  }
): Effect.Effect<UksClusterInfo, MksError> =>
  Effect.gen(function*() {
    const existing = yield* mapUpcloudError({ self: clients.uks.list(), ctx: { kind: "uks-cluster", ref: config.name } }).pipe(
      Effect.map((clusters) => clusters.find((cluster) => cluster.name === config.name))
    )
    if (existing !== undefined) {
      yield* _refuseCreationDrift({ cluster: existing, config })
      yield* _reconcilePatchable({ clients, cluster: existing, config, owner })
    }
    const cluster = existing ?? (yield* _create({ clients, config, networkUuid, owner }))
    const ready = yield* _awaitRunning({ clients, uuid: cluster.uuid })
    return _toInfo(ready)
  })
