import {
  CapabilityMissing,
  CloudProvider,
  CONFIG_HASH_KEY,
  configHash,
  ProvisioningTimeout,
  ResourceNotFound,
  ResponseDecodeError
} from "@kumulo/core"
import type {
  ClusterTag,
  Inventory,
  LbInfo,
  LbSpec,
  NetworkInfo,
  NetworkSpec,
  SecGroupInfo,
  SecGroupSpec,
  ServerInfo,
  ServerSpec
} from "@kumulo/core"
import { Effect, Layer, Schedule } from "effect"
import type { HttpClient } from "effect/unstable/http"
import * as Schema from "effect/Schema"
import type { KeystoneAuth } from "../auth/keystone-auth.ts"
import { glanceClient, neutronClient, novaClient, octaviaClient } from "../client/services.ts"
import { toOpenStackError } from "./errors.ts"
import type { OpenStackError } from "./errors.ts"
import { decodeServerIp } from "./schemas.ts"
import { SecurityGroupRuleInput } from "./security-group-rules.ts"

export interface CloudProviderOptions {
  readonly tag: ClusterTag
  readonly region: string
  readonly octaviaEnabled: boolean
  readonly imageAliases: Record<string, string>
}

type Deps = KeystoneAuth | HttpClient.HttpClient
type R<A> = Effect.Effect<A, OpenStackError, Deps>

const _name = (options: CloudProviderOptions, suffix?: string): string =>
  suffix === undefined ? `kumulo-${options.tag}` : `kumulo-${options.tag}-${suffix}`

// Every generated-client call funnels its `HttpClientError | SchemaError`
// through the shared status taxonomy.
const _at = (kind: string, ref: string) => toOpenStackError({ kind, ref })

interface Named {
  readonly id?: string | undefined
  readonly name?: string | undefined
}

// kumulo: only for endpoints that accept `?name=` — the server already
// filtered, and list entries routinely omit `name`.
const _first = <A>(entries: ReadonlyArray<A> | undefined): A | undefined => entries?.[0]

// kumulo: for endpoints with NO name filter (Nova server groups + flavors,
// Octavia load balancers) the match has to happen here. Taking the first entry
// instead — as the hand-rolled transport did, sending a `?name=` those APIs
// silently ignore — adopted whatever resource happened to come back first.
const _named = <A extends Named>(entries: ReadonlyArray<A> | undefined, name: string): A | undefined =>
  entries?.find((entry) => entry.name === name)

const _idOf = (entry: Named | undefined): string => entry?.id ?? ""

// ---- pagination -----------------------------------------------------------

// kumulo: hard stop on a server that keeps advertising a next page.
const _MAX_PAGES = 100

// OpenStack advertises its next page as a full URL (Glance's flat `next`,
// Nova's `<field>_links` with `rel: "next"`); both encode the cursor as
// `?marker=`, which is exactly what the typed endpoints take.
const _markerOf = (href: string | undefined): string | undefined =>
  href === undefined ? undefined : new URL(href, "https://openstack.invalid").searchParams.get("marker") ?? undefined

type Page<A> = readonly [ReadonlyArray<A>, string | undefined]

// Every OpenStack list endpoint paginates (Glance defaults to 25 items, Nova to
// 1000) — following it is the difference between "no such image" and "no such
// image on page one".
const _paginate = <A>(page: (marker: string | undefined) => R<Page<A>>): R<ReadonlyArray<A>> =>
  Effect.gen(function*() {
    const collected: Array<A> = []
    let marker: string | undefined = undefined
    for (let index = 0; index < _MAX_PAGES; index += 1) {
      const [items, next]: Page<A> = yield* page(marker)
      collected.push(...items)
      marker = _markerOf(next)
      if (marker === undefined) break
    }
    return collected
  })

// A 409 on an idempotent re-apply, and a 404 on a delete, are both no-ops.
const _ignoreConflict = <A>(effect: R<A>): R<void> =>
  effect.pipe(Effect.asVoid, Effect.catchTag("ResourceConflict", () => Effect.void))

const _ignoreMissing = <A>(effect: R<A>): R<void> =>
  effect.pipe(Effect.asVoid, Effect.catchTag("ResourceNotFound", () => Effect.void))

// ---- Network ----------------------------------------------------------

