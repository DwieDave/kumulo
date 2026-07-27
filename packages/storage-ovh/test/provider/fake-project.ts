import { Effect, Option } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { makeStorageClient } from "../../src/client/storage.ts"

interface StoredContainer {
  name: string
  region: string
  versioning: "enabled" | "disabled"
  encryption: "AES256" | "plaintext"
  objectCount: number
}

interface StoredUser {
  id: number
  username: string
  description: string
  // Mirrors OVH's async user provisioning: POST answers "creating", a later
  // GET observes "ok".
  status: "creating" | "ok"
}

interface StoredCredential {
  access: string
  secret: string
}

const _fixtureBaseUrl = "https://fixture.invalid"

interface FakeBody {
  readonly name?: string
  readonly description?: string
  readonly versioning?: { readonly status?: "enabled" | "disabled" }
  readonly encryption?: { readonly sseAlgorithm?: "AES256" | "plaintext" }
}

const _bodyOf = (request: HttpClientRequest.HttpClientRequest): FakeBody => {
  const body = request.body
  return body._tag === "Uint8Array" ? JSON.parse(new TextDecoder().decode(body.body)) : {}
}

const _containerKey = (region: string, name: string) => `${region}/${name}`

const _containerJson = (c: StoredContainer) => ({
  name: c.name,
  region: c.region,
  virtualHost: `${c.name}.${c.region}.io.ovh.net`,
  versioning: { status: c.versioning },
  encryption: { sseAlgorithm: c.encryption },
  objectsCount: c.objectCount
})

/**
 * Zero-network in-memory OVH cloud project: storage containers + users +
 * s3Credentials, driving the real generated client through `Storage`
 * (fixture-replay, same shape as dns-ovh's `makeFakeZone`).
 */
