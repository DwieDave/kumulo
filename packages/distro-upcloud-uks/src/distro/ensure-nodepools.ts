// landmine: DELETE /node-groups/{name} is undocumented whether it drains pods first — assume bare delete
import { Effect } from "effect"
import { CONFIG_HASH_KEY } from "@kumulo/core"
import { mapUpcloudError } from "@kumulo/upcloud"
import type { NodeGroup } from "@kumulo/upcloud"
import type { MksError } from "@kumulo/core"
import type { ExistingNodeGroup, NodeGroupDiff } from "./nodegroup-diff.ts"
import { diffNodePools, KUMULO_POOL_LABEL_KEY, uksPoolHash, uksPoolName } from "./nodegroup-diff.ts"
import { KUMULO_OWNER_LABEL_KEY } from "./ownership.ts"
import { pollUntil } from "./status.ts"
import type { UksClients, UksClusterRef, UksLabel, UksWorkerPoolConfig } from "./types.ts"

const _toExisting = (group: NodeGroup): ExistingNodeGroup => ({
  name: group.name,
  count: group.count,
  poolLabel: group.labels?.find((label) => label.key === KUMULO_POOL_LABEL_KEY)?.value,
  configHash: group.labels?.find((label) => label.key === CONFIG_HASH_KEY)?.value
})

const _labels = ({ pool, owner }: { readonly pool: UksWorkerPoolConfig; readonly owner: string }): ReadonlyArray<UksLabel> => [
  { key: CONFIG_HASH_KEY, value: uksPoolHash(pool) },
  { key: KUMULO_OWNER_LABEL_KEY, value: owner },
  { key: KUMULO_POOL_LABEL_KEY, value: pool.name }
]

const _createPayload = ({ pool, owner }: { readonly pool: UksWorkerPoolConfig; readonly owner: string }) => ({
  name: uksPoolName(pool),
  count: pool.count,
  plan: pool.plan,
  labels: _labels({ pool, owner }),
  taints: pool.taints?.map((taint) => ({ key: taint, value: "", effect: "NoSchedule" })),
  ssh_keys: pool.ssh_keys,
  storage: pool.storage === undefined ? undefined : { tier: pool.storage },
  anti_affinity: pool.anti_affinity,
  utility_network_access: pool.utility_network_access
})

const _create = (
  { clients, ref, pool, owner }: { readonly clients: UksClients; readonly ref: UksClusterRef; readonly pool: UksWorkerPoolConfig; readonly owner: string }
): Effect.Effect<void, MksError> =>
  Effect.gen(function*() {
    yield* mapUpcloudError({
      self: clients.nodeGroups.create(ref.uuid, _createPayload({ pool, owner })),
      ctx: { kind: "uks-node-group", ref: pool.name }
    })
    yield* _awaitRunning({ clients, ref, name: uksPoolName(pool) })
  })

const _delete = (
  { clients, ref, name }: { readonly clients: UksClients; readonly ref: UksClusterRef; readonly name: string }
): Effect.Effect<void, MksError> =>
  mapUpcloudError({ self: clients.nodeGroups.delete(ref.uuid, name), ctx: { kind: "uks-node-group", ref: name } })

const _update = (
  { clients, ref, name, pool }: {
    readonly clients: UksClients
    readonly ref: UksClusterRef
    readonly name: string
    readonly pool: UksWorkerPoolConfig
  }
): Effect.Effect<void, MksError> =>
  mapUpcloudError({
    self: clients.nodeGroups.patch(ref.uuid, name, { count: pool.count }),
    ctx: { kind: "uks-node-group", ref: name }
  }).pipe(Effect.asVoid)

const _awaitRunning = (
  { clients, ref, name }: { readonly clients: UksClients; readonly ref: UksClusterRef; readonly name: string }
): Effect.Effect<void, MksError> =>
  pollUntil({
    check: mapUpcloudError({ self: clients.nodeGroups.get(ref.uuid, name), ctx: { kind: "uks-node-group", ref: name } }),
    isDone: (group) => group.state === "running",
    interval: "3 seconds",
    timeout: "10 minutes",
    kind: "uks-node-group",
    ref: name
  }).pipe(Effect.asVoid)

// order matters: new generation must reach running before the old is deleted — double-billing window during overlap
const _replace = (
  { clients, ref, liveName, pool, owner }: {
    readonly clients: UksClients
    readonly ref: UksClusterRef
    readonly liveName: string
    readonly pool: UksWorkerPoolConfig
    readonly owner: string
  }
): Effect.Effect<void, MksError> => _create({ clients, ref, pool, owner }).pipe(Effect.andThen(_delete({ clients, ref, name: liveName })))

const _applyDiff = (
  { clients, ref, diff, owner }: { readonly clients: UksClients; readonly ref: UksClusterRef; readonly diff: NodeGroupDiff; readonly owner: string }
): Effect.Effect<void, MksError> =>
  Effect.gen(function*() {
    yield* Effect.forEach(diff.toCreate, (pool) => _create({ clients, ref, pool, owner }), { discard: true })
    yield* Effect.forEach(diff.toReplace, ({ liveName, pool }) => _replace({ clients, ref, liveName, pool, owner }), { discard: true })
    yield* Effect.forEach(diff.toUpdate, ({ liveName, pool }) => _update({ clients, ref, name: liveName, pool }), { discard: true })
    yield* Effect.forEach(diff.toDelete, (name) => _delete({ clients, ref, name }), { discard: true })
  })

export const listNodeGroups = (
  { clients, ref }: { readonly clients: UksClients; readonly ref: UksClusterRef }
): Effect.Effect<ReadonlyArray<ExistingNodeGroup>, MksError> =>
  mapUpcloudError({ self: clients.nodeGroups.list(ref.uuid), ctx: { kind: "uks-node-group", ref: ref.uuid } }).pipe(
    Effect.map((groups) => groups.map(_toExisting))
  )

export const ensureNodePools = (
  { clients, ref, pools, owner, replace }: {
    readonly clients: UksClients
    readonly ref: UksClusterRef
    readonly pools: ReadonlyArray<UksWorkerPoolConfig>
    readonly owner: string
    readonly replace?: ReadonlySet<string>
  }
): Effect.Effect<void, MksError> =>
  Effect.gen(function*() {
    const existing = yield* listNodeGroups({ clients, ref })
    yield* _applyDiff({ clients, ref, diff: diffNodePools({ desired: pools, existing, replace }), owner })
  })