export const ensureNetwork = ({ options, spec }: { readonly options: CloudProviderOptions; readonly spec: NetworkSpec }): R<NetworkInfo> =>
  Effect.gen(function*() {
    const client = yield* neutronClient(options.region)
    const name = _name(options)
    const listed = yield* client.networks.networksGet({ query: { name } }).pipe(
      Effect.mapError(_at("network", "v2.0/networks"))
    )
    const existing = _first(listed.networks)
    if (existing !== undefined) return { id: _idOf(existing), cidr: spec.cidr }
    const created = yield* client.networks.networksPost({ payload: { network: { name } } }).pipe(
      Effect.mapError(_at("network", "v2.0/networks"))
    )
    const id = _idOf(created.network)
    yield* _ignoreConflict(
      client.subnets.subnetsPost({ payload: { subnet: { network_id: id, cidr: spec.cidr, ip_version: 4 } } }).pipe(
        Effect.mapError(_at("subnet", "v2.0/subnets"))
      )
    )
    return { id, cidr: spec.cidr }
  })

// ---- Security groups ---------------------------------------------------

const _decodeRule = (rule: unknown): Effect.Effect<SecurityGroupRuleInput, ResponseDecodeError> =>
  Schema.decodeUnknownEffect(SecurityGroupRuleInput)(rule).pipe(
    Effect.mapError((error) => new ResponseDecodeError({ endpoint: "secgroup-rule", issue: error.issue }))
  )

// kumulo: optional keys are OMITTED, never set to `undefined` — the generated
// schemas use `optionalKey`, which rejects an explicit `undefined`.
type NeutronClient = Effect.Success<ReturnType<typeof neutronClient>>

const _applyRule = (
  { client, groupId, rule }: {
    readonly client: NeutronClient
    readonly groupId: string
    readonly rule: SecurityGroupRuleInput
  }
): R<void> =>
  _ignoreConflict(
    client["security-group-rules"].securityGroupRulesPost({
      payload: {
        security_group_rule: {
          security_group_id: groupId,
          direction: "ingress",
          // Neutron types its own port range as a string.
          ...(rule.protocol === "any" ? {} : { protocol: rule.protocol }),
          ...(rule.portMin === undefined ? {} : { port_range_min: String(rule.portMin) }),
          ...(rule.portMax === undefined ? {} : { port_range_max: String(rule.portMax) }),
          ...(rule.remoteCidr === undefined ? {} : { remote_ip_prefix: rule.remoteCidr }),
          ...(rule.remoteGroupSelf === true ? { remote_group_id: groupId } : {})
        }
      }
    }).pipe(Effect.mapError(_at("security-group-rule", "v2.0/security-group-rules")))
  )

export const ensureSecurityGroups = (
  { options, spec }: { readonly options: CloudProviderOptions; readonly spec: SecGroupSpec }
): R<SecGroupInfo> =>
  Effect.gen(function*() {
    const client = yield* neutronClient(options.region)
    const name = _name(options)
    const ref = "v2.0/security-groups"
    const listed = yield* client["security-groups"].securityGroupsGet({ query: { name } }).pipe(
      Effect.mapError(_at("security-group", ref))
    )
    const existing = _first(listed.security_groups)
    const groupId = existing !== undefined ? _idOf(existing) : _idOf(
      (yield* client["security-groups"].securityGroupsPost({ payload: { security_group: { name } } }).pipe(
        Effect.mapError(_at("security-group", ref))
      )).security_group
    )
    const rules = yield* Effect.forEach(spec.rules, _decodeRule)
    yield* Effect.forEach(rules, (rule) => _applyRule({ client, groupId, rule }), { discard: true })
    return { id: groupId }
  })

// ---- Server groups (soft-anti-affinity per role) -------------------

export type ServerGroupRole = "master" | "worker"

// ponytail: granularity is masters-vs-workers only (ServerSpec carries no
// pool id) — split per worker pool once the port grows one.
export const ensureServerGroups = (
  { options, role }: { readonly options: CloudProviderOptions; readonly role: ServerGroupRole }
): R<string> =>
  Effect.gen(function*() {
    const client = yield* novaClient(options.region)
    const name = _name(options, `${role}s`)
    const ref = "v2.1/os-server-groups"
    const listed = yield* client["os-server-groups"].osServerGroupsGet({ query: {} }).pipe(
      Effect.mapError(_at("server-group", ref))
    )
    const existing = _named(listed.server_groups, name)
    if (existing !== undefined) return _idOf(existing)
    const created = yield* client["os-server-groups"].osServerGroupsPost({
      payload: { server_group: { name, policy: "soft-anti-affinity" } }
    }).pipe(Effect.mapError(_at("server-group", ref)))
    return _idOf(created.server_group)
  })

