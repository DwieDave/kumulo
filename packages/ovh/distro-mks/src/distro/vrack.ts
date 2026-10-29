import { Effect } from "effect"
import { CapabilityMissing } from "@kumulo/core"
import type { MksError } from "@kumulo/core"
import type { Mks } from "../client/mks.ts"
import { mapMksError } from "./errors.ts"

interface VrackRef {
  readonly serviceName: string
  readonly region: string
}

const _missing = ({ region, serviceName }: VrackRef): CapabilityMissing =>
  new CapabilityMissing({
    capability: "vrack",
    region,
    workaround: `attach a vRack to project ${serviceName} in the OVH manager — kumulo does not order one`
  })

// A missing vRack is OVH's 404, or a 200 whose payload carries no id; every other failure stays itself.
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
