import { Effect } from "effect"
import type { MksError } from "@kumulo/core"
import type { Mks } from "../client/mks.ts"
import { mapMksError } from "./errors.ts"
import type { ExistingNodePool, NodePoolDiff } from "./nodepool-diff.ts"
import { diffNodePools } from "./nodepool-diff.ts"
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
  monthlyBilled: pool.monthlyBilled ?? false
})

const _createPayload = (pool: MksWorkerPoolConfig) => ({
  name: pool.name,
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

const _applyDiff = (
  { mks, ref, diff }: { readonly mks: Mks; readonly ref: MksClusterRef; readonly diff: NodePoolDiff }
): Effect.Effect<void, MksError> =>
  Effect.gen(function*() {
    yield* Effect.forEach(diff.toDelete, (id) => _delete({ mks, ref, id }), { discard: true })
    yield* Effect.forEach(diff.toReplace, ({ id, pool }) => _delete({ mks, ref, id }).pipe(Effect.andThen(_create({ mks, ref, pool }))), {
      discard: true
    })
    yield* Effect.forEach(diff.toCreate, (pool) => _create({ mks, ref, pool }), { discard: true })
    yield* Effect.forEach(diff.toUpdate, ({ id, pool }) => _update({ mks, ref, id, pool }), { discard: true })
  })

/** FR-6.1 — converges MKS nodepools onto `worker_pools` (create/update/replace/delete, by name). */
export const ensureNodePools = (
  { mks, ref, pools }: { readonly mks: Mks; readonly ref: MksClusterRef; readonly pools: ReadonlyArray<MksWorkerPoolConfig> }
): Effect.Effect<void, MksError> =>
  Effect.gen(function*() {
    const raw = yield* mapMksError({
      self: mks.getCloudProjectServiceNameKubeKubeIdNodepool(ref.serviceName, ref.kubeId, undefined),
      ctx: { kind: "nodepool", ref: ref.kubeId }
    })
    const diff = diffNodePools({ desired: pools, existing: raw.map(_toExisting) })
    yield* _applyDiff({ mks, ref, diff })
  })
