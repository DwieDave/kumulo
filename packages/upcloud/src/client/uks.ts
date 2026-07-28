/**
 * Hand-written client (D1) over UpCloud's `/1.3/kubernetes` UKS endpoints
 * (R2). Every response is Schema-decoded (R4) — a shape mismatch surfaces as
 * a `SchemaError` that `mapUpcloudError` turns into `ResponseDecodeError`,
 * never a silent `undefined`.
 *
 * Response shapes here are the observed ones (Q8, closed): everything is bare
 * — a list is a JSON array, a single cluster is a JSON object — and only
 * `kubeconfig` uses a named key. Do NOT model these on `network.ts`: the
 * networking endpoints wrap twice, and assuming UKS did the same is what made
 * every `list()` fail with "Expected object, got []".
 *
 * Node group and cluster `state` share one literal union per the requirements
 * doc; UpCloud's docs do not confirm the cluster enum is identical.
 */
import { Effect } from "effect"
import * as Schema from "effect/Schema"
import type * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import { decodeOn2xx, decodeVoid, UpcloudLabel } from "./common.ts"
import type { UpcloudRawError } from "./common.ts"

export const UksState = Schema.Literals(["pending", "running", "scaling-up", "scaling-down", "terminating", "failed", "unknown"])
export type UksState = typeof UksState.Type

export const UksCluster = Schema.Struct({
  uuid: Schema.String,
  name: Schema.String,
  zone: Schema.String,
  network: Schema.String,
  network_cidr: Schema.String,
  version: Schema.String,
  plan: Schema.String,
  state: UksState,
  control_plane_ip_filter: Schema.optionalKey(Schema.Array(Schema.String)),
  storage_encryption: Schema.optionalKey(Schema.String),
  private_node_groups: Schema.optionalKey(Schema.Boolean),
  labels: Schema.optionalKey(Schema.Array(UpcloudLabel))
})
export type UksCluster = typeof UksCluster.Type

export const UksPlan = Schema.Struct({ name: Schema.String, description: Schema.optionalKey(Schema.String) })
export type UksPlan = typeof UksPlan.Type

// kumulo: UKS returns BARE arrays and objects — no named envelope anywhere
// except `kubeconfig`. This contradicts the rest of UpCloud's 1.3 API (network
// and router wrap, and wrap twice), which is why the first hand-written guess
// modelled it on the wrong sibling and every list call failed with
// "Expected object, got []" against the real API. Confirmed against
// developers.upcloud.com's own response samples (Q8).
const _ClustersResponse = Schema.Array(UksCluster)
const _PlansResponse = Schema.Array(UksPlan)
const _UpgradesResponse = Schema.Struct({ versions: Schema.Array(Schema.String) })
const _KubeconfigResponse = Schema.Struct({ kubeconfig: Schema.String })

const _decodeCluster = decodeOn2xx(UksCluster)
const _decodeClusters = decodeOn2xx(_ClustersResponse)
const _decodePlans = decodeOn2xx(_PlansResponse)
const _decodeUpgrades = decodeOn2xx(_UpgradesResponse)
const _decodeKubeconfig = decodeOn2xx(_KubeconfigResponse)

/** Fields accepted by `POST /1.3/kubernetes` (intent.md's create table). */
export interface UksClusterCreateInput {
  readonly name: string
  readonly zone: string
  /** D7: minor-only (`"1.31"`). Required — a cluster created without it lands on whatever UpCloud defaults to. */
  readonly version: string
  readonly network: string
  readonly network_cidr: string
  readonly plan?: string
  readonly node_groups?: ReadonlyArray<unknown>
  readonly private_node_groups?: boolean
  readonly control_plane_ip_filter?: ReadonlyArray<string>
  readonly labels?: ReadonlyArray<UpcloudLabel>
  readonly storage_encryption?: string
}

/** D8: `PATCH /1.3/kubernetes/{uuid}` accepts only these two fields. */
export interface UksClusterPatchInput {
  readonly control_plane_ip_filter?: ReadonlyArray<string>
  readonly labels?: ReadonlyArray<UpcloudLabel>
}

export interface UksClient {
  readonly list: () => Effect.Effect<ReadonlyArray<UksCluster>, UpcloudRawError>
  readonly get: (uuid: string) => Effect.Effect<UksCluster, UpcloudRawError>
  readonly create: (body: UksClusterCreateInput) => Effect.Effect<UksCluster, UpcloudRawError>
  readonly patch: (uuid: string, body: UksClusterPatchInput) => Effect.Effect<UksCluster, UpcloudRawError>
  readonly delete: (uuid: string) => Effect.Effect<void, UpcloudRawError>
  readonly availableUpgrades: (uuid: string) => Effect.Effect<ReadonlyArray<string>, UpcloudRawError>
  readonly upgrade: (uuid: string, body: { readonly version: string; readonly strategy: string }) => Effect.Effect<void, UpcloudRawError>
  readonly kubeconfig: (uuid: string) => Effect.Effect<string, UpcloudRawError>
  readonly plans: () => Effect.Effect<ReadonlyArray<UksPlan>, UpcloudRawError>
}

const _base = "/1.3/kubernetes"

/** Hand-written client (D1) over `/1.3/kubernetes*`. */
export const makeUksClient = (httpClient: HttpClient.HttpClient): UksClient => ({
  list: () => httpClient.execute(HttpClientRequest.get(_base)).pipe(Effect.flatMap(_decodeClusters)),
  get: (uuid) => httpClient.execute(HttpClientRequest.get(`${_base}/${uuid}`)).pipe(Effect.flatMap(_decodeCluster)),
  create: (body) =>
    httpClient.execute(HttpClientRequest.post(_base).pipe(HttpClientRequest.bodyJsonUnsafe(body))).pipe(Effect.flatMap(_decodeCluster)),
  patch: (uuid, body) =>
    httpClient.execute(HttpClientRequest.patch(`${_base}/${uuid}`).pipe(HttpClientRequest.bodyJsonUnsafe(body))).pipe(
      Effect.flatMap(_decodeCluster)
    ),
  delete: (uuid) => httpClient.execute(HttpClientRequest.delete(`${_base}/${uuid}`)).pipe(Effect.flatMap(decodeVoid)),
  availableUpgrades: (uuid) =>
    httpClient.execute(HttpClientRequest.get(`${_base}/${uuid}/available-upgrades`)).pipe(
      Effect.flatMap(_decodeUpgrades),
      Effect.map((r) => r.versions)
    ),
  upgrade: (uuid, body) =>
    httpClient.execute(HttpClientRequest.post(`${_base}/${uuid}/upgrade`).pipe(HttpClientRequest.bodyJsonUnsafe(body))).pipe(
      Effect.flatMap(decodeVoid)
    ),
  kubeconfig: (uuid) =>
    httpClient.execute(HttpClientRequest.get(`${_base}/${uuid}/kubeconfig`)).pipe(
      Effect.flatMap(_decodeKubeconfig),
      Effect.map((r) => r.kubeconfig)
    ),
  plans: () => httpClient.execute(HttpClientRequest.get(`${_base}/plans`)).pipe(Effect.flatMap(_decodePlans))
})
