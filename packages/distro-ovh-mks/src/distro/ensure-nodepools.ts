import { Effect } from "effect"
import { CONFIG_HASH_KEY } from "@kumulo/core"
import type { MksError } from "@kumulo/core"
import type { Mks } from "../client/mks.ts"
import { mapMksError } from "./errors.ts"
import type { ExistingNodePool, NodePoolDiff } from "./nodepool-diff.ts"
import { diffNodePools, mksPoolHash } from "./nodepool-diff.ts"
import { pollUntil } from "./status.ts"
import type { MksClusterRef, MksWorkerPoolConfig } from "./types.ts"

interface RawPool {
  readonly id?: string
  readonly name?: string
  readonly flavor?: string
  readonly desiredNodes?: number
  readonly minNodes?: number
  readonly maxNodes?: number
  readonly autoscale?: boolean
  readonly antiAffinity?: boolean
  readonly monthlyBilled?: boolean
  readonly template?: { readonly metadata?: { readonly annotations?: { readonly [key: string]: string } } }
}

const _toExisting = (pool: RawPool): ExistingNodePool => ({
  id: pool.id ?? "",
  name: pool.name ?? "",
  flavor: pool.flavor ?? "",
  desiredNodes: pool.desiredNodes ?? 0,
  minNodes: pool.minNodes ?? 0,
  maxNodes: pool.maxNodes ?? 0,
  autoscale: pool.autoscale ?? false,
  antiAffinity: pool.antiAffinity ?? false,
  monthlyBilled: pool.monthlyBilled ?? false,
  configHash: pool.template?.metadata?.annotations?.[CONFIG_HASH_KEY]
})

// The pool template is OVH's native nodepool metadata mechanism (it lands on
// the nodes as k8s annotations) — the same `CONFIG_HASH_KEY` the hcloud/Nova
// providers stamp their servers with, so drift is read back the same way.
const _template = (pool: MksWorkerPoolConfig) => ({
  metadata: { annotations: { [CONFIG_HASH_KEY]: mksPoolHash(pool) }, finalizers: [], labels: {} },
  spec: { taints: [], unschedulable: false }
})

const _createPayload = (pool: MksWorkerPoolConfig) => ({
  name: pool.name,
  template: _template(pool),
  flavorName: pool.flavor,
  desiredNodes: pool.desiredNodes,
  minNodes: pool.minNodes,
  maxNodes: pool.maxNodes,
  autoscale: pool.autoscale,
  antiAffinity: pool.antiAffinity,
  monthlyBilled: pool.monthlyBilled
})

const _updatePayload = (pool: MksWorkerPoolConfig) => ({
  desiredNodes: pool.desiredNodes,
  minNodes: pool.minNodes,
  maxNodes: pool.maxNodes,
  autoscale: pool.autoscale
})

const _create = (
  { mks, ref, pool }: { readonly mks: Mks; readonly ref: MksClusterRef; readonly pool: MksWorkerPoolConfig }
): Effect.Effect<void, MksError> =>
  mapMksError({
    self: mks.postCloudProjectServiceNameKubeKubeIdNodepool(ref.serviceName, ref.kubeId, { payload: _createPayload(pool) }),
    ctx: { kind: "nodepool", ref: pool.name }
  }).pipe(Effect.asVoid)

const _delete = (
  { mks, ref, id }: { readonly mks: Mks; readonly ref: MksClusterRef; readonly id: string }
): Effect.Effect<void, MksError> =>
  mapMksError({
    self: mks.deleteCloudProjectServiceNameKubeKubeIdNodepoolNodePoolId(ref.serviceName, ref.kubeId, id, undefined),
    ctx: { kind: "nodepool", ref: id }
  })

const _update = (
  { mks, ref, id, pool }: { readonly mks: Mks; readonly ref: MksClusterRef; readonly id: string; readonly pool: MksWorkerPoolConfig }
): Effect.Effect<void, MksError> =>
  mapMksError({
    self: mks.putCloudProjectServiceNameKubeKubeIdNodepoolNodePoolId(ref.serviceName, ref.kubeId, id, { payload: _updatePayload(pool) }),
    ctx: { kind: "nodepool", ref: id }
  })

/**
 * A replace only creates once the old pool is really gone — OVH's DELETE is
 * accepted asynchronously, and creating while the old pool still exists
 * either collides on the name or leaves both alive.
 */
const _awaitGone = (
  { mks, ref, id }: { readonly mks: Mks; readonly ref: MksClusterRef; readonly id: string }
): Effect.Effect<void, MksError> =>
  pollUntil({
    check: Effect.map(listNodePools({ mks, ref }), (pools) => pools.some((pool) => pool.id === id)),
    isDone: (present) => !present,
    interval: "3 seconds",
    timeout: "10 minutes",
    ref: id
  }).pipe(Effect.asVoid)

const _replace = (
  { mks, ref, id, pool }: { readonly mks: Mks; readonly ref: MksClusterRef; readonly id: string; readonly pool: MksWorkerPoolConfig }
): Effect.Effect<void, MksError> =>
  _delete({ mks, ref, id }).pipe(
    Effect.andThen(_awaitGone({ mks, ref, id })),
    Effect.andThen(_create({ mks, ref, pool }))
  )

const _applyDiff = (
  { mks, ref, diff }: { readonly mks: Mks; readonly ref: MksClusterRef; readonly diff: NodePoolDiff }
): Effect.Effect<void, MksError> =>
  Effect.gen(function*() {
    yield* Effect.forEach(diff.toDelete, (id) => _delete({ mks, ref, id }), { discard: true })
    yield* Effect.forEach(diff.toReplace, ({ id, pool }) => _replace({ mks, ref, id, pool }), { discard: true })
    yield* Effect.forEach(diff.toCreate, (pool) => _create({ mks, ref, pool }), { discard: true })
    yield* Effect.forEach(diff.toUpdate, ({ id, pool }) => _update({ mks, ref, id, pool }), { discard: true })
  })

/** Read-only nodepool listing — powers real plan diffs without converging anything. */
export const listNodePools = (
  { mks, ref }: { readonly mks: Mks; readonly ref: MksClusterRef }
): Effect.Effect<ReadonlyArray<ExistingNodePool>, MksError> =>
  Effect.map(
    mapMksError({
      self: mks.getCloudProjectServiceNameKubeKubeIdNodepool(ref.serviceName, ref.kubeId, undefined),
      ctx: { kind: "nodepool", ref: ref.kubeId }
    }),
    (raw) => raw.map(_toExisting)
  )

/** Converges MKS nodepools onto `worker_pools` (create/update/replace/delete, by name); `replace` gates the destructive branch. */
export const ensureNodePools = (
  { mks, ref, pools, replace }: {
    readonly mks: Mks
    readonly ref: MksClusterRef
    readonly pools: ReadonlyArray<MksWorkerPoolConfig>
    readonly replace?: ReadonlySet<string>
  }
): Effect.Effect<void, MksError> =>
  Effect.gen(function*() {
    const existing = yield* listNodePools({ mks, ref })
    yield* _applyDiff({ mks, ref, diff: diffNodePools({ desired: pools, existing, replace }) })
  })
