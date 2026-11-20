/** @kumulo/upcloud — package barrel. */
export const packageName = "@kumulo/upcloud"

export { UpcloudHttpLive } from "./transport/http-client.ts"

export { ignoreMissing, mapUpcloudError } from "./errors.ts"

export type { UpcloudError } from "./errors.ts"

export { UpcloudLabel } from "./client/common.ts"

export { makeUksClient, UksCluster } from "./client/uks.ts"

export type { UksClient } from "./client/uks.ts"

export { makeNodeGroupsClient, NodeGroup } from "./client/node-groups.ts"

export type { NodeGroupsClient } from "./client/node-groups.ts"

export { makeNetworkClient, makeRouterClient } from "./client/network.ts"

export type { NetworkClient, RouterClient } from "./client/network.ts"

export { makeZoneClient } from "./client/zone.ts"

export type { ZoneClient } from "./client/zone.ts"

export { makeStorageClient, Storage, StorageTier } from "./client/storage.ts"

export type { StorageClient } from "./client/storage.ts"

export { AccessKey, makeObjectStorageClient, ObjectStorageService } from "./client/object-storage.ts"

export type { ObjectStorageClient } from "./client/object-storage.ts"
