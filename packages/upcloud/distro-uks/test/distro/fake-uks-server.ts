import { Effect, Predicate } from "effect"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"

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
  // quirk: control_plane_ip_filter is null (not absent) when no filter is set
  control_plane_ip_filter: ReadonlyArray<string> | null
  storage_encryption?: string | null
  private_node_groups?: boolean
  labels?: ReadonlyArray<FakeLabel>
  pollsRemaining: number
  notFoundPolls: number
}

interface FakeNodeGroup {
  name: string
  count: number
  plan: string
  state: string
  labels?: ReadonlyArray<FakeLabel>
  taints?: ReadonlyArray<{ readonly key: string; readonly value: string; readonly effect: string }>
  ssh_keys?: ReadonlyArray<string>
  storage?: string
  anti_affinity?: boolean
  utility_network_access?: boolean
  pollsRemaining: number
  terminatingPolls?: number
}

interface FakeNetwork {
  uuid: string
  name: string
  zone: string
  router?: string
  labels?: ReadonlyArray<FakeLabel>
  ip_networks: { readonly ip_network: ReadonlyArray<{ readonly address: string; readonly dhcp: string; readonly family: string }> }
}

interface FakeRouter {
  uuid: string
  name: string
  labels?: ReadonlyArray<FakeLabel>
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
    readonly labels?: ReadonlyArray<FakeLabel>
    readonly ip_networks?: { readonly ip_network: ReadonlyArray<{ readonly address: string; readonly dhcp: string; readonly family: string }> }
  }
}

interface CreateRouterBody {
  readonly router?: { readonly name?: string; readonly labels?: ReadonlyArray<FakeLabel> }
}

interface ModifyBody {
  readonly network?: { readonly labels?: ReadonlyArray<FakeLabel> }
  readonly router?: { readonly name?: string; readonly labels?: ReadonlyArray<FakeLabel> }
}

const _matchesLabels = (url: string, labels: ReadonlyArray<FakeLabel> | undefined): boolean =>
  new URL(url, "https://fixture.invalid").searchParams.getAll("label").every((filter) => {
    const [key, value] = filter.split("=")

    return (labels ?? []).some((label) => label.key === key && label.value === value)
  })

/** `undefined` means the request carried no body at all — an empty-body call is a 400, not a silent success. */
const _bodyOf = <Body>(request: HttpClientRequest.HttpClientRequest): Body | undefined => {
  const body = request.body

  if (!Predicate.isTagged(body, "Uint8Array")) return undefined
  const text = new TextDecoder().decode(body.body)

  if (text.length === 0) return undefined
  const parsed: Body = JSON.parse(text)

  return parsed
}

const _badRequest = (message: string): Response => new Response(JSON.stringify({ message }), { status: 400 })
const _notFound = (message: string): Response => new Response(JSON.stringify({ message }), { status: 404 })
const _conflict = (message: string): Response => new Response(JSON.stringify({ message }), { status: 409 })

const _invalidRequest = (message: string): Response =>
  new Response(JSON.stringify({ error: { error_code: "INVALID_REQUEST", error_message: message } }), { status: 400 })

const _ok = <Body>(body: Body): Response => new Response(JSON.stringify(body), { status: 200 })
const _empty = (): Response => new Response(null, { status: 200 })

