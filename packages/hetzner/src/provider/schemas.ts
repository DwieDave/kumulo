import * as Schema from "effect/Schema"

// kumulo: every schema here is intentionally partial — hcloud responses carry
// many fields beyond what any one caller consumes, and `Schema.Struct` only
// validates the keys it declares.

export const HcloudNamedResource = Schema.Struct({
  id: Schema.Number,
  name: Schema.String
})
export type HcloudNamedResource = typeof HcloudNamedResource.Type

const _publicIpv4 = Schema.Union([Schema.Struct({ ip: Schema.String }), Schema.Null])

export const HcloudServerRecord = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  status: Schema.String,
  public_net: Schema.Struct({ ipv4: _publicIpv4 })
})
export type HcloudServerRecord = typeof HcloudServerRecord.Type

export const HcloudLoadBalancerRecord = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  public_net: Schema.Struct({ ipv4: Schema.Struct({ ip: Schema.Union([Schema.String, Schema.Null]) }) })
})
export type HcloudLoadBalancerRecord = typeof HcloudLoadBalancerRecord.Type

export const serverIp = (server: HcloudServerRecord): string => server.public_net.ipv4?.ip ?? ""

export const HcloudVolumeRecord = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  size: Schema.Number
})
export type HcloudVolumeRecord = typeof HcloudVolumeRecord.Type
