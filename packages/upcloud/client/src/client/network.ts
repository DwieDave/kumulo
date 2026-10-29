// list envelopes here are DOUBLE-nested ({"networks":{"network":[...]}}), unlike the bare UKS endpoints in uks.ts
import { Effect } from "effect"
import * as Schema from "effect/Schema"
import type * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import { decodeOn2xx, decodeVoid, UpcloudLabel } from "./common.ts"
import type { UpcloudRawError } from "./common.ts"

export const UpcloudBool = Schema.Literals(["yes", "no"])

export type UpcloudBool = typeof UpcloudBool.Type

// responses stay loose so a foreign network with an unexpected value never breaks a list
export const IpNetwork = Schema.Struct({
  address: Schema.String,
  dhcp: Schema.String,
  dhcp_default_route: Schema.optionalKey(Schema.String),
  dhcp_dns: Schema.optionalKey(Schema.Array(Schema.String)),
  family: Schema.String,
  gateway: Schema.optionalKey(Schema.String)
})

export type IpNetwork = typeof IpNetwork.Type

export interface IpNetworkInput {
  readonly address: string
  readonly dhcp: UpcloudBool
  readonly dhcp_default_route?: UpcloudBool
  readonly dhcp_dns?: ReadonlyArray<string>
  readonly family: "IPv4" | "IPv6"
  readonly gateway?: string
}

export const Network = Schema.Struct({
  uuid: Schema.String,
  name: Schema.String,
  zone: Schema.String,
  type: Schema.optionalKey(Schema.String),
  router: Schema.optionalKey(Schema.String),
  labels: Schema.optionalKey(Schema.Array(UpcloudLabel)),
  ip_networks: Schema.Struct({ ip_network: Schema.Array(IpNetwork) })
})

export type Network = typeof Network.Type

export const Router = Schema.Struct({
  uuid: Schema.String,
  name: Schema.String,
  type: Schema.optionalKey(Schema.String),
  labels: Schema.optionalKey(Schema.Array(UpcloudLabel)),
  attached_networks: Schema.optionalKey(Schema.Struct({ network: Schema.Array(Schema.Unknown) }))
})

export type Router = typeof Router.Type

const _NetworkResponse = Schema.Struct({ network: Network })
const _NetworksResponse = Schema.Struct({ networks: Schema.Struct({ network: Schema.Array(Network) }) })
const _RouterResponse = Schema.Struct({ router: Router })
const _RoutersResponse = Schema.Struct({ routers: Schema.Struct({ router: Schema.Array(Router) }) })

const _decodeNetwork = decodeOn2xx(_NetworkResponse)
const _decodeNetworks = decodeOn2xx(_NetworksResponse)
const _decodeRouter = decodeOn2xx(_RouterResponse)
const _decodeRouters = decodeOn2xx(_RoutersResponse)

export interface NetworkCreateInput {
  readonly name: string
  readonly zone: string
  readonly ip_networks: { readonly ip_network: ReadonlyArray<IpNetworkInput> }
  readonly router?: string
  readonly labels?: ReadonlyArray<UpcloudLabel>
}

export interface NetworkListFilter {
  readonly zone?: string
  readonly labels?: ReadonlyArray<UpcloudLabel>
}

export interface RouterListFilter {
  readonly labels?: ReadonlyArray<UpcloudLabel>
}

const _listPath = (
  { path, zone, labels }: { readonly path: string; readonly zone?: string | undefined; readonly labels?: ReadonlyArray<UpcloudLabel> | undefined }
): string => {
  const params = new URLSearchParams()

  if (zone !== undefined) params.append("zone", zone)

  for (const label of labels ?? []) params.append("label", `${label.key}=${label.value}`)
  const query = params.toString()

  return query === "" ? path : `${path}?${query}`
}