// ---- Load balancer (Octavia, capability-gated) --------------------------

export const ensureLoadBalancer = (
  { options, spec: _spec }: { readonly options: CloudProviderOptions; readonly spec: LbSpec }
): R<LbInfo> =>
  Effect.gen(function*() {
    if (!options.octaviaEnabled) {
      return yield* Effect.fail(new CapabilityMissing({ capability: "octavia", region: options.region }))
    }
    const client = yield* octaviaClient(options.region)
    const name = _name(options)
    const ref = "v2/lbaas/loadbalancers"
    const listed = yield* client["load-balancers"].lbaasLoadbalancersGet({}).pipe(
      Effect.mapError(_at("load-balancer", ref))
    )
    const existing = _named(listed.loadbalancers, name)
    if (existing !== undefined) return { id: _idOf(existing), vip: existing.vip_address ?? "" }
    // ponytail: `spec.members` is deliberately not sent — Octavia takes members
    // on a pool, never on the load balancer, and the old hand-built body was
    // rejected by any real Octavia. Wire pools/members when the port asks.
    const created = yield* client["load-balancers"].lbaasLoadbalancersPost({
      payload: { loadbalancer: { name } }
    }).pipe(Effect.mapError(_at("load-balancer", ref)))
    return { id: _idOf(created.loadbalancer), vip: created.loadbalancer?.vip_address ?? "" }
  })

// ---- Servers -------------------------------------------------------------

interface ServerDetail {
  readonly status: string
  readonly ip: string
}

// kumulo: `responseMode: "decoded-and-response"` because Nova's spec types
// `addresses` as a free-form map that codegen closes — see `./schemas.ts`.
const _serverDetail = (options: CloudProviderOptions, id: string): R<ServerDetail> =>
  Effect.gen(function*() {
    const client = yield* novaClient(options.region)
    const fail = _at("server", `v2.1/servers/${id}`)
    const [decoded, response] = yield* client.servers.serversIdGet({
      params: { id },
      responseMode: "decoded-and-response"
    }).pipe(Effect.mapError(fail))
    const body = yield* response.json.pipe(Effect.mapError(fail))
    return { status: decoded.server?.status ?? "UNKNOWN", ip: yield* decodeServerIp(body) }
  })

const _serverStatus = (options: CloudProviderOptions, id: string): R<string> =>
  _serverDetail(options, id).pipe(Effect.map((server) => server.status))

const _waitActive = (options: CloudProviderOptions, id: string): R<void> =>
  _serverStatus(options, id).pipe(
    Effect.repeat({ schedule: Schedule.spaced("2 seconds"), times: 150, while: (status) => status !== "ACTIVE" && status !== "ERROR" }),
    Effect.flatMap((status) =>
      status === "ACTIVE" ? Effect.void : Effect.fail(new ProvisioningTimeout({ kind: "server", ref: id, lastStatus: status }))
    )
  )

const _waitGone = (options: CloudProviderOptions, id: string): R<void> =>
  _serverStatus(options, id).pipe(
    Effect.repeat({ schedule: Schedule.spaced("2 seconds"), times: 150 }),
    Effect.flatMap(() => Effect.fail(new ProvisioningTimeout({ kind: "server", ref: id, lastStatus: "still present" }))),
    Effect.catchTag("ResourceNotFound", () => Effect.void)
  )

const _deleteServerById = (options: CloudProviderOptions, id: string): R<void> =>
  Effect.gen(function*() {
    const client = yield* novaClient(options.region)
    yield* _ignoreMissing(
      client.servers.serversIdDelete({ params: { id } }).pipe(Effect.mapError(_at("server", `v2.1/servers/${id}`)))
    )
    yield* _waitGone(options, id)
  })

// kumulo: deletes a single server and waits until it's gone (404), for
// scale-down's per-worker teardown (whole-cluster `deleteByTag` doesn't wait).
export const deleteServer = ({ options, ref }: { readonly options: CloudProviderOptions; readonly ref: ServerInfo }): R<void> =>
  _deleteServerById(options, ref.id)

const _findServerByName = (options: CloudProviderOptions, name: string): R<Named | undefined> =>
  Effect.gen(function*() {
    const client = yield* novaClient(options.region)
    const listed = yield* client.servers.serversGet({ query: { name } }).pipe(
      Effect.mapError(_at("server", "v2.1/servers"))
    )
    return _first(listed.servers)
  })

