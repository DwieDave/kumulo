import { Effect } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"

interface FakeLabel {
  readonly key: string
  readonly value: string
}

const _stateLadder = ["setup-network", "setup-service", "setup-dns", "setup-checkup", "running"]

interface FakeService {
  uuid: string
  name: string
  region: string
  configured_status: string
  operational_state: string
  pollsUntilGone?: number
  labels?: ReadonlyArray<FakeLabel>
  networks?: ReadonlyArray<{ readonly name: string; readonly type: string; readonly family: string; readonly uuid?: string }>
  endpoints?: ReadonlyArray<{ readonly domain_name: string; readonly type: string }>
  ladderIndex: number
}

interface FakeBucket {
  name: string
  total_objects: number
  total_size_bytes: number
  deleted: boolean
  // async delete: kept for one poll with deleted:true before disappearing
  pollsUntilGone: number
}

interface FakeAccessKey {
  access_key_id: string
  status: string
  secret_access_key: string
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
const _conflict = (message: string): Response => new Response(JSON.stringify({ message }), { status: 409 })
const _ok = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 })
const _empty = (): Response => new Response(null, { status: 200 })

/**
 * Minimal in-memory fixture-replay stand-in for UpCloud's `/object-storage-2`
 * API (N4). Enforces D3's bare shapes, the `setup-* -> running` operational
 * ladder, once-only access-key secrets, async bucket delete, and the
 * service-delete-409-unless-empty-or-force rule.
 */
