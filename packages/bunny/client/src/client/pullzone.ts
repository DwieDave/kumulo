import { Effect, Schema } from "effect"
import type * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import { HttpTransportError } from "@kumulo/core"
import { BunnyPullZoneOriginType, BunnyPullZoneType } from "../enums.ts"
import { bunnyRequester } from "./request.ts"
import type { BunnyError } from "../errors.ts"

export const BunnyPullZoneHostname = Schema.Struct({
  Id: Schema.optional(Schema.Number),
  Value: Schema.String,
  IsSystemHostname: Schema.Boolean,
  HasCertificate: Schema.Boolean,
  ForceSSL: Schema.Boolean
})

export type BunnyPullZoneHostname = typeof BunnyPullZoneHostname.Type

export const BunnyPullZone = Schema.Struct({
  Id: Schema.Number,
  Name: Schema.String,
  Type: BunnyPullZoneType,
  OriginType: BunnyPullZoneOriginType,
  OriginUrl: Schema.optional(Schema.NullOr(Schema.String)),
  AddHostHeader: Schema.Boolean,
  VerifyOriginSSL: Schema.Boolean,
  EnableWebSockets: Schema.Boolean,
  EnableSmartCache: Schema.Boolean,
  EnableHostnameVary: Schema.Boolean,
  DisableCookies: Schema.Boolean,
  Hostnames: Schema.Array(BunnyPullZoneHostname)
})

export type BunnyPullZone = typeof BunnyPullZone.Type

const _pageSize = 100

const _PullZoneList = Schema.Array(BunnyPullZone)

const _Availability = Schema.Struct({ Available: Schema.Boolean })

export interface BunnyPullZoneSettings {
  readonly type: BunnyPullZoneType
  readonly originUrl: string
  readonly addHostHeader: boolean
  readonly verifyOriginSSL: boolean
  readonly enableWebSockets: boolean
  readonly enableSmartCache: boolean
  readonly enableHostnameVary: boolean
  readonly disableCookies: boolean
}

export interface BunnyPullZoneClient {
  readonly findPullZone: (input: { readonly name: string }) => Effect.Effect<BunnyPullZone | undefined, BunnyError>
  readonly getPullZone: (input: { readonly id: number }) => Effect.Effect<BunnyPullZone, BunnyError>
  readonly createPullZone: (input: { readonly name: string; readonly settings: BunnyPullZoneSettings }) => Effect.Effect<BunnyPullZone, BunnyError>
  readonly updatePullZone: (input: { readonly id: number; readonly settings: BunnyPullZoneSettings }) => Effect.Effect<BunnyPullZone, BunnyError>
  readonly deletePullZone: (input: { readonly id: number }) => Effect.Effect<void, BunnyError>
  readonly addHostname: (input: { readonly id: number; readonly hostname: string }) => Effect.Effect<void, BunnyError>
  readonly removeHostname: (input: { readonly id: number; readonly hostname: string }) => Effect.Effect<void, BunnyError>
  readonly loadFreeCertificate: (input: { readonly hostname: string }) => Effect.Effect<void, BunnyError>
  readonly setForceSSL: (input: { readonly id: number; readonly hostname: string; readonly forceSSL: boolean }) => Effect.Effect<void, BunnyError>
  readonly checkAvailability: (input: { readonly name: string }) => Effect.Effect<boolean, BunnyError>
}

const _settingsFields = {
  Type: BunnyPullZoneType,
  OriginType: BunnyPullZoneOriginType,
  OriginUrl: Schema.String,
  AddHostHeader: Schema.Boolean,
  VerifyOriginSSL: Schema.Boolean,
  EnableWebSockets: Schema.Boolean,
  EnableSmartCache: Schema.Boolean,
  EnableHostnameVary: Schema.Boolean,
  DisableCookies: Schema.Boolean
}

const _UpdateBody = Schema.Struct(_settingsFields)

const _encodeOwned = Schema.encodeEffect(_UpdateBody)

const _MergedBody = Schema.Record(Schema.String, Schema.Json)

const _CreateBody = Schema.Struct({ Name: Schema.String, ..._settingsFields })

const _settingsBody = (settings: BunnyPullZoneSettings): typeof _UpdateBody.Type => ({
    Type: settings.type,
    OriginType: "OriginUrl",
    OriginUrl: settings.originUrl,
    AddHostHeader: settings.addHostHeader,
    VerifyOriginSSL: settings.verifyOriginSSL,
    EnableWebSockets: settings.enableWebSockets,
    EnableSmartCache: settings.enableSmartCache,
    EnableHostnameVary: settings.enableHostnameVary,
    DisableCookies: settings.disableCookies
})

