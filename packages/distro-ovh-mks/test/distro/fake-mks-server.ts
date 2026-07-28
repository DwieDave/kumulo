import { Effect } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"

interface FakeCluster {
  id: string
  name: string
  region: string
  version?: string
  status: string
  url: string
  pollsRemaining: number
  // Creation-time only, and read back verbatim — OVH's update payload cannot
  // change any of them (`Cloud_ProjectKubeUpdate`).
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

/** The node pool as OVH really reads it back (`Cloud_kube_NodePool`). */
interface FakePool {
  id: string
  name: string
  template?: FakeTemplate
  flavor: string
  desiredNodes: number
  minNodes: number
  maxNodes: number
  autoscale: boolean
  antiAffinity: boolean
  monthlyBilled: boolean
  // Every field on `Cloud_kube_NodePool` is optional, including these
  // server-side ones — a pool created outside kumulo may carry none of them.
  projectId?: string
  status?: string
  sizeStatus?: string
  availableNodes?: number
  currentNodes?: number
  upToDateNodes?: number
  createdAt?: string
  updatedAt?: string
}

const _timestamp = "2026-01-01T00:00:00Z"

interface CreateClusterBody {
  readonly name?: string
  readonly region?: string
  readonly version?: string
  readonly privateNetworkId?: string
  readonly nodesSubnetId?: string
  readonly loadBalancersSubnetId?: string
}

interface CreatePoolBody {
  readonly name?: string
  readonly template?: FakeTemplate
  readonly flavorName?: string
  readonly desiredNodes?: number
  readonly minNodes?: number
  readonly maxNodes?: number
  readonly autoscale?: boolean
  readonly antiAffinity?: boolean
  readonly monthlyBilled?: boolean
}

interface UpdatePoolBody {
  readonly desiredNodes?: number
  readonly minNodes?: number
  readonly maxNodes?: number
  readonly autoscale?: boolean
}

/**
 * `undefined` means the request carried no body at all. The live `apply`
 * found an empty-request-body bug that every fake missed because they only
 * asserted on responses — here that is a 400, not a silent success.
 */
const _bodyOf = <Body>(request: HttpClientRequest.HttpClientRequest): Body | undefined => {
  const body = request.body
  if (body._tag !== "Uint8Array") return undefined
  const text = new TextDecoder().decode(body.body)
  if (text.length === 0) return undefined
  const parsed: Body = JSON.parse(text)
  return parsed
}

const _badRequest = (message: string): Response => new Response(JSON.stringify({ message }), { status: 400 })

/**
 * Minimal in-memory fixture-replay stand-in for the OVH MKS API — enough
 * surface for a create→poll-ready→nodepool-converge→kubeconfig→upgrade→
 * delete lifecycle test, zero real network (per project test policy).
 */
export const makeFakeMksServer = (options: { readonly readyAfterPolls?: number } = {}) => {
  const readyAfterPolls = options.readyAfterPolls ?? 2
  const clusters = new Map<string, FakeCluster>()
  const pools = new Map<string, Map<string, FakePool>>()
  let nextId = 1
  const freshId = (prefix: string) => `${prefix}-${nextId++}`

  const _handleKube = (request: HttpClientRequest.HttpClientRequest, parts: ReadonlyArray<string>): Response | undefined => {
    if (parts.length !== 4) return undefined
    if (request.method === "GET") return new Response(JSON.stringify([...clusters.keys()]), { status: 200 })
    if (request.method === "POST") {
      const payload = _bodyOf<CreateClusterBody>(request)
      if (payload === undefined) return _badRequest("cluster create sent an empty body")
      if (payload.region === undefined) return _badRequest("cluster create is missing the required region")
      const id = freshId("kube")
      clusters.set(id, {
        id,
        name: payload.name ?? "",
        region: payload.region,
        version: payload.version,
        status: "INSTALLING",
        url: `https://${id}.mks.ovh`,
        pollsRemaining: readyAfterPolls,
        privateNetworkId: payload.privateNetworkId,
        nodesSubnetId: payload.nodesSubnetId,
        loadBalancersSubnetId: payload.loadBalancersSubnetId
      })
      pools.set(id, new Map())
      return new Response(JSON.stringify(clusters.get(id)), { status: 200 })
    }
    return undefined
  }

  const _handleKubeId = (request: HttpClientRequest.HttpClientRequest, kubeId: string): Response | undefined => {
    if (request.method === "GET") {
      const cluster = clusters.get(kubeId)
      if (!cluster) return new Response(JSON.stringify({ message: "not found" }), { status: 404 })
      if (cluster.pollsRemaining > 0) cluster.pollsRemaining -= 1
      else cluster.status = "READY"
      return new Response(JSON.stringify(cluster), { status: 200 })
    }
    if (request.method === "DELETE") {
      clusters.delete(kubeId)
      return new Response(null, { status: 200 })
    }
    return undefined
  }

  const _handleNodepool = (
    request: HttpClientRequest.HttpClientRequest,
    kubeId: string,
    rest: ReadonlyArray<string>
  ): Response | undefined => {
    if (rest.length === 1 && request.method === "GET") {
      return new Response(JSON.stringify([...(pools.get(kubeId)?.values() ?? [])]), { status: 200 })
    }
    if (rest.length === 1 && request.method === "POST") {
      const payload = _bodyOf<CreatePoolBody>(request)
      if (payload === undefined) return _badRequest("nodepool create sent an empty body")
      if (payload.flavorName === undefined) return _badRequest("nodepool create is missing the required flavorName")
      const id = freshId("pool")
      const desiredNodes = payload.desiredNodes ?? 0
      const pool: FakePool = {
        id,
        projectId: "service-1",
        name: payload.name ?? "",
        template: payload.template,
        flavor: payload.flavorName,
        desiredNodes,
        minNodes: payload.minNodes ?? 0,
        maxNodes: payload.maxNodes ?? 0,
        autoscale: payload.autoscale ?? false,
        antiAffinity: payload.antiAffinity ?? false,
        monthlyBilled: payload.monthlyBilled ?? false,
        status: "READY",
        sizeStatus: "CAPACITY_OK",
        availableNodes: desiredNodes,
        currentNodes: desiredNodes,
        upToDateNodes: desiredNodes,
        createdAt: _timestamp,
        updatedAt: _timestamp
      }
      pools.get(kubeId)?.set(id, pool)
      return new Response(JSON.stringify(pool), { status: 200 })
    }
    const poolId = rest[1]
    if (rest.length === 2 && poolId !== undefined && request.method === "PUT") {
      const payload = _bodyOf<UpdatePoolBody>(request)
      if (payload === undefined) return _badRequest("nodepool update sent an empty body")
      const pool = pools.get(kubeId)?.get(poolId)
      if (pool) Object.assign(pool, payload, { updatedAt: _timestamp })
      return new Response(null, { status: 200 })
    }
    if (rest.length === 2 && poolId !== undefined && request.method === "DELETE") {
      pools.get(kubeId)?.delete(poolId)
      return new Response(null, { status: 200 })
    }
    return undefined
  }

  const _handleUpdate = (request: HttpClientRequest.HttpClientRequest): Response => {
    const payload = _bodyOf<{ readonly strategy?: string }>(request)
    if (payload === undefined) return _badRequest("cluster update sent an empty body")
    if (payload.strategy === undefined) return _badRequest("cluster update is missing the required strategy")
    return new Response(null, { status: 200 })
  }

  const _handle = (request: HttpClientRequest.HttpClientRequest): Response => {
    const parts = new URL(request.url, "https://fixture.invalid").pathname.split("/").filter(Boolean)
    // ["cloud","project",svc,"kube", ...rest]
    const kubeId = parts[4]
    const rest = parts.slice(5)

    const handled = kubeId === undefined
      ? _handleKube(request, parts)
      : rest.length === 0
      ? _handleKubeId(request, kubeId)
      : rest[0] === "kubeconfig" && request.method === "POST"
      ? new Response(JSON.stringify({ content: `apiVersion: v1\nkind: Config\n# ${kubeId}\n` }), { status: 200 })
      : rest[0] === "update" && request.method === "POST"
      ? _handleUpdate(request)
      : rest[0] === "nodepool"
      ? _handleNodepool(request, kubeId, rest)
      : undefined

    return handled ?? new Response(JSON.stringify({ message: "unhandled fixture route" }), { status: 500 })
  }

  const httpClient = HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, _handle(request)))).pipe(
    HttpClient.mapRequest(HttpClientRequest.prependUrl("https://fixture.invalid"))
  )

  return { httpClient, clusters, pools }
}