export const makeFakeProject = (serviceName: string) => {
  let nextUserId = 1
  const containers = new Map<string, StoredContainer>()
  const users = new Map<number, StoredUser>()
  const credentials = new Map<number, Array<StoredCredential>>()

  const _basePath = `/cloud/project/${serviceName}`

  const _handleContainers = (request: HttpClientRequest.HttpClientRequest, region: string): Response => {
    if (request.method === "GET") {
      return new Response(
        JSON.stringify([...containers.values()].filter((c) => c.region === region).map((c) => ({ name: c.name, region: c.region, virtualHost: `${c.name}.${region}.io.ovh.net` }))),
        { status: 200 }
      )
    }
    if (request.method === "POST") {
      const body = _bodyOf(request)
      const container: StoredContainer = {
        name: body.name ?? "",
        region,
        versioning: body.versioning?.status ?? "disabled",
        encryption: body.encryption?.sseAlgorithm ?? "plaintext",
        objectCount: 0
      }
      containers.set(_containerKey(region, container.name), container)
      return new Response(JSON.stringify(_containerJson(container)), { status: 200 })
    }
    return new Response(null, { status: 404 })
  }

  const _handleContainer = (request: HttpClientRequest.HttpClientRequest, region: string, name: string): Response => {
    const existing = containers.get(_containerKey(region, name))
    if (request.method === "GET") return existing ? new Response(JSON.stringify(_containerJson(existing)), { status: 200 }) : new Response(null, { status: 404 })
    if (request.method === "PUT" && existing) {
      const body = _bodyOf(request)
      existing.versioning = body.versioning?.status ?? existing.versioning
      return new Response(JSON.stringify(_containerJson(existing)), { status: 200 })
    }
    if (request.method === "DELETE" && existing) {
      containers.delete(_containerKey(region, name))
      return new Response(null, { status: 204 })
    }
    return new Response(null, { status: 404 })
  }

  const _handleObjects = (region: string, name: string): Response => {
    const existing = containers.get(_containerKey(region, name))
    const count = existing?.objectCount ?? 0
    return new Response(JSON.stringify(Array.from({ length: count }, (_, i) => ({ key: `object-${i}` }))), { status: 200 })
  }

  const _handleUsers = (request: HttpClientRequest.HttpClientRequest): Response => {
    if (request.method === "GET") {
      return new Response(JSON.stringify([...users.values()]), { status: 200 })
    }
    if (request.method === "POST") {
      const body = _bodyOf(request)
      const id = nextUserId++
      const user: StoredUser = { id, username: `user-${id}`, description: body.description ?? "", status: "creating" }
      users.set(id, user)
      return new Response(JSON.stringify(user), { status: 200 })
    }
    return new Response(null, { status: 404 })
  }

  const _handleUser = (request: HttpClientRequest.HttpClientRequest, userId: number): Response => {
    const user = users.get(userId)
    if (request.method !== "GET" || user === undefined) return new Response(null, { status: 404 })
    // The async provisioning completes by the time anyone polls.
    const settled: StoredUser = { ...user, status: "ok" }
    users.set(userId, settled)
    return new Response(JSON.stringify(settled), { status: 200 })
  }

  const _handleCredentials = (request: HttpClientRequest.HttpClientRequest, userId: number): Response => {
    if (request.method === "GET") {
      return new Response(JSON.stringify((credentials.get(userId) ?? []).map((c) => ({ access: c.access, userId: String(userId) }))), { status: 200 })
    }
    if (request.method === "POST") {
      const cred: StoredCredential = { access: `AK-${userId}-${(credentials.get(userId)?.length ?? 0) + 1}`, secret: `SK-${userId}` }
      credentials.set(userId, [...(credentials.get(userId) ?? []), cred])
      return new Response(JSON.stringify(cred), { status: 200 })
    }
    return new Response(null, { status: 404 })
  }

  const _handle = (request: HttpClientRequest.HttpClientRequest): Response => {
    const url = Option.getOrElse(HttpClientRequest.toUrl(request), () => new URL(request.url))
    const path = url.pathname

    const regionStorage = path.match(new RegExp(`^${_basePath}/region/([^/]+)/storage$`))
    if (regionStorage) return _handleContainers(request, regionStorage[1] ?? "")

    const regionStorageName = path.match(new RegExp(`^${_basePath}/region/([^/]+)/storage/([^/]+)$`))
    if (regionStorageName) return _handleContainer(request, regionStorageName[1] ?? "", regionStorageName[2] ?? "")

    const regionStorageObjects = path.match(new RegExp(`^${_basePath}/region/([^/]+)/storage/([^/]+)/object$`))
    if (regionStorageObjects) return _handleObjects(regionStorageObjects[1] ?? "", regionStorageObjects[2] ?? "")

    if (path === `${_basePath}/user`) return _handleUsers(request)

    const userCredentials = path.match(new RegExp(`^${_basePath}/user/(\\d+)/s3Credentials$`))
    if (userCredentials) return _handleCredentials(request, Number(userCredentials[1]))

    const singleCredential = path.match(new RegExp(`^${_basePath}/user/(\\d+)/s3Credentials/([^/]+)$`))
    if (singleCredential && request.method === "DELETE") {
      const userId = Number(singleCredential[1])
      credentials.set(userId, (credentials.get(userId) ?? []).filter((c) => c.access !== singleCredential[2]))
      return new Response(null, { status: 204 })
    }

    const singleUser = path.match(new RegExp(`^${_basePath}/user/(\\d+)$`))
    if (singleUser) return _handleUser(request, Number(singleUser[1]))

    return new Response(JSON.stringify({ message: "not found" }), { status: 404 })
  }

  const httpClient = HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, _handle(request)))).pipe(
    HttpClient.mapRequest(HttpClientRequest.prependUrl(_fixtureBaseUrl))
  )

  return {
    storage: makeStorageClient(httpClient),
    seedContainer: (c: { readonly name: string; readonly region: string; readonly versioning?: "enabled" | "disabled"; readonly objectCount?: number }): void => {
      containers.set(_containerKey(c.region, c.name), { name: c.name, region: c.region, versioning: c.versioning ?? "disabled", encryption: "plaintext", objectCount: c.objectCount ?? 0 })
    },
    seedUser: (description: string): number => {
      const id = nextUserId++
      users.set(id, { id, username: `user-${id}`, description, status: "ok" })
      return id
    },
    seedCredential: (userId: number): void => {
      credentials.set(userId, [...(credentials.get(userId) ?? []), { access: `AK-${userId}-seed`, secret: `SK-${userId}-seed` }])
    },
    peekContainer: (region: string, name: string) => containers.get(_containerKey(region, name)),
    userCount: (): number => users.size,
    credentialCount: (userId: number): number => (credentials.get(userId) ?? []).length
  }
}
