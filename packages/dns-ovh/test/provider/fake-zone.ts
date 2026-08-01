import { Effect, Option } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { makeDnsClient } from "../../src/client/dns.ts"

interface StoredRecord {
  readonly id: number
  readonly fieldType: string
  readonly subDomain: string
  readonly target: string
}

const _fixtureBaseUrl = "https://fixture.invalid"

const _bodyOf = (request: HttpClientRequest.HttpClientRequest): { fieldType?: string; subDomain?: string; target?: string } => {
  const body = request.body
  return body._tag === "Uint8Array" ? JSON.parse(new TextDecoder().decode(body.body)) : {}
}

export const makeFakeZone = (zoneName: string) => {
  let nextId = 1
  const records = new Map<number, StoredRecord>()
  let refreshCount = 0

  const recordPath = `/domain/zone/${zoneName}/record`

  const _handle = (request: HttpClientRequest.HttpClientRequest): Response => {
    // request.url is only the bare path; toUrl merges in urlParams
    const url = Option.getOrElse(HttpClientRequest.toUrl(request), () => new URL(request.url))
    if (request.method === "GET" && url.pathname === recordPath) {
      const subDomain = url.searchParams.get("subDomain")
      const ids = [...records.values()]
        .filter((r) => subDomain === null || r.subDomain === subDomain)
        .map((r) => r.id)
      return new Response(JSON.stringify(ids), { status: 200 })
    }
    if (request.method === "POST" && url.pathname === recordPath) {
      const body = _bodyOf(request)
      const id = nextId++
      records.set(id, { id, fieldType: body.fieldType ?? "", subDomain: body.subDomain ?? "", target: body.target ?? "" })
      return new Response(JSON.stringify({ id, zone: zoneName, ...body }), { status: 200 })
    }
    if (request.method === "POST" && url.pathname === `/domain/zone/${zoneName}/refresh`) {
      refreshCount++
      return new Response(null, { status: 200 })
    }
    const recordIdMatch = url.pathname.match(new RegExp(`^${recordPath}/(\\d+)$`))
    if (recordIdMatch) return _handleById(request, Number(recordIdMatch[1]))
    return new Response(JSON.stringify({ message: "not found" }), { status: 404 })
  }

  const _handleById = (request: HttpClientRequest.HttpClientRequest, id: number): Response => {
    const existing = records.get(id)
    if (request.method === "GET") {
      return existing ? new Response(JSON.stringify({ zone: zoneName, ...existing }), { status: 200 }) : new Response(null, { status: 404 })
    }
    if (request.method === "PUT" && existing) {
      records.set(id, { ...existing, ...(_bodyOf(request)) })
      return new Response(null, { status: 200 })
    }
    if (request.method === "DELETE" && existing) {
      records.delete(id)
      return new Response(null, { status: 200 })
    }
    return new Response(null, { status: 404 })
  }

  const httpClient = HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, _handle(request)))).pipe(
    HttpClient.mapRequest(HttpClientRequest.prependUrl(_fixtureBaseUrl))
  )

  return {
    dns: makeDnsClient(httpClient),
    peek: (subDomain: string): StoredRecord | undefined =>
      [...records.values()].find((r) => r.subDomain === subDomain && r.fieldType !== "TXT"),
    peekAll: (): ReadonlyArray<StoredRecord> => [...records.values()],
    seed: (record: { fieldType: string; subDomain: string; target: string }): void => {
      const id = nextId++
      records.set(id, { id, ...record })
    },
    refreshCount: (): number => refreshCount
  }
}
