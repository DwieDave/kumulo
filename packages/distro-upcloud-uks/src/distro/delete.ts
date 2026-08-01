// Strict delete order: cluster, then network, then router — the router 409s while a network is still attached to it.
import { Effect } from "effect"
import { ignoreMissing, mapUpcloudError } from "@kumulo/upcloud"
import type { MksError } from "@kumulo/core"
import { deleteNetwork } from "./network.ts"
import { pollUntil } from "./status.ts"
import type { UksClients, UksClusterRef } from "./types.ts"

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

export const deleteAll = (
  { clients, ref, clusterName }: { readonly clients: UksClients; readonly ref: UksClusterRef; readonly clusterName: string }
): Effect.Effect<void, MksError> => deleteCluster({ clients, ref }).pipe(Effect.andThen(deleteNetwork({ clients, clusterName })))
