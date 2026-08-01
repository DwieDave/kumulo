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
  tier: string
  zone: string
  title: string
  state: string
  labels?: ReadonlyArray<FakeLabel>
  attached?: boolean
  pollsRemaining: number
}

interface CreateStorageBody {
  readonly storage?: {
    readonly size?: number
    readonly zone?: string
    readonly title?: string
    readonly tier?: string
    readonly labels?: ReadonlyArray<FakeLabel>
  }
}

const _bodyOf = <Body>(request: HttpClientRequest.HttpClientRequest): Body | undefined => {
  const body = request.body
  if (body._tag !== "Uint8Array") return undefined
  const text = new TextDecoder().decode(body.body)
  if (text.length === 0) return undefined
  return JSON.parse(text)
}

const _notFound = (): Response => new Response(JSON.stringify({ message: "not found" }), { status: 404 })
const _conflict = (): Response => new Response(JSON.stringify({ message: "storage is attached to a server" }), { status: 409 })
const _ok = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 })
const _empty = (): Response => new Response(null, { status: 204 })

/**
 * Minimal in-memory `/1.3/storage` fixture (N4) — enforces the D3 wrapped
 * envelope, the `maintenance -> online` create transition, and a 409 on
 * deleting a storage marked `attached` (R6's never-force-detach path).
 */
export const makeFakeStorageServer = (options: { readonly readyAfterPolls?: number } = {}) => {
  const readyAfterPolls = options.readyAfterPolls ?? 1
  const storages = new Map<string, FakeStorage>()
  let nextId = 1

  const _handleCollection = (request: HttpClientRequest.HttpClientRequest): Response => {
    if (request.method === "GET") return _ok({ storages: { storage: [...storages.values()] } })
    if (request.method === "POST") {
      const payload = _bodyOf<CreateStorageBody>(request)?.storage
      if (payload === undefined || payload.size === undefined || payload.zone === undefined || payload.title === undefined) {
        return new Response(JSON.stringify({ message: "missing required field" }), { status: 400 })
      }
      const uuid = `storage-${nextId++}`
      const storage: FakeStorage = {
        uuid,
        size: payload.size,
        tier: payload.tier ?? "maxiops",
        zone: payload.zone,
        title: payload.title,
        state: "maintenance",
        labels: payload.labels,
        pollsRemaining: readyAfterPolls
      }
      storages.set(uuid, storage)
      return _ok({ storage })
    }
    return new Response(null, { status: 400 })
  }

  const _handleOne = (request: HttpClientRequest.HttpClientRequest, uuid: string): Response => {
    const storage = storages.get(uuid)
    if (request.method === "GET") {
      if (!storage) return _notFound()
      if (storage.pollsRemaining > 0) storage.pollsRemaining -= 1
      else storage.state = "online"
      return _ok({ storage })
    }
    if (request.method === "DELETE") {
      if (!storage) return _notFound()
      if (storage.attached) return _conflict()
      storages.delete(uuid)
      return _empty()
    }
    return new Response(null, { status: 400 })
  }

  const _handle = (request: HttpClientRequest.HttpClientRequest): Response => {
    const parts = new URL(request.url, "https://fixture.invalid").pathname.split("/").filter(Boolean)
    if (parts[1] !== "storage") return new Response(null, { status: 400 })
    const uuid = parts[2]
    return uuid === undefined ? _handleCollection(request) : _handleOne(request, uuid)
  }

  const httpClient = HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, _handle(request)))).pipe(
    HttpClient.mapRequest(HttpClientRequest.prependUrl("https://fixture.invalid"))
  )

  /** Marks a storage `attached` so a subsequent `delete` surfaces a 409 (R6). */
  const markAttached = (uuid: string): void => {
    const storage = storages.get(uuid)
    if (storage) storage.attached = true
  }

  return { httpClient, storages, markAttached }
}