// kumulo: a server that booted to ERROR is unusable and — because the lookup
// would keep re-finding it — would make every later apply fail forever. Reap it
// here so the caller recreates instead of adopting it. `undefined` means
// "nothing usable, create a fresh one".
const _adoptExisting = (
  { name, options }: { readonly options: CloudProviderOptions; readonly name: string }
): R<ServerInfo | undefined> =>
  Effect.gen(function*() {
    const found = yield* _findServerByName(options, name)
    if (found === undefined) return undefined
    const id = _idOf(found)
    // The list response carries no `status`/`addresses` — only the detail view does.
    const status = yield* _serverStatus(options, id)
    if (status === "ERROR") {
      yield* Effect.logWarning(`server "${name}" (${id}) is in ERROR state — deleting it and recreating`)
      yield* _deleteServerById(options, id)
      return undefined
    }
    yield* _waitActive(options, id)
    const detail = yield* _serverDetail(options, id)
    return { id, name, ip: detail.ip }
  })

const _createServer = (
  { groupId, options, spec }: { readonly options: CloudProviderOptions; readonly spec: ServerSpec; readonly groupId: string }
): R<string> =>
  Effect.gen(function*() {
    const client = yield* novaClient(options.region)
    const created = yield* client.servers.serversPost({
      payload: {
        server: {
          name: spec.name,
          imageRef: spec.image,
          flavorRef: spec.flavor,
          tags: [spec.tag],
          // Drift detection reads this back off the detail listing.
          metadata: { [CONFIG_HASH_KEY]: configHash(spec) },
          // ponytail: `"auto"` keeps Nova's own network selection, which is what
          // the hand-rolled body (omitting this now-required field) effectively
          // got. Pass the cluster network once `ServerSpec` names one.
          networks: "auto"
        },
        // The hint is a sibling of `server`; nested inside it Nova ignores it.
        "OS-SCH-HNT:scheduler_hints": { group: groupId }
      }
    }).pipe(Effect.mapError(_at("server", "v2.1/servers")))
    return _idOf(created.server)
  })

export const ensureServer = ({ options, spec }: { readonly options: CloudProviderOptions; readonly spec: ServerSpec }): R<ServerInfo> =>
  Effect.gen(function*() {
    const adopted = yield* _adoptExisting({ options, name: spec.name })
    if (adopted !== undefined) return adopted
    const groupId = yield* ensureServerGroups({ options, role: spec.role })
    const id = yield* _createServer({ options, spec, groupId })
    // kumulo: if the boot never reaches ACTIVE, tear the half-built server down
    // rather than leaving a wedged instance behind for the next apply to trip on.
    const detail = yield* _waitActive(options, id).pipe(
      Effect.flatMap(() => _serverDetail(options, id)),
      Effect.onError(() => Effect.ignore(_deleteServerById(options, id)))
    )
    return { id, name: spec.name, ip: detail.ip }
  })

// ---- Inventory + delete --------------------------------------------------

// Servers created before hash stamping carry no metadata entry -> `undefined`
// (unknown), which the planner reads as "converged as far as we can tell".
interface TaggedServer extends Named {
  readonly metadata?: { readonly [key: string]: string } | undefined
}

// kumulo: `/servers/detail` rather than `/servers` — the list view carries no
// `metadata`, and without it every node plans as NoOp forever.
const _listServersByTag = (options: CloudProviderOptions): R<ReadonlyArray<TaggedServer>> =>
  Effect.gen(function*() {
    const client = yield* novaClient(options.region)
    return yield* _paginate<TaggedServer>((marker) =>
      client.servers.serversDetailGet({ query: { tags: options.tag, ...(marker === undefined ? {} : { marker }) } }).pipe(
        Effect.mapError(_at("server", "v2.1/servers/detail")),
        Effect.map((listed) => [
          listed.servers ?? [],
          listed.servers_links?.find((link) => link.rel === "next")?.href
        ])
      )
    )
  })

const _findNetwork = (options: CloudProviderOptions): R<Named | undefined> =>
  Effect.gen(function*() {
    const client = yield* neutronClient(options.region)
    const listed = yield* client.networks.networksGet({ query: { name: _name(options) } }).pipe(
      Effect.mapError(_at("network", "v2.0/networks"))
    )
    return _first(listed.networks)
  })

