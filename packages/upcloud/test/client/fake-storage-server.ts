import { Effect } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"

interface FakeLabel {
  readonly key: string
  readonly value: string
}

interface FakeStorage {
  uuid: string
  size: number
  // Live quirk: templates/backups in the account-wide list can carry
  // neither tier nor zone.
  tier?: string
  zone?: string
  title: string
  encrypted?: string
  state: string
  labels?: ReadonlyArray<FakeLabel>
  pollsRemaining: number
}

interface CreateStorageBody {
  readonly storage?: {
    readonly size?: number
    readonly zone?: string
    readonly title?: string
    readonly tier?: string
    readonly labels?: ReadonlyArray<FakeLabel>
    readonly encrypted?: string
  }
}

interface PatchStorageBody {
  readonly storage?: {
    readonly title?: string
    readonly size?: number
    readonly labels?: ReadonlyArray<FakeLabel>
  }
}

const _bodyOf = <Body>(request: HttpClientRequest.HttpClientRequest): Body | undefined => {
  const body = request.body
  if (body._tag !== "Uint8Array") return undefined
  const text = new TextDecoder().decode(body.body)
  if (text.length === 0) return undefined
  const parsed: Body = JSON.parse(text)
  return parsed
}

const _badRequest = (message: string): Response => new Response(JSON.stringify({ message }), { status: 400 })
const _notFound = (message: string): Response => new Response(JSON.stringify({ message }), { status: 404 })
const _ok = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 })
const _empty = (): Response => new Response(null, { status: 200 })

/**
 * Minimal in-memory fixture-replay stand-in for UpCloud's `/1.3/storage` API
 * (N4) — enforces the D3 wrapped envelope on every response and the documented
 * `maintenance -> online` create transition.
 */
export const makeFakeStorageServer = (options: { readonly readyAfterPolls?: number } = {}) => {
  const readyAfterPolls = options.readyAfterPolls ?? 1
  const storages = new Map<string, FakeStorage>()
  let nextId = 1
  // Live quirk (2026-08-01): GET /1.3/storage lists the WHOLE account —
  // public templates and backups appear alongside disks and carry no `tier`.
  // Seeding one forces every list decode to tolerate tier-less entries.
  storages.set("template-0", {
    uuid: "01000000-0000-4000-8000-000030060200",
    size: 4,
    title: "Ubuntu Server 24.04 LTS (Noble Numbat)",
    state: "online",
    pollsRemaining: 0
  })

  const _handleCollection = (request: HttpClientRequest.HttpClientRequest): Response => {
    if (request.method === "GET") return _ok({ storages: { storage: [...storages.values()] } })
    if (request.method === "POST") {
      const payload = _bodyOf<CreateStorageBody>(request)?.storage
      if (payload === undefined) return _badRequest("storage create sent an empty body")
      if (payload.size === undefined || payload.zone === undefined || payload.title === undefined) {
        return _badRequest("storage create is missing a required field")
      }
      const uuid = `storage-${nextId++}`
      const storage: FakeStorage = {
        uuid,
        size: payload.size,
        tier: payload.tier ?? "maxiops",
        zone: payload.zone,
        title: payload.title,
        encrypted: payload.encrypted === undefined ? undefined : payload.encrypted ? "yes" : "no",
        state: "maintenance",
        labels: payload.labels,
        pollsRemaining: readyAfterPolls
      }
      storages.set(uuid, storage)
      return _ok({ storage })
    }
    return _badRequest(`unsupported method ${request.method}`)
  }

  const _handleOne = (request: HttpClientRequest.HttpClientRequest, uuid: string): Response => {
    const storage = storages.get(uuid)
    if (request.method === "GET") {
      if (!storage) return _notFound("storage not found")
      if (storage.pollsRemaining > 0) storage.pollsRemaining -= 1
      else storage.state = "online"
      return _ok({ storage })
    }
    if (request.method === "PUT") {
      if (!storage) return _notFound("storage not found")
      const payload = _bodyOf<PatchStorageBody>(request)?.storage
      if (payload === undefined) return _badRequest("storage modify sent an empty body")
      if (payload.title !== undefined) storage.title = payload.title
      if (payload.size !== undefined) storage.size = payload.size
      if (payload.labels !== undefined) storage.labels = payload.labels
      return _ok({ storage })
    }
    if (request.method === "DELETE") {
      if (!storage) return _notFound("storage not found")
      storages.delete(uuid)
      return _empty()
    }
    return _badRequest(`unsupported method ${request.method}`)
  }

  const _handle = (request: HttpClientRequest.HttpClientRequest): Response => {
    const parts = new URL(request.url, "https://fixture.invalid").pathname.split("/").filter(Boolean)
    // ["1.3", "storage", uuid?]
    if (parts[1] !== "storage") return _badRequest("unhandled fixture route")
    const uuid = parts[2]
    return uuid === undefined ? _handleCollection(request) : _handleOne(request, uuid)
  }

  const httpClient = HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, _handle(request)))).pipe(
    HttpClient.mapRequest(HttpClientRequest.prependUrl("https://fixture.invalid"))
  )

  return { httpClient, storages }
}
