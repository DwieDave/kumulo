import { Effect } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"

const _baseUrl = "https://fixture.invalid"

interface FakeCluster {
  id: string
  name: string
  status: string
  /** OVH's api-server endpoint (`Cloud_kube_Cluster.url`) — what MKS DNS points `api_server` at. */
  url: string
  // Creation-time only, read back verbatim: OVH's update payload cannot change
  // any of them (`Cloud_ProjectKubeUpdate`).
  privateNetworkId?: string
  nodesSubnetId?: string
  loadBalancersSubnetId?: string
}
/** Mirrors `Cloud_kube_NodePoolTemplate` in the generated client (metadata + spec, same casing). */
interface FakeTemplate {
  readonly metadata: {
    readonly annotations: { readonly [key: string]: string }
    readonly finalizers: ReadonlyArray<string>
    readonly labels: { readonly [key: string]: string }
  }
  readonly spec: { readonly taints: ReadonlyArray<unknown>; readonly unschedulable: boolean }
}
interface FakeBody {
  readonly name?: string
  readonly flavorName?: string
  readonly template?: FakeTemplate
  readonly desiredNodes?: number
  readonly minNodes?: number
  readonly maxNodes?: number
  readonly autoscale?: boolean
  readonly antiAffinity?: boolean
  readonly monthlyBilled?: boolean
  readonly privateNetworkId?: string
  readonly nodesSubnetId?: string
  readonly loadBalancersSubnetId?: string
}
/** The node pool as OVH really reads it back (`Cloud_kube_NodePool`) — `template` included. */
interface FakePool {
  id: string
  projectId: string
  name: string
  template?: FakeTemplate
  flavor: string
  desiredNodes: number
  minNodes: number
  maxNodes: number
  autoscale: boolean
  antiAffinity: boolean
  monthlyBilled: boolean
  status: string
  sizeStatus: string
  availableNodes: number
  currentNodes: number
  upToDateNodes: number
  createdAt: string
  updatedAt: string
}

const _timestamp = "2026-01-01T00:00:00Z"

/**
 * The live `apply` found two bugs every fake had missed — an empty request
 * body and a null field — because fakes only ever asserted on responses. A
 * write whose body never arrived is a 400 here, not a silent success.
 */
const _badRequest = (message: string): Response => new Response(JSON.stringify({ message }), { status: 400 })

/**
 * Self-contained fixture-replay MKS server (no live network) — a smaller,
 * cli-local stand-in for distro-ovh-mks's own test fixture (that one lives
 * under a sibling package's `test/` dir, unreachable across the
 * `no-deep-package-imports` boundary from here).
 */
export const makeFakeMksServer = (
  // `null` = the project has no vRack, which is OVH's 404 (see `requireVrack`).
  { vrackId = "pn-vrack-1" }: { readonly vrackId?: string | null } = {}
) => {
  let nextId = 1
  const clusters = new Map<string, FakeCluster>()
  const pools = new Map<string, Map<string, FakePool>>()

  const _create = (name: string, body: FakeBody) => {
    const id = `kube-${nextId++}`
    const cluster: FakeCluster = {
      id,
      name,
      status: "READY",
      url: `https://${id}.fixture.mks.invalid`,
      privateNetworkId: body.privateNetworkId,
      nodesSubnetId: body.nodesSubnetId,
      loadBalancersSubnetId: body.loadBalancersSubnetId
    }
    clusters.set(id, cluster)
    pools.set(id, new Map())
    return cluster
  }

  // ponytail: fixture request bodies are one all-optional shape — whatever
  // `JSON.parse` hands back, read field by field with defaults, so a missing
  // field surfaces as a failed assertion in the test rather than a cast.
  const _handle = (request: HttpClientRequest.HttpClientRequest, body: FakeBody | undefined): Response => {
    const path = new URL(request.url).pathname
    if (path.match(/^\/cloud\/project\/[^/]+\/vrack$/) && request.method === "GET") {
      return vrackId === null ? new Response(JSON.stringify({ message: "not found" }), { status: 404 }) : _json({ id: vrackId })
    }
    const kubeMatch = path.match(/^\/cloud\/project\/[^/]+\/kube$/)
    if (kubeMatch && request.method === "GET") return _json([...clusters.keys()])
    if (kubeMatch && request.method === "POST") {
      if (body === undefined) return _badRequest("cluster create sent an empty body")
      const name = body.name ?? ""
      const existing = [...clusters.values()].find((cluster) => cluster.name === name)
      return _json(existing ?? _create(name, body))
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
      if (body === undefined) return _badRequest("nodepool create sent an empty body")
      if (body.flavorName === undefined) return _badRequest("nodepool create is missing the required flavorName")
      const id = `pool-${nextId++}`
      const desiredNodes = body.desiredNodes ?? 0
      const pool: FakePool = {
        id,
        projectId: "service-1",
        name: body.name ?? "",
        template: body.template,
        flavor: body.flavorName,
        desiredNodes,
        minNodes: body.minNodes ?? 0,
        maxNodes: body.maxNodes ?? 0,
        autoscale: body.autoscale ?? false,
        antiAffinity: body.antiAffinity ?? false,
        monthlyBilled: body.monthlyBilled ?? false,
        status: "READY",
        sizeStatus: "CAPACITY_OK",
        availableNodes: desiredNodes,
        currentNodes: desiredNodes,
        upToDateNodes: desiredNodes,
        createdAt: _timestamp,
        updatedAt: _timestamp
      }
      pools.get(poolListMatch[1] ?? "")?.set(id, pool)
      return _json(pool)
    }

    const poolIdMatch = path.match(/^\/cloud\/project\/[^/]+\/kube\/([^/]+)\/nodepool\/([^/]+)$/)
    if (poolIdMatch && request.method === "PUT") {
      const [, kubeId, poolId] = poolIdMatch
      if (body === undefined) return _badRequest("nodepool update sent an empty body")
      const pool = pools.get(kubeId ?? "")?.get(poolId ?? "")
      if (pool) {
        pool.desiredNodes = body.desiredNodes ?? pool.desiredNodes
        pool.minNodes = body.minNodes ?? pool.minNodes
        pool.maxNodes = body.maxNodes ?? pool.maxNodes
        pool.autoscale = body.autoscale ?? pool.autoscale
        pool.availableNodes = pool.desiredNodes
        pool.currentNodes = pool.desiredNodes
        pool.upToDateNodes = pool.desiredNodes
        pool.updatedAt = _timestamp
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

  function _fixtureHttpClient(handle: (request: HttpClientRequest.HttpClientRequest, body: FakeBody | undefined) => Response) {
    return HttpClient.make((request) =>
      Effect.gen(function*() {
        const text = yield* _bodyText(request)
        const body: FakeBody | undefined = text.length === 0 ? undefined : JSON.parse(text)
        return HttpClientResponse.fromWeb(request, handle(request, body))
      })
    ).pipe(HttpClient.mapRequest(HttpClientRequest.prependUrl(_baseUrl)))
  }
}

const _json = (value: unknown): Response => new Response(JSON.stringify(value), { status: 200 })

const _bodyText = (request: HttpClientRequest.HttpClientRequest): Effect.Effect<string> =>
  request.body._tag === "Uint8Array" ? Effect.succeed(new TextDecoder().decode(request.body.body)) : Effect.succeed("")