const _findSecurityGroup = (options: CloudProviderOptions): R<Named | undefined> =>
  Effect.gen(function*() {
    const client = yield* neutronClient(options.region)
    const listed = yield* client["security-groups"].securityGroupsGet({ query: { name: _name(options) } }).pipe(
      Effect.mapError(_at("security-group", "v2.0/security-groups"))
    )
    return _first(listed.security_groups)
  })

interface LoadBalancer extends Named {
  readonly vip_address?: string | undefined
}

const _findLoadBalancer = (options: CloudProviderOptions): R<LoadBalancer | undefined> =>
  Effect.gen(function*() {
    const client = yield* octaviaClient(options.region)
    const listed = yield* client["load-balancers"].lbaasLoadbalancersGet({}).pipe(
      Effect.mapError(_at("load-balancer", "v2/lbaas/loadbalancers"))
    )
    return _named(listed.loadbalancers, _name(options))
  })

export const listClusterResources = ({ options }: { readonly options: CloudProviderOptions }): R<Inventory> =>
  Effect.gen(function*() {
    const [servers, network, secGroup, lb] = yield* Effect.all([
      _listServersByTag(options),
      _findNetwork(options),
      _findSecurityGroup(options),
      _findLoadBalancer(options)
    ], { concurrency: 4 })
    return {
      // The list view carries no addresses; only the detail view does.
      servers: servers.map((record) => ({
        id: _idOf(record),
        name: record.name ?? "",
        ip: "",
        configHash: record.metadata?.[CONFIG_HASH_KEY]
      })),
      networks: network === undefined ? [] : [{ id: _idOf(network), cidr: "" }],
      securityGroups: secGroup === undefined ? [] : [{ id: _idOf(secGroup) }],
      loadBalancers: lb === undefined ? [] : [{ id: _idOf(lb), vip: lb.vip_address ?? "" }]
    }
  })

const _deleteServers = (options: CloudProviderOptions): R<void> =>
  Effect.gen(function*() {
    const client = yield* novaClient(options.region)
    const servers = yield* _listServersByTag(options)
    yield* Effect.forEach(servers, (record) => {
      const id = _idOf(record)
      return _ignoreMissing(
        client.servers.serversIdDelete({ params: { id } }).pipe(Effect.mapError(_at("server", `v2.1/servers/${id}`)))
      )
    }, { discard: true })
  })

const _serverGroupRoles: ReadonlyArray<ServerGroupRole> = ["master", "worker"]

const _deleteServerGroups = (options: CloudProviderOptions): R<void> =>
  Effect.gen(function*() {
    const client = yield* novaClient(options.region)
    const ref = "v2.1/os-server-groups"
    const listed = yield* client["os-server-groups"].osServerGroupsGet({ query: {} }).pipe(
      Effect.mapError(_at("server-group", ref))
    )
    yield* Effect.forEach(_serverGroupRoles, (role) => {
      const found = _named(listed.server_groups, _name(options, `${role}s`))
      return found === undefined ? Effect.void : _ignoreMissing(
        client["os-server-groups"].osServerGroupsIdDelete({ params: { id: _idOf(found) } }).pipe(
          Effect.mapError(_at("server-group", ref))
        )
      )
    }, { discard: true })
  })

const _deleteLoadBalancer = (options: CloudProviderOptions): R<void> =>
  Effect.gen(function*() {
    const found = yield* _findLoadBalancer(options)
    if (found === undefined) return
    const client = yield* octaviaClient(options.region)
    yield* _ignoreMissing(
      client["load-balancers"].lbaasLoadbalancersLoadbalancerIdDelete({
        params: { loadbalancer_id: _idOf(found) },
        query: { cascade: true }
      }).pipe(Effect.mapError(_at("load-balancer", "v2/lbaas/loadbalancers")))
    )
  })

const _deleteNetworking = (options: CloudProviderOptions): R<void> =>
  Effect.gen(function*() {
    const client = yield* neutronClient(options.region)
    const secGroup = yield* _findSecurityGroup(options)
    if (secGroup !== undefined) {
      yield* _ignoreMissing(
        client["security-groups"].securityGroupsIdDelete({ params: { id: _idOf(secGroup) } }).pipe(
          Effect.mapError(_at("security-group", "v2.0/security-groups"))
        )
      )
    }
    const network = yield* _findNetwork(options)
    if (network !== undefined) {
      yield* _ignoreMissing(
        client.networks.networksNetworkIdDelete({ params: { network_id: _idOf(network) } }).pipe(
          Effect.mapError(_at("network", "v2.0/networks"))
        )
      )
    }
  })

