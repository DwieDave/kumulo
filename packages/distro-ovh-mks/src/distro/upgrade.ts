import type { Effect } from "effect"
import type { MksError } from "@kumulo/core"
import type { Mks } from "../client/mks.ts"
import { mapMksError } from "./errors.ts"
import type { MksClusterRef, MksUpgradeStrategy } from "./types.ts"

/**
 * OVH-driven upgrade: `POST .../update` forces the cluster (and
 * its nodes) onto the latest patch, or the next minor, of its current
 * version track. There's no arbitrary target-version field on this
 * endpoint (OVH doesn't support skipping versions), so `strategy` is the
 * whole knob.
 */
export const upgrade = (
  { mks, ref, strategy, force = false }: {
    readonly mks: Mks
    readonly ref: MksClusterRef
    readonly strategy: MksUpgradeStrategy
    readonly force?: boolean
  }
): Effect.Effect<void, MksError> =>
  mapMksError({
    self: mks.postCloudProjectServiceNameKubeKubeIdUpdate(ref.serviceName, ref.kubeId, { payload: { strategy, force } }),
    ctx: { kind: "upgrade", ref: ref.kubeId }
  })
