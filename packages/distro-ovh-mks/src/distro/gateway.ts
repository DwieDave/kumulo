import { Effect } from "effect"
import type { MksError } from "@kumulo/core"
import type { Mks } from "../client/mks.ts"
import { mapMksError } from "./errors.ts"

/** OVH's `cloud.network.GatewayModelEnum` — the gateway's bandwidth tier, and what it is billed on. */
export type GatewayModel = "s" | "m" | "l" | "xl" | "2xl" | "3xl"

export interface EnsureGatewayInput {
  readonly mks: Mks
  readonly serviceName: string
  readonly region: string
  readonly networkId: string
  /** The nodes subnet — the gateway attaches to a subnet, not to the network. */
  readonly subnetId: string
  readonly name: string
  readonly model: GatewayModel
}

/**
 * Creates the gateway a private network needs, at the requested tier.
 *
 * Deliberately OVH's API and not Neutron: a gateway *is* a Neutron router, and
 * `routersPost` would make one — but Neutron has no notion of a model, so a
 * router created that way silently lands on OVH's default tier and the config's
 * `gateway_model` would be a lie. The subnet-scoped create is the one that fits
 * kumulo's order, since Neutron has already made the network and both subnets.
 *
 * Idempotency lives with the caller, which checks Neutron for an existing
 * router by name first — the OVH gateway list endpoint cannot be generated (its
 * `externalInformation` carries an `ip`-typed field the converter rejects), and
 * a router lookup answers the same question against the same object.
 */
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
