/** `fetchKubeconfig` (T5.5, R12): the parsed `kubeconfig` YAML straight out of UpCloud's response — no SSH, no rewrite. */
import { Effect } from "effect"
import { mapUpcloudError } from "@kumulo/upcloud"
import type { Kubeconfig, MksError } from "@kumulo/core"
import type { UksClients } from "./types.ts"

export const fetchKubeconfig = (
  { clients, uuid }: { readonly clients: UksClients; readonly uuid: string }
): Effect.Effect<Kubeconfig, MksError> =>
  mapUpcloudError({ self: clients.uks.kubeconfig(uuid), ctx: { kind: "uks-kubeconfig", ref: uuid } }).pipe(
    Effect.map((content) => ({ content }))
  )
