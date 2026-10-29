import { Effect, Match, Option, Predicate, Schema } from "effect"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import type { BunnyStorageZone } from "../client/storage.ts"

export type FakeBunnyStorageZone = typeof BunnyStorageZone.Encoded

export interface FakeBunnyStorageSeed {
  readonly name: string
  readonly region?: string
  readonly zoneTier?: 0 | 1
  readonly storageZoneType?: 0 | 1
  readonly filesStored?: number
  readonly storageUsed?: number
}

export interface FakeBunnyStorageRequest {
  readonly method: string
  readonly path: string
  readonly search: string
}

export interface FakeBunnyStorage {
  readonly httpClient: HttpClient.HttpClient
  readonly seed: (input: FakeBunnyStorageSeed) => FakeBunnyStorageZone
  readonly peek: () => ReadonlyArray<FakeBunnyStorageZone>
  readonly requests: () => ReadonlyArray<FakeBunnyStorageRequest>
  readonly writes: () => ReadonlyArray<FakeBunnyStorageRequest>
}

export const fakeBunnyStorageRegions = [
  { Code: "DE", Name: "Falkenstein", Continent: "EU", Tier: 0, IsMainRegionSupported: true, IsS3Supported: true, Endpoint: "storage.bunnycdn.com", S3Endpoint: "de-s3.storage.bunnycdn.com" },
  { Code: "NY", Name: "New York", Continent: "NA", Tier: 0, IsMainRegionSupported: true, IsS3Supported: true, Endpoint: "ny.storage.bunnycdn.com", S3Endpoint: "ny-s3.storage.bunnycdn.com" },
  { Code: "LA", Name: "Los Angeles", Continent: "NA", Tier: 0, IsMainRegionSupported: true, IsS3Supported: true, Endpoint: "la.storage.bunnycdn.com", S3Endpoint: "la-s3.storage.bunnycdn.com" },
  { Code: "SG", Name: "Singapore", Continent: "AS", Tier: 0, IsMainRegionSupported: true, IsS3Supported: true, Endpoint: "sg.storage.bunnycdn.com", S3Endpoint: "sg-s3.storage.bunnycdn.com" },
  { Code: "SYD", Name: "Sydney", Continent: "OC", Tier: 0, IsMainRegionSupported: false, IsS3Supported: true, Endpoint: null, S3Endpoint: null }
]

const _mainRegions = fakeBunnyStorageRegions.flatMap((region) => (region.IsMainRegionSupported ? [region.Code] : []))

const _CreateBody = Schema.Struct({
  Name: Schema.String,
  Region: Schema.String,
  ZoneTier: Schema.optional(Schema.Number),
  StorageZoneType: Schema.optional(Schema.Number)
})

const _AvailabilityBody = Schema.Struct({ Name: Schema.String })

const _decodeCreate = Schema.decodeUnknownOption(Schema.fromJsonString(_CreateBody))

const _decodeAvailability = Schema.decodeUnknownOption(Schema.fromJsonString(_AvailabilityBody))

const _json = (status: number, body: Schema.Json): Response => new Response(JSON.stringify(body), { status })

const _empty = (status: number): Response => new Response(null, { status })

const _error = ({ key, message, status }: { readonly status: number; readonly key: string; readonly message: string }): Response =>
  _json(status, { ErrorKey: key, Field: null, Message: message })

const _bodyText = (request: HttpClientRequest.HttpClientRequest): string =>
  Predicate.isTagged(request.body, "Uint8Array") ? new TextDecoder().decode(request.body.body) : ""

const _hostnames = (region: string) => {
  const prefix = region === "DE" ? "" : `${region.toLowerCase()}.`

  return { storage: `${prefix}storage.bunnycdn.com`, s3: `${region.toLowerCase()}-s3.storage.bunnycdn.com` }
}

const _isValidName = (name: string): boolean => /^[a-z0-9-]{4,63}$/.test(name)

const _notFound = (id: string): Response =>
  _error({ status: 404, key: "storagezone.not_found", message: `Storage zone ${id} not found` })

const _idPath = /^\/storagezone\/(\d+)$/

