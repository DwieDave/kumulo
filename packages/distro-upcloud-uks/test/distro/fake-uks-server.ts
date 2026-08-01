import { Effect } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"

interface FakeLabel {
  readonly key: string
  readonly value: string
}

interface FakeCluster {
  uuid: string
  name: string
  zone: string
  network: string
  network_cidr: string
  version: string
  plan: string
  state: string
  // Live quirk: the API sends `null`, never an absent key, when no filter is set.
  control_plane_ip_filter: ReadonlyArray<string> | null
  storage_encryption?: string
  private_node_groups?: boolean
  labels?: ReadonlyArray<FakeLabel>
  pollsRemaining: number
}

interface FakeNodeGroup {
  name: string
  count: number
  plan: string
  state: string
  labels?: ReadonlyArray<FakeLabel>
  taints?: ReadonlyArray<{ readonly key: string; readonly value: string; readonly effect: string }>
  ssh_keys?: ReadonlyArray<string>
  // Live quirk: create accepts `{tier, size}` but reads return the resolved
  // storage-template UUID as a bare string.
  storage?: string
  anti_affinity?: boolean
  utility_network_access?: boolean
  pollsRemaining: number
}

interface FakeNetwork {
  uuid: string
  name: string
  zone: string
  router?: string
  ip_networks: { readonly ip_network: ReadonlyArray<{ readonly address: string; readonly dhcp: string; readonly family: string }> }
}

interface FakeRouter {
  uuid: string
  name: string
  type?: string
  attached_networks?: { readonly network: ReadonlyArray<unknown> }
}

interface CreateClusterBody {
  readonly name?: string
  readonly zone?: string
  readonly version?: string
  readonly network?: string
  readonly network_cidr?: string
  readonly plan?: string
  readonly control_plane_ip_filter?: ReadonlyArray<string>
  readonly storage_encryption?: string
  readonly private_node_groups?: boolean
  readonly labels?: ReadonlyArray<FakeLabel>
}

interface PatchClusterBody {
  readonly control_plane_ip_filter?: ReadonlyArray<string>
  readonly labels?: ReadonlyArray<FakeLabel>
}

interface CreateNodeGroupBody {
  readonly name?: string
  readonly count?: number
  readonly plan?: string
  readonly labels?: ReadonlyArray<FakeLabel>
  readonly taints?: ReadonlyArray<{ readonly key: string; readonly value: string; readonly effect: string }>
  readonly ssh_keys?: ReadonlyArray<string>
  readonly storage?: { readonly tier?: string; readonly size?: number }
  readonly anti_affinity?: boolean
  readonly utility_network_access?: boolean
}

interface PatchNodeGroupBody {
  readonly count?: number
}

interface CreateNetworkBody {
  readonly network?: {
    readonly name?: string
    readonly zone?: string
    readonly router?: string
    readonly ip_networks?: { readonly ip_network: ReadonlyArray<{ readonly address: string; readonly dhcp: string; readonly family: string }> }
  }
}

interface CreateRouterBody {
  readonly router?: { readonly name?: string }
}

/** `undefined` means the request carried no body at all — an empty-body call is a 400, not a silent success. */
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
 * Minimal in-memory fixture-replay stand-in for UpCloud's UKS + network/router
 * API (D13) — enough surface for a network+router -> cluster ->
 * poll-to-running -> node-group converge -> kubeconfig -> upgrade -> delete
 * lifecycle test, zero real network (per project test policy).
 *
 * Cluster and node-group `state` starts `pending` and flips to `running`
 * after `readyAfterPolls` reads, mirroring the documented UpCloud transition
 * (D13/plan.md). Network and router carry no `state` field on UpCloud's API
 * (unlike the OVH gateway) so they are created synchronously here too.
 */
