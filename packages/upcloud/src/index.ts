/** @kumulo/upcloud — package barrel. */
export const packageName = "@kumulo/upcloud"

export {
  transportMaxRetries,
  transportRetrySchedule,
  UPCLOUD_API_BASE_URL,
  UpcloudHttpLive,
  makeUpcloudHttpClient
} from "./transport/http-client.ts"
export type { UpcloudHttpClientOptions } from "./transport/http-client.ts"

export { ignoreMissing, mapUpcloudError, statusError, toUpcloudError } from "./errors/index.ts"
export type { Classified, ErrorContext, UpcloudCause, UpcloudError } from "./errors/index.ts"

export { UpcloudLabel } from "./client/common.ts"
export type { UpcloudRawError } from "./client/common.ts"

export { makeUksClient, UksCluster, UksPlan, UksState } from "./client/uks.ts"
export type { UksClient, UksClusterCreateInput, UksClusterPatchInput } from "./client/uks.ts"

export { makeNodeGroupsClient, NodeGroup, NodeGroupState, NodeGroupStorage, NodeGroupTaint } from "./client/node-groups.ts"
export type { NodeGroupCreateInput, NodeGroupPatchInput, NodeGroupsClient } from "./client/node-groups.ts"

export { IpNetwork, makeNetworkClient, makeRouterClient, Network, Router } from "./client/network.ts"
export type { NetworkClient, NetworkCreateInput, RouterClient } from "./client/network.ts"

export { makeZoneClient, Zone } from "./client/zone.ts"
export type { ZoneClient } from "./client/zone.ts"
