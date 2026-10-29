import { Effect, Option, Predicate, Schema } from "effect"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import { BunnyDnsRecord, BunnyDnsRecordInput, bunnyDnsClient } from "../client/dns.ts"

interface _StoredZone {
  readonly id: number
  readonly domain: string
}

export interface FakeBunnyDnsRequest {
  readonly method: string
  readonly path: string
}

const _decodeInput = Schema.decodeUnknownOption(Schema.fromJsonString(BunnyDnsRecordInput))

const _encodeRecord = Schema.encodeOption(BunnyDnsRecord)

const _json = (status: number, body: string): Response => new Response(body, { status })

const _notFound = (message: string): Response => _json(404, JSON.stringify({ ErrorKey: "not_found", Field: null, Message: message }))

const _badRequest = (message: string): Response => _json(400, JSON.stringify({ ErrorKey: "validation_error", Field: null, Message: message }))

const _textOf = (request: HttpClientRequest.HttpClientRequest): string =>
  Predicate.isTagged(request.body, "Uint8Array") ? new TextDecoder().decode(request.body.body) : ""

const _toRecord = (id: number, input: BunnyDnsRecordInput): BunnyDnsRecord => {
  const record: BunnyDnsRecord = {
    Id: id,
    Type: input.Type,
    Ttl: input.Ttl,
    Name: input.Name,
    Value: input.Value,
    Comment: input.Comment ?? null
  }

  return input.PullZoneId === undefined ? record : { ...record, PullZoneId: input.PullZoneId }
}

const _page = <A>(
  { items, page, perPage }: { readonly items: ReadonlyArray<A>; readonly page: number; readonly perPage: number }
) => ({
  Items: items.slice((page - 1) * perPage, page * perPage),
  CurrentPage: page,
  TotalItems: items.length,
  HasMoreItems: page * perPage < items.length
})

const _intParam = ({ fallback, value }: { readonly value: string | null; readonly fallback: number }): number => {
  const parsed = Number(value)

  return value !== null && Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback
}

export const makeFakeBunnyDns = (options?: { readonly pageSize?: number }) => {
  const zones: Array<_StoredZone> = []
  const records = new Map<number, Array<BunnyDnsRecord>>()
  const requests: Array<FakeBunnyDnsRequest> = []
  let nextId = 1000

  const _nextId = (): number => {
    nextId += 1

    return nextId
  }

  const _zoneOf = (id: number): Option.Option<_StoredZone> => Option.fromNullishOr(zones.find((zone) => zone.id === id))

  const _listZones = (url: URL): Response => {
    const search = (url.searchParams.get("search") ?? "").toLowerCase()
    const matching = zones.filter((zone) => zone.domain.toLowerCase().includes(search))

    return _json(200, JSON.stringify(_page({
      items: matching.map((zone) => ({ Id: zone.id, Domain: zone.domain, Records: (records.get(zone.id) ?? []).flatMap((record) => Option.toArray(_encodeRecord(record))) })),
      page: _intParam({ value: url.searchParams.get("page"), fallback: 1 }),
      perPage: _intParam({ value: url.searchParams.get("perPage"), fallback: 1000 })
    })))
  }

  const _listRecords = (zoneId: number, url: URL): Response =>
    _json(200, JSON.stringify(_page({
      items: (records.get(zoneId) ?? []).flatMap((record) => Option.toArray(_encodeRecord(record))),
      page: _intParam({ value: url.searchParams.get("page"), fallback: 1 }),
      perPage: _intParam({ value: url.searchParams.get("perPage"), fallback: 1000 })
    })))

  const _addRecord = (zoneId: number, request: HttpClientRequest.HttpClientRequest): Response =>
    Option.match(_decodeInput(_textOf(request)), {
      onNone: () => _badRequest("invalid record"),
      onSome: (input) => {
        const record = _toRecord(_nextId(), input)
        records.set(zoneId, [...(records.get(zoneId) ?? []), record])

        return Option.match(_encodeRecord(record), {
          onNone: () => _badRequest("unencodable record"),
          onSome: (wire) => _json(201, JSON.stringify(wire))
        })
      }
    })

  const _updateRecord = (
    { recordId, request, zoneId }: {
      readonly zoneId: number
      readonly recordId: number
      readonly request: HttpClientRequest.HttpClientRequest
    }
  ): Response => {
    const existing = records.get(zoneId) ?? []

    if (!existing.some((record) => record.Id === recordId)) return _notFound("record not found")

    return Option.match(_decodeInput(_textOf(request)), {
      onNone: () => _badRequest("invalid record"),
      onSome: (input) => {
        records.set(zoneId, existing.map((record) => record.Id === recordId ? _toRecord(recordId, input) : record))

        return new Response(null, { status: 204 })
      }
    })
  }

  const _deleteRecord = ({ recordId, zoneId }: { readonly zoneId: number; readonly recordId: number }): Response => {
    const existing = records.get(zoneId) ?? []

    if (!existing.some((record) => record.Id === recordId)) return _notFound("record not found")

    records.set(zoneId, existing.filter((record) => record.Id !== recordId))

    return new Response(null, { status: 204 })
  }

  const _handle = (request: HttpClientRequest.HttpClientRequest): Response => {
    const url = Option.getOrElse(HttpClientRequest.toUrl(request), () => new URL(request.url))
    requests.push({ method: request.method, path: url.pathname })

    if (url.pathname === "/dnszone" && request.method === "GET") return _listZones(url)

    const match = url.pathname.match(/^\/dnszone\/(\d+)\/records(?:\/(\d+))?$/)
    const zoneId = Number(match?.[1])

    if (match === null || Option.isNone(_zoneOf(zoneId))) return _notFound("dns zone not found")

    const recordId = Number(match[2])

    if (match[2] === undefined && request.method === "GET") return _listRecords(zoneId, url)

    if (match[2] === undefined && request.method === "PUT") return _addRecord(zoneId, request)

    if (match[2] !== undefined && request.method === "POST") return _updateRecord({ zoneId, recordId, request })

    if (match[2] !== undefined && request.method === "DELETE") return _deleteRecord({ zoneId, recordId })

    return _notFound("endpoint not found")
  }

  const httpClient = HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, _handle(request)))).pipe(
    HttpClient.mapRequest(HttpClientRequest.prependUrl("https://fixture.invalid"))
  )

  return {
    httpClient,
    dns: bunnyDnsClient({ httpClient, pageSize: options?.pageSize }),
    seedZone: (domain: string): number => {
      const id = _nextId()
      zones.push({ id, domain })
      records.set(id, [])

      return id
    },
    seedRecord: ({ record, zoneId }: { readonly zoneId: number; readonly record: BunnyDnsRecordInput }): BunnyDnsRecord => {
      const stored = _toRecord(_nextId(), record)
      records.set(zoneId, [...(records.get(zoneId) ?? []), stored])

      return stored
    },
    peekRecords: (zoneId: number): ReadonlyArray<BunnyDnsRecord> => records.get(zoneId) ?? [],
    peekRequests: (): ReadonlyArray<FakeBunnyDnsRequest> => [...requests],
    peekWrites: (): ReadonlyArray<FakeBunnyDnsRequest> => requests.filter((entry) => entry.method !== "GET"),
    clearRequests: (): void => {
      requests.length = 0
    }
  }
}
