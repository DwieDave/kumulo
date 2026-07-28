/**
 * `deleteCluster`/`deleteAll` (T5.5, R11, R13, AC3): cluster, then router,
 * then network, in that strict order.
 *
 * kumulo: does deleting a cluster release its network automatically, or does
 * the network delete fail while the cluster is still terminating?
 * Undocumented (plan.md Q10, needs a live probe). This polls the cluster to
 * fully gone before touching the network/router, the conservative reading
 * that avoids racing UpCloud's own teardown — if a live probe shows the
 * network detaches immediately on cluster delete, the poll below is
 * unnecessary but harmless.
 */
import { Effect } from "effect"
import { ignoreMissing, mapUpcloudError } from "@kumulo/upcloud"
import type { MksError } from "@kumulo/core"
import { deleteNetwork } from "./network.ts"
import { pollUntil } from "./status.ts"
import type { UksClients, UksClusterRef } from "./types.ts"

/** Deletes the UKS cluster and waits for it to be gone (feeds `deleteAll`'s network-teardown ordering). */
export const deleteCluster = (
  { clients, ref }: { readonly clients: UksClients; readonly ref: UksClusterRef }
): Effect.Effect<void, MksError> =>
  ignoreMissing(mapUpcloudError({ self: clients.uks.delete(ref.uuid), ctx: { kind: "uks-cluster", ref: ref.uuid } })).pipe(
    Effect.andThen(
      pollUntil({
        check: mapUpcloudError({ self: clients.uks.list(), ctx: { kind: "uks-cluster", ref: ref.uuid } }).pipe(
          Effect.map((clusters) => clusters.some((cluster) => cluster.uuid === ref.uuid))
        ),
        isDone: (present) => !present,
        interval: "3 seconds",
        timeout: "10 minutes",
        kind: "uks-cluster",
        ref: ref.uuid
      }).pipe(Effect.asVoid)
    )
  )

/** Full teardown in AC3's order: cluster (polled gone), then router, then network. */
export const deleteAll = (
  { clients, ref, clusterName }: { readonly clients: UksClients; readonly ref: UksClusterRef; readonly clusterName: string }
): Effect.Effect<void, MksError> => deleteCluster({ clients, ref }).pipe(Effect.andThen(deleteNetwork({ clients, clusterName })))