export const makeFakeBunnyStorage = (options?: { readonly apiKey?: string }): FakeBunnyStorage => {
  const zones = new Map<number, FakeBunnyStorageZone>()
  const log: Array<FakeBunnyStorageRequest> = []
  let nextId = 1000

  const insert = (input: FakeBunnyStorageSeed): FakeBunnyStorageZone => {
    const region = input.region ?? "DE"
    const hosts = _hostnames(region)
    const id = nextId

    nextId += 1

    const zone: FakeBunnyStorageZone = {
      Id: id,
      Name: input.name,
      Password: `pw-${id}`,
      ReadOnlyPassword: `ro-${id}`,
      Region: region,
      S3Hostname: hosts.s3,
      StorageHostname: hosts.storage,
      FilesStored: input.filesStored ?? 0,
      StorageUsed: input.storageUsed ?? 0,
      ZoneTier: input.zoneTier ?? 0,
      StorageZoneType: input.storageZoneType ?? 1
    }

    zones.set(id, zone)

    return zone
  }

  const byName = (name: string): Option.Option<FakeBunnyStorageZone> =>
    Option.fromUndefinedOr([...zones.values()].find((zone) => zone.Name === name))

  const list = (params: URLSearchParams): Response => {
    const search = params.get("search")?.toLowerCase()
    const matching = [...zones.values()].filter((zone) => search === undefined || zone.Name.toLowerCase().includes(search))
    const page = Number(params.get("page") ?? "0")
    const perPage = Number(params.get("perPage") ?? "1000")

    if (!(page > 0)) return _json(200, matching)

    const start = (page - 1) * perPage

    return _json(200, {
      Items: matching.slice(start, start + perPage),
      CurrentPage: page,
      TotalItems: matching.length,
      HasMoreItems: start + perPage < matching.length
    })
  }

  const create = (request: HttpClientRequest.HttpClientRequest): Response =>
    Option.match(_decodeCreate(_bodyText(request)), {
      onNone: () => _error({ status: 400, key: "validation_failed", message: "invalid request body" }),
      onSome: (body) => {
        if (!_isValidName(body.Name)) {
          return _error({ status: 400, key: "storagezone.name_invalid", message: "Invalid storage zone name" })
        }

        if (!_mainRegions.includes(body.Region)) {
          return _error({ status: 400, key: "storagezone.region_invalid", message: "Invalid region" })
        }

        if (Option.isSome(byName(body.Name))) {
          return _error({ status: 400, key: "storagezone.name_taken", message: "Storage zone name already taken" })
        }

        return _json(201, insert({
          name: body.Name,
          region: body.Region,
          zoneTier: body.ZoneTier === 1 ? 1 : 0,
          storageZoneType: body.StorageZoneType === 0 ? 0 : 1
        }))
      }
    })

  const check = (request: HttpClientRequest.HttpClientRequest): Response =>
    Option.match(_decodeAvailability(_bodyText(request)), {
      onNone: () => _error({ status: 400, key: "validation_failed", message: "invalid request body" }),
      onSome: (body) => _json(200, { Available: _isValidName(body.Name) && Option.isNone(byName(body.Name)) })
    })

  const route = (request: HttpClientRequest.HttpClientRequest, url: URL): Response => {
    const idMatch = _idPath.exec(url.pathname)
    const id = idMatch?.[1]
    const zone = id === undefined ? undefined : zones.get(Number(id))

    return Match.value(request.method).pipe(
      Match.when("GET", () => {
        if (url.pathname === "/storagezone") return list(url.searchParams)

        if (url.pathname === "/storagezone/regions") return _json(200, fakeBunnyStorageRegions)

        if (id === undefined) return _empty(404)

        return zone === undefined ? _notFound(id) : _json(200, zone)
      }),
      Match.when("POST", () => {
        if (url.pathname === "/storagezone") return create(request)

        return url.pathname === "/storagezone/checkavailability" ? check(request) : _empty(404)
      }),
      Match.when("DELETE", () => {
        if (id === undefined) return _empty(404)

        if (zone === undefined) return _notFound(id)

        zones.delete(zone.Id)

        return _empty(204)
      }),
      Match.orElse(() => _empty(405))
    )
  }

  const httpClient = HttpClient.make((request) =>
    Effect.sync(() => {
      const url = Option.getOrElse(HttpClientRequest.toUrl(request), () => new URL("https://fake.invalid/"))

      log.push({ method: request.method, path: url.pathname, search: url.search })

      const response = options?.apiKey !== undefined && request.headers.accesskey !== options.apiKey
        ? _empty(401)
        : route(request, url)

      return HttpClientResponse.fromWeb(request, response)
    })
  )

  return {
    httpClient,
    seed: insert,
    peek: () => [...zones.values()],
    requests: () => [...log],
    writes: () => log.filter((entry) => entry.method !== "GET" && entry.path !== "/storagezone/checkavailability")
  }
}
