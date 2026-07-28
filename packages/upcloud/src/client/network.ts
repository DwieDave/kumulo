/**
 * Hand-written client (D1) over `/1.3/network` and `/1.3/router` (R3, D10).
 * kumulo creates and owns the SDN network/router a UKS cluster requires —
 * response envelope (`{"network": {...}}` / `{"networks": [...]}`) mirrors
 * `upcloud-go-api`'s network resource; unconfirmed against a live probe.
 */
import { Effect } from "effect"
import * as Schema from "effect/Schema"
import type * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import { decodeOn2xx, decodeVoid } from "./common.ts"
import type { UpcloudRawError } from "./common.ts"

export const IpNetwork = Schema.Struct({
  address: Schema.String,
  dhcp: Schema.Boolean,
  family: Schema.Literals(["IPv4", "IPv6"]),
  gateway: Schema.optionalKey(Schema.String)
})
export type IpNetwork = typeof IpNetwork.Type

export const Network = Schema.Struct({
  uuid: Schema.String,
  name: Schema.String,
  zone: Schema.String,
  router: Schema.optionalKey(Schema.String),
  ip_networks: Schema.Array(IpNetwork)
})
export type Network = typeof Network.Type

export const Router = Schema.Struct({
  uuid: Schema.String,
  name: Schema.String,
  type: Schema.optionalKey(Schema.String),
  attached_networks: Schema.optionalKey(Schema.Array(Schema.String))
})
export type Router = typeof Router.Type

const _NetworkResponse = Schema.Struct({ network: Network })
const _NetworksResponse = Schema.Struct({ networks: Schema.Array(Network) })
const _RouterResponse = Schema.Struct({ router: Router })
const _RoutersResponse = Schema.Struct({ routers: Schema.Array(Router) })

const _decodeNetwork = decodeOn2xx(_NetworkResponse)
const _decodeNetworks = decodeOn2xx(_NetworksResponse)
const _decodeRouter = decodeOn2xx(_RouterResponse)
const _decodeRouters = decodeOn2xx(_RoutersResponse)

/** `POST /1.3/network` body (intent.md's networking section). */
export interface NetworkCreateInput {
  readonly name: string
  readonly zone: string
  readonly ip_networks: ReadonlyArray<IpNetwork>
  readonly router?: string
}

export interface NetworkClient {
  readonly list: () => Effect.Effect<ReadonlyArray<Network>, UpcloudRawError>
  readonly get: (uuid: string) => Effect.Effect<Network, UpcloudRawError>
  readonly create: (body: NetworkCreateInput) => Effect.Effect<Network, UpcloudRawError>
  readonly delete: (uuid: string) => Effect.Effect<void, UpcloudRawError>
}

export interface RouterClient {
  readonly list: () => Effect.Effect<ReadonlyArray<Router>, UpcloudRawError>
  readonly get: (uuid: string) => Effect.Effect<Router, UpcloudRawError>
  readonly create: (body: { readonly name: string }) => Effect.Effect<Router, UpcloudRawError>
  readonly delete: (uuid: string) => Effect.Effect<void, UpcloudRawError>
}

/** Hand-written client (D1) over `/1.3/network*`. */
export const makeNetworkClient = (httpClient: HttpClient.HttpClient): NetworkClient => ({
  list: () => httpClient.execute(HttpClientRequest.get("/1.3/network")).pipe(Effect.flatMap(_decodeNetworks), Effect.map((r) => r.networks)),
  get: (uuid) =>
    httpClient.execute(HttpClientRequest.get(`/1.3/network/${uuid}`)).pipe(Effect.flatMap(_decodeNetwork), Effect.map((r) => r.network)),
  create: (body) =>
    httpClient.execute(HttpClientRequest.post("/1.3/network").pipe(HttpClientRequest.bodyJsonUnsafe({ network: body }))).pipe(
      Effect.flatMap(_decodeNetwork),
      Effect.map((r) => r.network)
    ),
  delete: (uuid) => httpClient.execute(HttpClientRequest.delete(`/1.3/network/${uuid}`)).pipe(Effect.flatMap(decodeVoid))
})

/** Hand-written client (D1) over `/1.3/router*`. */
export const makeRouterClient = (httpClient: HttpClient.HttpClient): RouterClient => ({
  list: () => httpClient.execute(HttpClientRequest.get("/1.3/router")).pipe(Effect.flatMap(_decodeRouters), Effect.map((r) => r.routers)),
  get: (uuid) =>
    httpClient.execute(HttpClientRequest.get(`/1.3/router/${uuid}`)).pipe(Effect.flatMap(_decodeRouter), Effect.map((r) => r.router)),
  create: (body) =>
    httpClient.execute(HttpClientRequest.post("/1.3/router").pipe(HttpClientRequest.bodyJsonUnsafe({ router: body }))).pipe(
      Effect.flatMap(_decodeRouter),
      Effect.map((r) => r.router)
    ),
  delete: (uuid) => httpClient.execute(HttpClientRequest.delete(`/1.3/router/${uuid}`)).pipe(Effect.flatMap(decodeVoid))
})