// kumulo: reverse dependency order — LB, servers, server groups, security group, network.
export const deleteByTag = ({ options }: { readonly options: CloudProviderOptions }): R<void> =>
  Effect.gen(function*() {
    yield* _deleteLoadBalancer(options)
    yield* _deleteServers(options)
    yield* _deleteServerGroups(options)
    yield* _deleteNetworking(options)
  })

// ---- Image / flavor resolution: alias -> exact -> fuzzy (+warn) ---------

const _fuzzyMatch = <A extends Named>(entries: ReadonlyArray<A>, ref: string): A | undefined =>
  entries.find((entry) => (entry.name ?? "").toLowerCase().includes(ref.toLowerCase()))

export const resolveImage = ({ options, ref }: { readonly options: CloudProviderOptions; readonly ref: string }): R<string> =>
  Effect.gen(function*() {
    const client = yield* glanceClient(options.region)
    const fail = _at("image", "v2/images")
    const wanted = options.imageAliases[ref] ?? ref
    const listed = yield* client.images.imagesGet({ query: { name: wanted } }).pipe(Effect.mapError(fail))
    const exact = _first(listed.images)
    if (exact !== undefined) return _idOf(exact)
    const all = yield* _paginate<Named>((marker) =>
      client.images.imagesGet({ query: marker === undefined ? {} : { marker } }).pipe(
        Effect.mapError(fail),
        Effect.map((page) => [page.images ?? [], page.next])
      )
    )
    const fuzzy = _fuzzyMatch(all, wanted)
    if (fuzzy === undefined) return yield* Effect.fail(new ResourceNotFound({ kind: "image", ref }))
    yield* Effect.logWarning(`image "${wanted}" matched by fuzzy lookup: "${fuzzy.name ?? ""}"`)
    return _idOf(fuzzy)
  })

export const resolveFlavor = ({ options, ref }: { readonly options: CloudProviderOptions; readonly ref: string }): R<string> =>
  Effect.gen(function*() {
    const client = yield* novaClient(options.region)
    // kumulo: Nova's flavor list takes no `name` filter, so both passes match here.
    const listed = yield* client.flavors.flavorsGet({ query: {} }).pipe(
      Effect.mapError(_at("flavor", "v2.1/flavors"))
    )
    const exact = _named(listed.flavors, ref)
    if (exact !== undefined) return _idOf(exact)
    const detailed = yield* client.flavors.flavorsDetailGet({ query: {} }).pipe(
      Effect.mapError(_at("flavor", "v2.1/flavors/detail"))
    )
    const fuzzy = _fuzzyMatch(detailed.flavors ?? [], ref)
    if (fuzzy === undefined) return yield* Effect.fail(new ResourceNotFound({ kind: "flavor", ref }))
    yield* Effect.logWarning(`flavor "${ref}" matched by fuzzy lookup: "${fuzzy.name ?? ""}"`)
    return _idOf(fuzzy)
  })

// ---- Layer ---------------------------------------------------------------

export const CloudProviderLive = (options: CloudProviderOptions): Layer.Layer<CloudProvider, never, Deps> =>
  Layer.effect(
    CloudProvider,
    Effect.gen(function*() {
      const context = yield* Effect.context<Deps>()
      const run = <A>(effect: R<A>) => Effect.provide(effect, context)
      return {
        ensureNetwork: (spec: NetworkSpec) => run(ensureNetwork({ options, spec })),
        ensureSecurityGroups: (spec: SecGroupSpec) => run(ensureSecurityGroups({ options, spec })),
        ensureLoadBalancer: (spec: LbSpec) => run(ensureLoadBalancer({ options, spec })),
        ensureServer: (spec: ServerSpec) => run(ensureServer({ options, spec })),
        deleteServer: (ref: ServerInfo) => run(deleteServer({ options, ref })),
        deleteByTag: (_tag: ClusterTag) => run(deleteByTag({ options })),
        listClusterResources: (_tag: ClusterTag) => run(listClusterResources({ options })),
        resolveImage: (ref: string) => run(resolveImage({ options, ref })),
        resolveFlavor: (ref: string) => run(resolveFlavor({ options, ref }))
      }
    })
  )