export const makeFakeObjectStorageServer = () => {
  const services = new Map<string, FakeService>()
  const buckets = new Map<string, Map<string, FakeBucket>>()
  const users = new Map<string, Set<string>>()
  const accessKeys = new Map<string, Map<string, FakeAccessKey>>()
  let nextId = 1

  const _keyOf = (serviceUuid: string, username: string) => `${serviceUuid}/${username}`

  const _handleServices = (request: HttpClientRequest.HttpClientRequest): Response => {
    if (request.method === "GET") return _ok([...services.values()])
    if (request.method === "POST") {
      const payload = _bodyOf<
        { readonly name?: string; readonly region?: string; readonly configured_status?: string; readonly networks?: ReadonlyArray<{ readonly name: string; readonly type: string; readonly family: string; readonly uuid?: string }> }
      >(request)
      if (payload === undefined) return _badRequest("service create sent an empty body")
      if (payload.name === undefined || payload.region === undefined) return _badRequest("service create is missing a required field")
      const uuid = `objsto-${nextId++}`
      services.set(uuid, {
        uuid,
        name: payload.name,
        region: payload.region,
        configured_status: payload.configured_status ?? "started",
        operational_state: "setup-network",
        ladderIndex: 0,
        networks: payload.networks,
        endpoints: []
      })
      buckets.set(uuid, new Map())
      users.set(uuid, new Set())
      accessKeys.set(uuid, new Map())
      return _ok(services.get(uuid))
    }
    return _badRequest(`unsupported method ${request.method}`)
  }

  const _handleServiceOne = (request: HttpClientRequest.HttpClientRequest, uuid: string, force: boolean): Response => {
    const service = services.get(uuid)
    if (request.method === "GET") {
      if (!service) return _notFound("service not found")
      if (service.pollsUntilGone !== undefined) {
        if (service.pollsUntilGone <= 0) {
          services.delete(uuid)
          buckets.delete(uuid)
          users.delete(uuid)
          return _notFound("service not found")
        }
        service.pollsUntilGone -= 1
      }
      if (service.ladderIndex < _stateLadder.length - 1) service.ladderIndex += 1
      service.operational_state = _stateLadder[service.ladderIndex] ?? "running"
      if (service.operational_state === "running") {
        service.endpoints = [{ domain_name: `${service.name}.upcloudobjects.com`, type: "public" }]
      }
      return _ok(service)
    }
    if (request.method === "PATCH") {
      if (!service) return _notFound("service not found")
      const payload = _bodyOf<{ readonly configured_status?: string; readonly labels?: ReadonlyArray<FakeLabel> }>(request)
      if (payload === undefined) return _badRequest("service patch sent an empty body")
      if (payload.configured_status !== undefined) service.configured_status = payload.configured_status
      if (payload.labels !== undefined) service.labels = payload.labels
      return _ok(service)
    }
    if (request.method === "DELETE") {
      if (!service) return _notFound("service not found")
      const nonDeletedBuckets = [...(buckets.get(uuid)?.values() ?? [])].filter((bucket) => !bucket.deleted)
      if (nonDeletedBuckets.length > 0 && !force) return _conflict("service has buckets: pass ?force=true")
      // Live quirk (2026-08-01): deletion is async — the service lingers in a
      // delete-* operational_state and still holds its private network
      // attachment, so callers must poll GET to 404 before touching the
      // network. One extra GET returns the deleting service, then it is gone.
      service.operational_state = "delete-service"
      service.pollsUntilGone = 1
      return _empty()
    }
    return _badRequest(`unsupported method ${request.method}`)
  }

  const _handleBuckets = (request: HttpClientRequest.HttpClientRequest, serviceUuid: string): Response => {
    const serviceBuckets = buckets.get(serviceUuid)
    if (!serviceBuckets) return _notFound("service not found")
    if (request.method === "GET") {
      // one poll of aging: async-deleting buckets vanish after their grace poll
      for (const [name, bucket] of serviceBuckets) {
        if (bucket.deleted) {
          if (bucket.pollsUntilGone <= 0) serviceBuckets.delete(name)
          else bucket.pollsUntilGone -= 1
        }
      }
      return _ok([...serviceBuckets.values()])
    }
    if (request.method === "POST") {
      const payload = _bodyOf<{ readonly name?: string }>(request)
      if (payload?.name === undefined) return _badRequest("bucket create is missing name")
      serviceBuckets.set(payload.name, {
        name: payload.name,
        total_objects: 0,
        total_size_bytes: 0,
        deleted: false,
        pollsUntilGone: 0
      })
      return _empty()
    }
    return _badRequest(`unsupported method ${request.method}`)
  }

  const _handleBucketOne = (request: HttpClientRequest.HttpClientRequest, serviceUuid: string, name: string): Response => {
    const serviceBuckets = buckets.get(serviceUuid)
    if (!serviceBuckets) return _notFound("service not found")
    if (request.method === "DELETE") {
      const bucket = serviceBuckets.get(name)
      if (!bucket) return _notFound("bucket not found")
      // R11/N4: async delete — one more poll shows deleted:true before it's gone.
      bucket.deleted = true
      bucket.pollsUntilGone = 1
      return _empty()
    }
    return _badRequest(`unsupported method ${request.method}`)
  }

  const _handleUsers = (request: HttpClientRequest.HttpClientRequest, serviceUuid: string): Response => {
    const serviceUsers = users.get(serviceUuid)
    if (!serviceUsers) return _notFound("service not found")
    if (request.method === "POST") {
      const payload = _bodyOf<{ readonly username?: string }>(request)
      if (payload?.username === undefined) return _badRequest("user create is missing username")
      serviceUsers.add(payload.username)
      accessKeys.set(_keyOf(serviceUuid, payload.username), new Map())
      return _ok({ username: payload.username })
    }
    return _badRequest(`unsupported method ${request.method}`)
  }

  const _handleUserOne = (request: HttpClientRequest.HttpClientRequest, serviceUuid: string, username: string): Response => {
    const serviceUsers = users.get(serviceUuid)
    if (!serviceUsers) return _notFound("service not found")
    if (request.method === "GET") {
      if (!serviceUsers.has(username)) return _notFound("user not found")
      return _ok({ username })
    }
    if (request.method === "DELETE") {
      if (!serviceUsers.has(username)) return _notFound("user not found")
      serviceUsers.delete(username)
      accessKeys.delete(_keyOf(serviceUuid, username))
      return _empty()
    }
    return _badRequest(`unsupported method ${request.method}`)
  }

  const _handleAccessKeys = (request: HttpClientRequest.HttpClientRequest, serviceUuid: string, username: string): Response => {
    const keys = accessKeys.get(_keyOf(serviceUuid, username))
    if (!keys) return _notFound("user not found")
    if (request.method === "GET") {
      // D7: list/get omit the secret entirely — only the create response ever carries it.
      return _ok([...keys.values()].map(({ secret_access_key: _secret, ...rest }) => rest))
    }
    if (request.method === "POST") {
      const key: FakeAccessKey = {
        access_key_id: `AK${nextId++}`,
        status: "Active",
        secret_access_key: `secret-${Math.random().toString(36).slice(2)}`
      }
      keys.set(key.access_key_id, key)
      return _ok(key)
    }
    return _badRequest(`unsupported method ${request.method}`)
  }

  const _handleAccessKeyOne = (
    request: HttpClientRequest.HttpClientRequest,
    serviceUuid: string,
    username: string,
    accessKeyId: string
  ): Response => {
    const keys = accessKeys.get(_keyOf(serviceUuid, username))
    if (!keys) return _notFound("user not found")
    const key = keys.get(accessKeyId)
    if (request.method === "PATCH") {
      if (!key) return _notFound("access key not found")
      const payload = _bodyOf<{ readonly status?: string }>(request)
      if (payload?.status !== undefined) key.status = payload.status
      const { secret_access_key: _secret, ...rest } = key
      return _ok(rest)
    }
    if (request.method === "DELETE") {
      if (!key) return _notFound("access key not found")
      keys.delete(accessKeyId)
      return _empty()
    }
    return _badRequest(`unsupported method ${request.method}`)
  }

  const _handle = (request: HttpClientRequest.HttpClientRequest): Response => {
    const url = new URL(request.url, "https://fixture.invalid")
    const parts = url.pathname.split("/").filter(Boolean)
    // ["1.3", "object-storage-2", ...rest] — the /1.3 prefix is enforced: the
    // live API 404s without it (live probe 2026-08-01, the client shipped
    // prefix-less and every service lookup "not found"-ed).
    if (parts[0] !== "1.3" || parts[1] !== "object-storage-2") return _notFound("unknown path")
    const rest = parts.slice(2)

    if (rest.length === 0) return _handleServices(request)
    if (rest[0] === "regions" && request.method === "GET") {
      return _ok([{ name: "europe-1", primary_zone: "de-fra1", zones: ["de-fra1"] }])
    }
    const serviceUuid = rest[0]
    if (serviceUuid === undefined) return _badRequest("unhandled fixture route")
    if (rest.length === 1) return _handleServiceOne(request, serviceUuid, url.searchParams.get("force") === "true")
    if (rest[1] === "buckets") {
      const name = rest[2]
      return name === undefined ? _handleBuckets(request, serviceUuid) : _handleBucketOne(request, serviceUuid, name)
    }
    if (rest[1] === "users") {
      const username = rest[2]
      if (username === undefined) return _handleUsers(request, serviceUuid)
      if (rest[3] === "access-keys") {
        const accessKeyId = rest[4]
        return accessKeyId === undefined
          ? _handleAccessKeys(request, serviceUuid, username)
          : _handleAccessKeyOne(request, serviceUuid, username, accessKeyId)
      }
      return _handleUserOne(request, serviceUuid, username)
    }
    return _badRequest("unhandled fixture route")
  }

  const httpClient = HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, _handle(request)))).pipe(
    HttpClient.mapRequest(HttpClientRequest.prependUrl("https://fixture.invalid"))
  )

  return { httpClient, services, buckets, users, accessKeys }
}
