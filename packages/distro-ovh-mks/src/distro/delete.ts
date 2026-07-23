import type { Effect } from "effect"
import type { MksError } from "@kumulo/core"
import type { Mks } from "../client/mks.ts"
import { mapMksError } from "./errors.ts"
import type { MksClusterRef } from "./types.ts"

/** FR-6.2 — delete the managed cluster via the OVH API (OVH tears down the nodes itself). */
export const deleteCluster = (
  { mks, ref }: { readonly mks: Mks; readonly ref: MksClusterRef }
): Effect.Effect<void, MksError> =>
  mapMksError({
    self: mks.deleteCloudProjectServiceNameKubeKubeId(ref.serviceName, ref.kubeId, undefined),
    ctx: { kind: "kube", ref: ref.kubeId }
  })
