import { Effect } from "effect"
import type { Kubeconfig, MksError } from "@kumulo/core"
import type { Mks } from "../client/mks.ts"
import { mapMksError } from "./errors.ts"
import type { MksClusterRef } from "./types.ts"

/** FR-6.2 — kubeconfig via the OVH API, no SSH. */
export const fetchKubeconfig = (
  { mks, ref }: { readonly mks: Mks; readonly ref: MksClusterRef }
): Effect.Effect<Kubeconfig, MksError> =>
  mapMksError({
    self: mks.postCloudProjectServiceNameKubeKubeIdKubeconfig(ref.serviceName, ref.kubeId, undefined),
    ctx: { kind: "kubeconfig", ref: ref.kubeId }
  }).pipe(Effect.map((result) => ({ content: result.content ?? "" })))