const _kind = "pullzone"

export const makeBunnyPullZoneClient = (httpClient: HttpClient.HttpClient): BunnyPullZoneClient => {
  const requester = bunnyRequester({ httpClient })

  const send = (input: { readonly request: HttpClientRequest.HttpClientRequest; readonly ref: string }) =>
    requester.send({ ...input, kind: _kind })

  const sendDecode = <A, I>(
    input: { readonly request: HttpClientRequest.HttpClientRequest; readonly ref: string; readonly schema: Schema.Codec<A, I> }
  ) => requester.json({ ...input, kind: _kind })

  const sendVoid = (input: { readonly request: HttpClientRequest.HttpClientRequest; readonly ref: string }) =>
    Effect.asVoid(send(input))

  return {
    findPullZone: ({ name }) =>
      Effect.gen(function*() {
        let page = 1

        while (true) {
          const zones = yield* sendDecode({
            ref: name,
            schema: _PullZoneList,
            request: HttpClientRequest.get("/pullzone").pipe(
              HttpClientRequest.setUrlParams({ search: name, page: String(page), perPage: String(_pageSize) })
            )
          })

          const found = zones.find((zone) => zone.Name === name)

          if (found !== undefined || zones.length < _pageSize) return found

          page += 1
        }
      }),
    getPullZone: ({ id }) => sendDecode({ ref: String(id), schema: BunnyPullZone, request: HttpClientRequest.get(`/pullzone/${id}`) }),
    createPullZone: ({ name, settings }) =>
      HttpClientRequest.schemaBodyJson(_CreateBody)(HttpClientRequest.post("/pullzone"), { Name: name, ..._settingsBody(settings) }).pipe(
        Effect.mapError((cause) => new HttpTransportError({ cause })),
        Effect.flatMap((request) => sendDecode({ ref: name, schema: BunnyPullZone, request }))
      ),
    updatePullZone: ({ id, settings }) =>
      sendDecode({ ref: String(id), schema: Schema.Record(Schema.String, Schema.Json), request: HttpClientRequest.get(`/pullzone/${id}`) }).pipe(
        Effect.flatMap((current) =>
          _encodeOwned(_settingsBody(settings)).pipe(
            Effect.flatMap((owned) =>
              HttpClientRequest.schemaBodyJson(_MergedBody)(HttpClientRequest.post(`/pullzone/${id}`), { ...current, ...owned })
            ),
            Effect.mapError((cause) => new HttpTransportError({ cause }))
          )
        ),
        Effect.flatMap((request) => sendDecode({ ref: String(id), schema: BunnyPullZone, request }))
      ),
    deletePullZone: ({ id }) =>
      sendVoid({ ref: String(id), request: HttpClientRequest.delete(`/pullzone/${id}`) }).pipe(
        Effect.catchTag("ResourceNotFound", () => Effect.void)
      ),
    addHostname: ({ id, hostname }) =>
      sendVoid({
        ref: hostname,
        request: HttpClientRequest.post(`/pullzone/${id}/addHostname`).pipe(HttpClientRequest.bodyJsonUnsafe({ Hostname: hostname }))
      }),
    removeHostname: ({ id, hostname }) =>
      sendVoid({
        ref: hostname,
        request: HttpClientRequest.delete(`/pullzone/${id}/removeHostname`).pipe(HttpClientRequest.bodyJsonUnsafe({ Hostname: hostname }))
      }),
    loadFreeCertificate: ({ hostname }) =>
      sendVoid({
        ref: hostname,
        request: HttpClientRequest.get("/pullzone/loadFreeCertificate").pipe(HttpClientRequest.setUrlParams({ hostname }))
      }),
    setForceSSL: ({ forceSSL, hostname, id }) =>
      sendVoid({
        ref: hostname,
        request: HttpClientRequest.post(`/pullzone/${id}/setForceSSL`).pipe(
          HttpClientRequest.bodyJsonUnsafe({ Hostname: hostname, ForceSSL: forceSSL })
        )
      }),
    checkAvailability: ({ name }) =>
      sendDecode({
        ref: name,
        schema: _Availability,
        request: HttpClientRequest.post("/pullzone/checkavailability").pipe(HttpClientRequest.bodyJsonUnsafe({ Name: name }))
      }).pipe(Effect.map((result) => result.Available))
  }
}
