import { Effect } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"

const _baseUrl = "https://fixture.invalid"

interface FakeCluster {
  id: string
  name: string
  status: string
}
interface FakeBody {
  readonly name?: string
  readonly flavorName?: string
  readonly desiredNodes?: number
  readonly minNodes?: number
  readonly maxNodes?: number
  readonly autoscale?: boolean
  readonly antiAffinity?: boolean
  readonly monthlyBilled?: boolean
}
interface FakePool {
  id: string
  name: string
  flavor: string
  desiredNodes: number
  minNodes: number
  maxNodes: number
  autoscale: boolean
  antiAffinity: boolean
  monthlyBilled: boolean
}

/**
 * Self-contained fixture-replay MKS server (no live network) — a smaller,
 * cli-local stand-in for distro-ovh-mks's own test fixture (that one lives
 * under a sibling package's `test/` dir, unreachable across the
 * `no-deep-package-imports` boundary from here).
 */
export const makeFakeMksServer = () => {
  let nextId = 1
  const clusters = new Map<string, FakeCluster>()
  const pools = new Map<string, Map<string, FakePool>>()

  const _create = (name: string) => {
    const id = `kube-${nextId++}`
    const cluster: FakeCluster = { id, name, status: "READY" }
    clusters.set(id, cluster)
    pools.set(id, new Map())
    return cluster
  }

  // ponytail: fixture request bodies are one all-optional shape — whatever
  // `JSON.parse` hands back, read field by field with defaults, so a missing
  // field surfaces as a failed assertion in the test rather than a cast.
  const _handle = (request: HttpClientRequest.HttpClientRequest, body: FakeBody): Response => {
    const path = new URL(request.url).pathname
    const kubeMatch = path.match(/^\/cloud\/project\/[^/]+\/kube$/)
    if (kubeMatch && request.method === "GET") return _json([...clusters.keys()])
    if (kubeMatch && request.method === "POST") {
      const name = body.name ?? ""
      const existing = [...clusters.values()].find((cluster) => cluster.name === name)
      return _json(existing ?? _create(name))
    }

    const idMatch = path.match(/^\/cloud\/project\/[^/]+\/kube\/([^/]+)$/)
    if (idMatch && request.method === "GET") return _json(clusters.get(idMatch[1] ?? ""))
    if (idMatch && request.method === "DELETE") {
      clusters.delete(idMatch[1] ?? "")
      pools.delete(idMatch[1] ?? "")
      // kumulo: the generated client's delete op only matches HTTP 200 (OVH's
      // actual contract), not 204 — a real "no content" response would
      // otherwise get misread as an unexpected-status error.
      return new Response(null, { status: 200 })
    }

    const kubeconfigMatch = path.match(/^\/cloud\/project\/[^/]+\/kube\/([^/]+)\/kubeconfig$/)
    if (kubeconfigMatch && request.method === "POST") return _json({ content: "apiVersion: v1\nkind: Config\n" })

    const poolListMatch = path.match(/^\/cloud\/project\/[^/]+\/kube\/([^/]+)\/nodepool$/)
    if (poolListMatch && request.method === "GET") return _json([...(pools.get(poolListMatch[1] ?? "")?.values() ?? [])])
    if (poolListMatch && request.method === "POST") {
      const id = `pool-${nextId++}`
      const pool: FakePool = {
        id,
        name: body.name ?? "",
        flavor: body.flavorName ?? "",
        desiredNodes: body.desiredNodes ?? 0,
        minNodes: body.minNodes ?? 0,
        maxNodes: body.maxNodes ?? 0,
        autoscale: body.autoscale ?? false,
        antiAffinity: body.antiAffinity ?? false,
        monthlyBilled: body.monthlyBilled ?? false
      }
      pools.get(poolListMatch[1] ?? "")?.set(id, pool)
      return _json(pool)
    }

    const poolIdMatch = path.match(/^\/cloud\/project\/[^/]+\/kube\/([^/]+)\/nodepool\/([^/]+)$/)
    if (poolIdMatch && request.method === "PUT") {
      const [, kubeId, poolId] = poolIdMatch
      const pool = pools.get(kubeId ?? "")?.get(poolId ?? "")
      if (pool) {
        pool.desiredNodes = body.desiredNodes ?? pool.desiredNodes
        pool.minNodes = body.minNodes ?? pool.minNodes
        pool.maxNodes = body.maxNodes ?? pool.maxNodes
      }
      return _json(pool)
    }
    if (poolIdMatch && request.method === "DELETE") {
      const [, kubeId, poolId] = poolIdMatch
      pools.get(kubeId ?? "")?.delete(poolId ?? "")
      return new Response(null, { status: 200 })
    }

    return new Response(JSON.stringify({ message: "not found" }), { status: 404 })
  }

  return { clusters, pools, httpClient: _fixtureHttpClient(_handle) }

  function _fixtureHttpClient(handle: (request: HttpClientRequest.HttpClientRequest, body: FakeBody) => Response) {
    return HttpClient.make((request) =>
      Effect.gen(function*() {
        const text = yield* _bodyText(request)
        const body: FakeBody = text.length === 0 ? {} : JSON.parse(text)
        return HttpClientResponse.fromWeb(request, handle(request, body))
      })
    ).pipe(HttpClient.mapRequest(HttpClientRequest.prependUrl(_baseUrl)))
  }
}

const _json = (value: unknown): Response => new Response(JSON.stringify(value), { status: 200 })

const _bodyText = (request: HttpClientRequest.HttpClientRequest): Effect.Effect<string> =>
  request.body._tag === "Uint8Array" ? Effect.succeed(new TextDecoder().decode(request.body.body)) : Effect.succeed("")