export const makeFakeUksServer = (
  options: {
    readonly readyAfterPolls?: number
    readonly networkDeleteConflicts?: number
    readonly notFoundPollsAfterCreate?: number
    readonly failClusterOnCreate?: boolean
    readonly terminatingPolls?: number
  } = {}
) => {
  const terminatingPolls = options.terminatingPolls ?? 0
  const readyAfterPolls = options.readyAfterPolls ?? 2
  let networkDeleteConflicts = options.networkDeleteConflicts ?? 0
  const clusters = new Map<string, FakeCluster>()
  const nodeGroups = new Map<string, Map<string, FakeNodeGroup>>()
  const networks = new Map<string, FakeNetwork>()
  const routers = new Map<string, FakeRouter>()
  const upgrades = new Map<string, ReadonlyArray<string>>()
  const clusterPatches: Array<PatchClusterBody> = []
  const clusterGets: Array<string> = []
  const upgradeRequests: Array<{ readonly version?: string; readonly strategy?: { readonly type?: string } }> = []
  let nextId = 1
  const freshUuid = (prefix: string) => `${prefix}-${nextId++}`

  const _clusterByName = (name: string) => [...clusters.values()].find((cluster) => cluster.name === name)

  const _handleClusters = (request: HttpClientRequest.HttpClientRequest): Response => {
    if (request.method === "GET") return _ok([...clusters.values()])

    if (request.method === "POST") {
      const payload = _bodyOf<CreateClusterBody>(request)

      if (payload === undefined) return _badRequest("cluster create sent an empty body")

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
        pollsRemaining: readyAfterPolls,
        notFoundPolls: options.notFoundPollsAfterCreate ?? 0
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
      clusterGets.push(uuid)

      if (cluster.notFoundPolls > 0) {
        cluster.notFoundPolls -= 1

        return _notFound("cluster not found")
      }

      if (options.failClusterOnCreate === true) cluster.state = "failed"
      else if (cluster.pollsRemaining > 0) cluster.pollsRemaining -= 1
      else cluster.state = "running"

      return _ok(cluster)
    }

    if (request.method === "PATCH") {
      if (!cluster) return _notFound("cluster not found")
      const payload = _bodyOf<PatchClusterBody>(request)

      if (payload === undefined) return _badRequest("cluster patch sent an empty body")

      if (payload.control_plane_ip_filter === undefined) return _invalidRequest("control_plane_ip_filter is required")
      clusterPatches.push(payload)

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

      if (group.state === "terminating") {
        if ((group.terminatingPolls ?? 0) > 0) group.terminatingPolls = (group.terminatingPolls ?? 0) - 1
        else {
          groups.delete(name)

          return _notFound("node group not found")
        }

        return _ok(group)
      }

      if (group.pollsRemaining > 0) group.pollsRemaining -= 1
      else group.state = "running"

      return _ok(group)
    }

    if (request.method === "PATCH") {
      if (!group) return _notFound("node group not found")
      const payload = _bodyOf<PatchNodeGroupBody>(request)

      if (payload === undefined) return _badRequest("node group patch sent an empty body")

      if (payload.count !== undefined) {
        if (payload.count !== group.count) {
          group.state = payload.count > group.count ? "scaling-up" : "scaling-down"
          group.pollsRemaining = 1
        }

        group.count = payload.count
      }

      return _ok(group)
    }

    if (request.method === "DELETE") {
      if (!group) return _notFound("node group not found")

      if (terminatingPolls > 0) {
        group.state = "terminating"
        group.terminatingPolls = terminatingPolls

        return _empty()
      }

      groups.delete(name)

      return _empty()
    }

    return _badRequest(`unsupported method ${request.method}`)
  }

  const _handleNetworks = (request: HttpClientRequest.HttpClientRequest): Response => {
    if (request.method === "GET") {
      const zone = new URL(request.url, "https://fixture.invalid").searchParams.get("zone")

      const listed = [...networks.values()].filter(
        (network) => (zone === null || network.zone === zone) && _matchesLabels(request.url, network.labels)
      )

      return _ok({ networks: { network: listed } })
    }

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
        labels: body.labels,
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

    if (request.method === "PUT") {
      if (!network) return _notFound("network not found")
      const labels = _bodyOf<ModifyBody>(request)?.network?.labels

      if (labels === undefined) return _badRequest("network modify sent no labels")
      network.labels = labels

      return _ok({ network })
    }

    if (request.method === "DELETE") {
      if (!network) return _notFound("network not found")

      if (networkDeleteConflicts > 0) {
        networkDeleteConflicts -= 1

        return _conflict("NETWORK_NOT_EMPTY")
      }

      networks.delete(uuid)

      return _empty()
    }

    return _badRequest(`unsupported method ${request.method}`)
  }

  const _handleRouters = (request: HttpClientRequest.HttpClientRequest): Response => {
    if (request.method === "GET") {
      return _ok({ routers: { router: [...routers.values()].filter((router) => _matchesLabels(request.url, router.labels)) } })
    }

    if (request.method === "POST") {
      const payload = _bodyOf<CreateRouterBody>(request)
      const body = payload?.router

      if (body === undefined) return _badRequest("router create sent an empty body")
      const uuid = freshUuid("rtr")
      const router: FakeRouter = { uuid, name: body.name ?? "", labels: body.labels, attached_networks: { network: [] } }
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

    if (request.method === "PATCH") {
      if (!router) return _notFound("router not found")
      const body = _bodyOf<ModifyBody>(request)?.router

      if (body?.name === undefined) return _badRequest("router modify requires name")

      if (body.labels !== undefined) router.labels = body.labels

      return _ok({ router })
    }

    if (request.method === "DELETE") {
      if (!router) return _notFound("router not found")
      // quirk: a router with an attached network 409s, network must be detached first
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
      const payload = _bodyOf<{ readonly version?: string; readonly strategy?: { readonly type?: string } }>(request)

      if (payload === undefined) return _badRequest("upgrade sent an empty body")

      if (payload.version === undefined || payload.strategy?.type === undefined) return _badRequest("upgrade is missing a required field")
      const cluster = clusters.get(uuid)

      upgradeRequests.push(payload)

      if (cluster) {
        cluster.version = payload.version
        cluster.state = "pending"
        cluster.pollsRemaining = readyAfterPolls
      }

      return _empty()
    }

    if (rest[0] === "kubeconfig" && request.method === "GET") {
      return _ok({ kubeconfig: `apiVersion: v1\nkind: Config\n# ${uuid}\n` })
    }

    return _badRequest("unhandled fixture route")
  }

  const _handle = (request: HttpClientRequest.HttpClientRequest): Response => {
    const parts = new URL(request.url, "https://fixture.invalid").pathname.split("/").filter(Boolean)
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

  return { httpClient, clusters, nodeGroups, networks, routers, upgrades, clusterPatches, clusterGets, upgradeRequests, _clusterByName }
}