export const makeFakeUksServer = (options: { readonly readyAfterPolls?: number } = {}) => {
  const readyAfterPolls = options.readyAfterPolls ?? 2
  const clusters = new Map<string, FakeCluster>()
  const nodeGroups = new Map<string, Map<string, FakeNodeGroup>>()
  const networks = new Map<string, FakeNetwork>()
  const routers = new Map<string, FakeRouter>()
  const upgrades = new Map<string, ReadonlyArray<string>>()
  let nextId = 1
  const freshUuid = (prefix: string) => `${prefix}-${nextId++}`

  const _clusterByName = (name: string) => [...clusters.values()].find((cluster) => cluster.name === name)

  const _handleClusters = (request: HttpClientRequest.HttpClientRequest): Response => {
    if (request.method === "GET") return _ok([...clusters.values()])
    if (request.method === "POST") {
      const payload = _bodyOf<CreateClusterBody>(request)
      if (payload === undefined) return _badRequest("cluster create sent an empty body")
      // kumulo: `version` is checked as strictly as `zone`/`network` on purpose.
      // An earlier fake echoed a hardcoded "1.31" — the config's own value — so a
      // client that never sent `version` still passed every lifecycle assertion.
      if (payload.zone === undefined || payload.network === undefined || payload.version === undefined) {
        return _badRequest("cluster create is missing a required field")
      }
      const uuid = freshUuid("uks")
      clusters.set(uuid, {
        uuid,
        name: payload.name ?? "",
        zone: payload.zone,
        network: payload.network,
        network_cidr: payload.network_cidr ?? "",
        version: payload.version,
        plan: payload.plan ?? "dev-md",
        state: "pending",
        control_plane_ip_filter: payload.control_plane_ip_filter ?? null,
        storage_encryption: payload.storage_encryption,
        private_node_groups: payload.private_node_groups,
        labels: payload.labels,
        pollsRemaining: readyAfterPolls
      })
      nodeGroups.set(uuid, new Map())
      upgrades.set(uuid, [])
      return _ok(clusters.get(uuid))
    }
    return _badRequest(`unsupported method ${request.method}`)
  }

  const _handleClusterOne = (request: HttpClientRequest.HttpClientRequest, uuid: string): Response => {
    const cluster = clusters.get(uuid)
    if (request.method === "GET") {
      if (!cluster) return _notFound("cluster not found")
      if (cluster.pollsRemaining > 0) cluster.pollsRemaining -= 1
      else cluster.state = "running"
      return _ok(cluster)
    }
    if (request.method === "PATCH") {
      if (!cluster) return _notFound("cluster not found")
      const payload = _bodyOf<PatchClusterBody>(request)
      if (payload === undefined) return _badRequest("cluster patch sent an empty body")
      if (payload.control_plane_ip_filter !== undefined) cluster.control_plane_ip_filter = payload.control_plane_ip_filter
      if (payload.labels !== undefined) cluster.labels = payload.labels
      return _ok(cluster)
    }
    if (request.method === "DELETE") {
      if (!cluster) return _notFound("cluster not found")
      clusters.delete(uuid)
      nodeGroups.delete(uuid)
      return _empty()
    }
    return _badRequest(`unsupported method ${request.method}`)
  }

  const _handleNodeGroups = (
    request: HttpClientRequest.HttpClientRequest,
    uuid: string
  ): Response => {
    const groups = nodeGroups.get(uuid)
    if (!groups) return _notFound("cluster not found")
    if (request.method === "GET") return _ok([...groups.values()])
    if (request.method === "POST") {
      const payload = _bodyOf<CreateNodeGroupBody>(request)
      if (payload === undefined) return _badRequest("node group create sent an empty body")
      if (payload.name === undefined || payload.plan === undefined) return _badRequest("node group create is missing a required field")
      const group: FakeNodeGroup = {
        name: payload.name,
        count: payload.count ?? 0,
        plan: payload.plan,
        state: "pending",
        labels: payload.labels,
        taints: payload.taints,
        ssh_keys: payload.ssh_keys,
        storage: payload.storage === undefined ? undefined : "01000000-0000-4000-8000-000160070100",
        anti_affinity: payload.anti_affinity,
        utility_network_access: payload.utility_network_access,
        pollsRemaining: readyAfterPolls
      }
      groups.set(group.name, group)
      // Live quirk: the POST response carries no `state` — only GET/list do.
      const { state: _state, ...createResponse } = group
      return _ok(createResponse)
    }
    return _badRequest(`unsupported method ${request.method}`)
  }

  const _handleNodeGroupOne = (
    request: HttpClientRequest.HttpClientRequest,
    uuid: string,
    name: string
  ): Response => {
    const groups = nodeGroups.get(uuid)
    if (!groups) return _notFound("cluster not found")
    const group = groups.get(name)
    if (request.method === "GET") {
      if (!group) return _notFound("node group not found")
      if (group.pollsRemaining > 0) group.pollsRemaining -= 1
      else group.state = "running"
      return _ok(group)
    }
    if (request.method === "PATCH") {
      if (!group) return _notFound("node group not found")
      const payload = _bodyOf<PatchNodeGroupBody>(request)
      if (payload === undefined) return _badRequest("node group patch sent an empty body")
      if (payload.count !== undefined) group.count = payload.count
      return _ok(group)
    }
    if (request.method === "DELETE") {
      if (!group) return _notFound("node group not found")
      groups.delete(name)
      return _empty()
    }
    return _badRequest(`unsupported method ${request.method}`)
  }

  const _handleNetworks = (request: HttpClientRequest.HttpClientRequest): Response => {
    if (request.method === "GET") return _ok({ networks: { network: [...networks.values()] } })
    if (request.method === "POST") {
      const payload = _bodyOf<CreateNetworkBody>(request)
      const body = payload?.network
      if (body === undefined) return _badRequest("network create sent an empty body")
      if (body.zone === undefined) return _badRequest("network create is missing the required zone")
      const uuid = freshUuid("net")
      const network: FakeNetwork = {
        uuid,
        name: body.name ?? "",
        zone: body.zone,
        router: body.router,
        ip_networks: body.ip_networks ?? { ip_network: [] }
      }
      networks.set(uuid, network)
      return _ok({ network })
    }
    return _badRequest(`unsupported method ${request.method}`)
  }

  const _handleNetworkOne = (request: HttpClientRequest.HttpClientRequest, uuid: string): Response => {
    const network = networks.get(uuid)
    if (request.method === "GET") {
      if (!network) return _notFound("network not found")
      return _ok({ network })
    }
    if (request.method === "DELETE") {
      if (!network) return _notFound("network not found")
      networks.delete(uuid)
      return _empty()
    }
    return _badRequest(`unsupported method ${request.method}`)
  }

  const _handleRouters = (request: HttpClientRequest.HttpClientRequest): Response => {
    if (request.method === "GET") return _ok({ routers: { router: [...routers.values()] } })
    if (request.method === "POST") {
      const payload = _bodyOf<CreateRouterBody>(request)
      const body = payload?.router
      if (body === undefined) return _badRequest("router create sent an empty body")
      const uuid = freshUuid("rtr")
      const router: FakeRouter = { uuid, name: body.name ?? "", attached_networks: { network: [] } }
      routers.set(uuid, router)
      return _ok({ router })
    }
    return _badRequest(`unsupported method ${request.method}`)
  }

  const _handleRouterOne = (request: HttpClientRequest.HttpClientRequest, uuid: string): Response => {
    const router = routers.get(uuid)
    if (request.method === "GET") {
      if (!router) return _notFound("router not found")
      return _ok({ router })
    }
    if (request.method === "DELETE") {
      if (!router) return _notFound("router not found")
      // Live quirk (2026-08-01 probe): a router with an attached network
      // 409s — the network must be deleted (detached) first.
      const attached = [...networks.values()].some((network) => network.router === uuid)
      if (attached) return _conflict(`router conflict: ${uuid}`)
      routers.delete(uuid)
      return _empty()
    }
    return _badRequest(`unsupported method ${request.method}`)
  }

  const _handleUpgrade = (request: HttpClientRequest.HttpClientRequest, uuid: string): Response => {
    const rest = new URL(request.url, "https://fixture.invalid").pathname.split("/").filter(Boolean).slice(3)
    if (rest[0] === "available-upgrades" && request.method === "GET") {
      return _ok({ versions: upgrades.get(uuid) ?? [] })
    }
    if (rest[0] === "upgrade" && request.method === "POST") {
      const payload = _bodyOf<{ readonly version?: string; readonly strategy?: string }>(request)
      if (payload === undefined) return _badRequest("upgrade sent an empty body")
      if (payload.version === undefined || payload.strategy === undefined) return _badRequest("upgrade is missing a required field")
      const cluster = clusters.get(uuid)
      if (cluster) cluster.version = payload.version
      return _empty()
    }
    if (rest[0] === "kubeconfig" && request.method === "GET") {
      return _ok({ kubeconfig: `apiVersion: v1\nkind: Config\n# ${uuid}\n` })
    }
    return _badRequest("unhandled fixture route")
  }

  const _handle = (request: HttpClientRequest.HttpClientRequest): Response => {
    const parts = new URL(request.url, "https://fixture.invalid").pathname.split("/").filter(Boolean)
    // ["1.3", "kubernetes"|"network"|"router", ...rest]
    const resource = parts[1]
    const rest = parts.slice(2)

    if (resource === "kubernetes") {
      if (rest.length === 0) return _handleClusters(request)
      if (rest[0] === "plans" && request.method === "GET") {
        return _ok([{ name: "dev-md" }, { name: "prod-md" }])
      }
      const uuid = rest[0]
      if (uuid === undefined) return _badRequest("unhandled fixture route")
      if (rest.length === 1) return _handleClusterOne(request, uuid)
      if (rest[1] === "node-groups" && rest.length === 2) return _handleNodeGroups(request, uuid)
      if (rest[1] === "node-groups" && rest.length >= 3) {
        const name = rest[2]
        if (name === undefined) return _badRequest("unhandled fixture route")
        if (rest.length === 3) return _handleNodeGroupOne(request, uuid, name)
        // single-node delete: /node-groups/{name}/{nodeName}
        if (rest.length === 4 && request.method === "DELETE") return _empty()
      }
      return _handleUpgrade(request, uuid)
    }
    if (resource === "network") {
      const uuid = rest[0]
      return uuid === undefined ? _handleNetworks(request) : _handleNetworkOne(request, uuid)
    }
    if (resource === "router") {
      const uuid = rest[0]
      return uuid === undefined ? _handleRouters(request) : _handleRouterOne(request, uuid)
    }
    return _badRequest("unhandled fixture route")
  }

  const httpClient = HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, _handle(request)))).pipe(
    HttpClient.mapRequest(HttpClientRequest.prependUrl("https://fixture.invalid"))
  )

  return { httpClient, clusters, nodeGroups, networks, routers, upgrades, _clusterByName }
}
