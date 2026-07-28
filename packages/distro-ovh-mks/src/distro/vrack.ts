import { Effect } from "effect"
import { CapabilityMissing } from "@kumulo/core"
import type { MksError } from "@kumulo/core"
import type { Mks } from "../client/mks.ts"
import { mapMksError } from "./errors.ts"

interface VrackRef {
  readonly serviceName: string
  readonly region: string
}

// kumulo: the vRack is project-scoped, not regional — `region` is carried only
// because `CapabilityMissing` reports one, and the cluster's region is the
// place the operator will look.
const _missing = ({ region, serviceName }: VrackRef): CapabilityMissing =>
  new CapabilityMissing({
    capability: "vrack",
    region,
    workaround: `attach a vRack to project ${serviceName} in the OVH manager — kumulo does not order one`
  })

/**
 * Precondition, not a reconciler. A private network is only reachable from an
 * MKS cluster once the project is attached to a vRack, and kumulo deliberately
 * refuses to order one. Read-only, so a refusal costs zero mutations — call it
 * before anything is created. A missing vRack is OVH's 404, or a 200 whose
 * payload carries no id; every other failure stays itself.
 *
 * Called from `_ensureMksNetwork` (cli), gated on the config's `network` block
 * and ahead of `ensureNetwork`. The gate is not incidental: calling this
 * unconditionally would refuse every MKS apply on a vRack-less project — the
 * exact behaviour R5 says must be preserved when no network is asked for.
 */
export const requireVrack = (
  { mks, region, serviceName }: VrackRef & { readonly mks: Mks }
): Effect.Effect<void, MksError> =>
  mapMksError({
    self: mks.getCloudProjectServiceNameVrack(serviceName, undefined),
    ctx: { kind: "vrack", ref: serviceName }
  }).pipe(
    Effect.catchTag("ResourceNotFound", () => Effect.fail(_missing({ region, serviceName }))),
    Effect.flatMap((vrack) => (vrack.id === undefined || vrack.id === "" ? Effect.fail(_missing({ region, serviceName })) : Effect.void))
  )