export interface NetworkClient {
  readonly list: (filter?: NetworkListFilter) => Effect.Effect<ReadonlyArray<Network>, UpcloudRawError>
  readonly get: (uuid: string) => Effect.Effect<Network, UpcloudRawError>
  readonly create: (body: NetworkCreateInput) => Effect.Effect<Network, UpcloudRawError>
  readonly modify: (uuid: string, body: { readonly labels: ReadonlyArray<UpcloudLabel> }) => Effect.Effect<Network, UpcloudRawError>
  readonly delete: (uuid: string) => Effect.Effect<void, UpcloudRawError>
}

export interface RouterClient {
  readonly list: (filter?: RouterListFilter) => Effect.Effect<ReadonlyArray<Router>, UpcloudRawError>
  readonly get: (uuid: string) => Effect.Effect<Router, UpcloudRawError>
  readonly create: (body: { readonly name: string; readonly labels?: ReadonlyArray<UpcloudLabel> }) => Effect.Effect<Router, UpcloudRawError>
  readonly modify: (
    uuid: string,
    body: { readonly name: string; readonly labels: ReadonlyArray<UpcloudLabel> }
  ) => Effect.Effect<Router, UpcloudRawError>
  readonly delete: (uuid: string) => Effect.Effect<void, UpcloudRawError>
}

export const makeNetworkClient = (httpClient: HttpClient.HttpClient): NetworkClient => ({
  list: (filter) =>
    httpClient.execute(HttpClientRequest.get(_listPath({ path: "/1.3/network", zone: filter?.zone, labels: filter?.labels }))).pipe(
      Effect.flatMap(_decodeNetworks),
      Effect.map((r) => r.networks.network)
    ),
  get: (uuid) =>
    httpClient.execute(HttpClientRequest.get(`/1.3/network/${uuid}`)).pipe(Effect.flatMap(_decodeNetwork), Effect.map((r) => r.network)),
  create: (body) =>
    httpClient.execute(HttpClientRequest.post("/1.3/network").pipe(HttpClientRequest.bodyJsonUnsafe({ network: body }))).pipe(
      Effect.flatMap(_decodeNetwork),
      Effect.map((r) => r.network)
    ),
  modify: (uuid, body) =>
    httpClient.execute(HttpClientRequest.put(`/1.3/network/${uuid}`).pipe(HttpClientRequest.bodyJsonUnsafe({ network: body }))).pipe(
      Effect.flatMap(_decodeNetwork),
      Effect.map((r) => r.network)
    ),
  delete: (uuid) => httpClient.execute(HttpClientRequest.delete(`/1.3/network/${uuid}`)).pipe(Effect.flatMap(decodeVoid))
})

export const makeRouterClient = (httpClient: HttpClient.HttpClient): RouterClient => ({
  list: (filter) =>
    httpClient.execute(HttpClientRequest.get(_listPath({ path: "/1.3/router", labels: filter?.labels }))).pipe(
      Effect.flatMap(_decodeRouters),
      Effect.map((r) => r.routers.router)
    ),
  get: (uuid) =>
    httpClient.execute(HttpClientRequest.get(`/1.3/router/${uuid}`)).pipe(Effect.flatMap(_decodeRouter), Effect.map((r) => r.router)),
  create: (body) =>
    httpClient.execute(HttpClientRequest.post("/1.3/router").pipe(HttpClientRequest.bodyJsonUnsafe({ router: body }))).pipe(
      Effect.flatMap(_decodeRouter),
      Effect.map((r) => r.router)
    ),
  modify: (uuid, body) =>
    httpClient.execute(HttpClientRequest.patch(`/1.3/router/${uuid}`).pipe(HttpClientRequest.bodyJsonUnsafe({ router: body }))).pipe(
      Effect.flatMap(_decodeRouter),
      Effect.map((r) => r.router)
    ),
  delete: (uuid) => httpClient.execute(HttpClientRequest.delete(`/1.3/router/${uuid}`)).pipe(Effect.flatMap(decodeVoid))
})
