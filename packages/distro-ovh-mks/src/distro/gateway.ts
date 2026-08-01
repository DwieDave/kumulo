import { Effect } from "effect"
import type { MksError } from "@kumulo/core"
import type { Mks } from "../client/mks.ts"
import { mapMksError } from "./errors.ts"

export type GatewayModel = "s" | "m" | "l" | "xl" | "2xl" | "3xl"

export interface EnsureGatewayInput {
  readonly mks: Mks
  readonly serviceName: string
  readonly region: string
  readonly networkId: string
  readonly subnetId: string
  readonly name: string
  readonly model: GatewayModel
}

// deliberately OVH's API, not Neutron's routersPost: that would silently land the gateway on OVH's default tier, ignoring gateway_model
export const ensureGateway = (input: EnsureGatewayInput): Effect.Effect<void, MksError> =>
  mapMksError({
    self: input.mks.postCloudProjectServiceNameRegionRegionNameNetworkNetworkIdSubnetSubnetIdGateway(
      input.serviceName,
      input.region,
      input.networkId,
      input.subnetId,
      { payload: { model: input.model, name: input.name } }
    ),
    ctx: { kind: "gateway", ref: `${input.name} (${input.model})` }
  }).pipe(Effect.asVoid)
