/**
 * Hand-written client (D1) over `/1.3/kubernetes/{uuid}/node-groups*` (R2).
 * D8: `PATCH` accepts only `count` — every other creation-time field is
 * immutable and drift on it is `distro-upcloud-uks`'s job, not this
 * client's.
 */
import { Effect } from "effect"
import * as Schema from "effect/Schema"
import type * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import { decodeOn2xx, decodeVoid, UpcloudLabel } from "./common.ts"
import type { UpcloudRawError } from "./common.ts"

export const NodeGroupState = Schema.Literals([
  "pending",
  "running",
  "scaling-up",
  "scaling-down",
  "terminating",
  "failed",
  "unknown"
])
export type NodeGroupState = typeof NodeGroupState.Type

export const NodeGroupTaint = Schema.Struct({ key: Schema.String, value: Schema.String, effect: Schema.String })
export type NodeGroupTaint = typeof NodeGroupTaint.Type

export const NodeGroupStorage = Schema.Struct({ tier: Schema.optionalKey(Schema.String), size: Schema.optionalKey(Schema.Number) })
export type NodeGroupStorage = typeof NodeGroupStorage.Type

export const NodeGroup = Schema.Struct({
  name: Schema.String,
  count: Schema.Number,
  plan: Schema.String,
  state: NodeGroupState,
  labels: Schema.optionalKey(Schema.Array(UpcloudLabel)),
  taints: Schema.optionalKey(Schema.Array(NodeGroupTaint)),
  kubelet_args: Schema.optionalKey(Schema.Array(Schema.String)),
  ssh_keys: Schema.optionalKey(Schema.Array(Schema.String)),
  storage: Schema.optionalKey(NodeGroupStorage),
  anti_affinity: Schema.optionalKey(Schema.Boolean),
  utility_network_access: Schema.optionalKey(Schema.Boolean),
  storage_encryption: Schema.optionalKey(Schema.String)
})
export type NodeGroup = typeof NodeGroup.Type

const _NodeGroupsResponse = Schema.Struct({ node_groups: Schema.Array(NodeGroup) })
const _decodeNodeGroup = decodeOn2xx(NodeGroup)
const _decodeNodeGroups = decodeOn2xx(_NodeGroupsResponse)

/** Fields accepted by `POST .../node-groups` (intent.md's create table). */
export interface NodeGroupCreateInput {
  readonly name: string
  readonly count: number
  readonly plan: string
  readonly labels?: ReadonlyArray<UpcloudLabel>
  readonly taints?: ReadonlyArray<NodeGroupTaint>
  readonly kubelet_args?: ReadonlyArray<string>
  readonly ssh_keys?: ReadonlyArray<string>
  readonly storage?: NodeGroupStorage
  readonly anti_affinity?: boolean
  readonly utility_network_access?: boolean
  readonly storage_encryption?: string
}

/** D8: the only mutable field. */
export interface NodeGroupPatchInput {
  readonly count: number
}

export interface NodeGroupsClient {
  readonly list: (clusterUuid: string) => Effect.Effect<ReadonlyArray<NodeGroup>, UpcloudRawError>
  readonly get: (clusterUuid: string, name: string) => Effect.Effect<NodeGroup, UpcloudRawError>
  readonly create: (clusterUuid: string, body: NodeGroupCreateInput) => Effect.Effect<NodeGroup, UpcloudRawError>
  readonly patch: (clusterUuid: string, name: string, body: NodeGroupPatchInput) => Effect.Effect<NodeGroup, UpcloudRawError>
  readonly delete: (clusterUuid: string, name: string) => Effect.Effect<void, UpcloudRawError>
  readonly deleteNode: (clusterUuid: string, name: string, nodeName: string) => Effect.Effect<void, UpcloudRawError>
}

const _base = (clusterUuid: string): string => `/1.3/kubernetes/${clusterUuid}/node-groups`
const _one = (clusterUuid: string, name: string): string => `${_base(clusterUuid)}/${name}`

/** Hand-written client (D1) over `/1.3/kubernetes/{uuid}/node-groups*`. */
export const makeNodeGroupsClient = (httpClient: HttpClient.HttpClient): NodeGroupsClient => ({
  list: (clusterUuid) =>
    httpClient.execute(HttpClientRequest.get(_base(clusterUuid))).pipe(
      Effect.flatMap(_decodeNodeGroups),
      Effect.map((r) => r.node_groups)
    ),
  get: (clusterUuid, name) => httpClient.execute(HttpClientRequest.get(_one(clusterUuid, name))).pipe(Effect.flatMap(_decodeNodeGroup)),
  create: (clusterUuid, body) =>
    httpClient.execute(HttpClientRequest.post(_base(clusterUuid)).pipe(HttpClientRequest.bodyJsonUnsafe(body))).pipe(
      Effect.flatMap(_decodeNodeGroup)
    ),
  patch: (clusterUuid, name, body) =>
    httpClient.execute(HttpClientRequest.patch(_one(clusterUuid, name)).pipe(HttpClientRequest.bodyJsonUnsafe(body))).pipe(
      Effect.flatMap(_decodeNodeGroup)
    ),
  delete: (clusterUuid, name) => httpClient.execute(HttpClientRequest.delete(_one(clusterUuid, name))).pipe(Effect.flatMap(decodeVoid)),
  // kumulo: does DELETE drain the node first? plan.md Q7 is unanswered
  // without a live probe — `distro-upcloud-uks` must not assume it does.
  deleteNode: (clusterUuid, name, nodeName) =>
    httpClient.execute(HttpClientRequest.delete(`${_one(clusterUuid, name)}/${nodeName}`)).pipe(Effect.flatMap(decodeVoid))
})
