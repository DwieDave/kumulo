import {
  CapabilityMissing,
  CloudProvider,
  CONFIG_HASH_KEY,
  configHash,
  pollUntil,
  ProvisioningTimeout,
  ResourceConflict,
  ResourceNotFound,
  ResponseDecodeError
} from "@kumulo/core"
import type {
  ClusterTag,
  Inventory,
  LbInfo,
  LbSpec,
  GatewayRef,
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

const _at = (kind: string, ref: string) => toOpenStackError({ kind, ref })

interface Named {
  readonly id?: string | undefined
  readonly name?: string | null | undefined
}

const _first = <A>(entries: ReadonlyArray<A> | undefined): A | undefined => entries?.[0]

const _named = <A extends Named>(entries: ReadonlyArray<A> | undefined, name: string): A | undefined =>
  entries?.find((entry) => entry.name === name)

const _idOf = (entry: Named | undefined): string => entry?.id ?? ""

const _MAX_PAGES = 100

const _markerOf = (href: string | undefined): string | undefined =>
  href === undefined ? undefined : new URL(href, "https://openstack.invalid").searchParams.get("marker") ?? undefined

type Page<A> = readonly [ReadonlyArray<A>, string | undefined]

// every OpenStack list endpoint paginates, following it is the difference between "no such X" and "no such X on page one"
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

const _ignoreConflict = <A>(effect: R<A>): R<void> =>
  effect.pipe(Effect.asVoid, Effect.catchTag("ResourceConflict", () => Effect.void))

const _ignoreMissing = <A>(effect: R<A>): R<void> =>
  effect.pipe(Effect.asVoid, Effect.catchTag("ResourceNotFound", () => Effect.void))


const _SUBNETS = "v2.0/subnets"

interface Subnet extends Named {
  readonly cidr?: string | null | undefined
}

const _subnetCidrs = (spec: NetworkSpec): ReadonlyArray<string> => [
  spec.nodesSubnet ?? spec.cidr,
  ...(spec.loadBalancersSubnet === undefined ? [] : [spec.loadBalancersSubnet])
]

const _subnetIdOf = (subnets: ReadonlyArray<Subnet>, cidr: string): string | undefined => {
  const id = subnets.find((subnet) => subnet.cidr === cidr)?.id
  return id === "" ? undefined : id
}

const _listSubnets = (
  { client, networkId }: { readonly client: NeutronClient; readonly networkId: string }
): R<ReadonlyArray<Subnet>> =>
  client.subnets.subnetsGet({ query: { network_id: networkId } }).pipe(
    Effect.mapError(_at("subnet", _SUBNETS)),
    Effect.map((listed) => listed.subnets ?? [])
  )

const _createSubnet = (
  { cidr, client, networkId }: { readonly client: NeutronClient; readonly networkId: string; readonly cidr: string }
): R<void> =>
  _ignoreConflict(
    client.subnets.subnetsPost({ payload: { subnet: { network_id: networkId, cidr, ip_version: 4 } } }).pipe(
      Effect.mapError(_at("subnet", _SUBNETS))
    )
  )

const _networkInfo = (
  { ids, id, spec }: {
    readonly id: string
    readonly spec: NetworkSpec
    readonly ids: ReadonlyArray<string | undefined>
  }
): NetworkInfo => ({
  id,
  cidr: spec.cidr,
  ...(ids[0] === undefined ? {} : { nodesSubnetId: ids[0] }),
  ...(ids[1] === undefined ? {} : { loadBalancersSubnetId: ids[1] })
})

const _NETWORKS = "v2.0/networks"

const _findNetworkId = (
  { client, name }: { readonly client: NeutronClient; readonly name: string }
): R<string | undefined> =>
  client.networks.networksGet({ query: { name } }).pipe(
    Effect.mapError(_at("network", _NETWORKS)),
    Effect.map((listed) => {
      const existing = _first(listed.networks)
      return existing === undefined ? undefined : _idOf(existing)
    })
  )

const _ensureNetworkId = (
  { client, name }: { readonly client: NeutronClient; readonly name: string }
): R<{ readonly id: string; readonly created: boolean }> =>
  Effect.gen(function*() {
    const existing = yield* _findNetworkId({ client, name })
    if (existing !== undefined) return { id: existing, created: false }
    const created = yield* client.networks.networksPost({ payload: { network: { name } } }).pipe(
      Effect.mapError(_at("network", _NETWORKS))
    )
    return { id: _idOf(created.network), created: true }
  })

const _completeSubnets = (
  { cidrs, client, networkId }: {
    readonly client: NeutronClient
    readonly networkId: string
    readonly cidrs: ReadonlyArray<string>
  }
): R<ReadonlyArray<Subnet>> =>
  Effect.gen(function*() {
    yield* Effect.forEach(cidrs, (cidr) => _createSubnet({ client, networkId, cidr }), { discard: true })
    return yield* _listSubnets({ client, networkId })
  })

// an existing network is read, never written: a subnet POST against a live cluster strands a second subnet or fails on Neutron's overlap 400
export const ensureNetwork = ({ options, spec }: { readonly options: CloudProviderOptions; readonly spec: NetworkSpec }): R<NetworkInfo> =>
  Effect.gen(function*() {
    const client = yield* neutronClient(options.region)
    const cidrs = _subnetCidrs(spec)
    const { created, id } = yield* _ensureNetworkId({ client, name: _name(options) })
    const existing = created ? [] : yield* _listSubnets({ client, networkId: id })
    const subnets = existing.length > 0 ? existing : yield* _completeSubnets({ client, networkId: id, cidrs })
    return _networkInfo({ id, spec, ids: cidrs.map((cidr) => _subnetIdOf(subnets, cidr)) })
  })

export const findNetwork = (
  { options, spec }: { readonly options: CloudProviderOptions; readonly spec: NetworkSpec }
): R<NetworkInfo | undefined> =>
  Effect.gen(function*() {
    const client = yield* neutronClient(options.region)
    const id = yield* _findNetworkId({ client, name: _name(options) })
    if (id === undefined) return undefined
    const subnets = yield* _listSubnets({ client, networkId: id })
    return _networkInfo({ id, spec, ids: _subnetCidrs(spec).map((cidr) => _subnetIdOf(subnets, cidr)) })
  })


const _ROUTERS = "v2.0/routers"

export const hasGateway = (
  { name, options }: { readonly options: CloudProviderOptions; readonly name: string }
): R<boolean> =>
  Effect.gen(function*() {
    const client = yield* neutronClient(options.region)
    const listed = yield* client.routers.routersGet({ query: { name } }).pipe(Effect.mapError(_at("router", _ROUTERS)))
    return _first(listed.routers) !== undefined
  })

// teardown order Neutron requires: detach every subnet interface off the router before deleting it, before the network
export const deleteGateway = (
  { options, subnetIds }: {
    readonly options: CloudProviderOptions
    readonly subnetIds: ReadonlyArray<string>
  }
): R<void> =>
  Effect.gen(function*() {
    const client = yield* neutronClient(options.region)
    const listed = yield* client.routers.routersGet({ query: { name: _name(options) } }).pipe(
      Effect.mapError(_at("router", _ROUTERS))
    )
    const existing = _first(listed.routers)
    if (existing === undefined) return
    const id = _idOf(existing)
    yield* Effect.forEach(subnetIds, (subnetId) => _detachSubnet({ client, routerId: id, subnetId }), { discard: true })
    yield* _ignoreMissing(
      client.routers.routersIdDelete({ params: { id } }).pipe(Effect.mapError(_at("router", _ROUTERS)))
    )
  })

const _detachSubnet = (
  { client, routerId, subnetId }: {
    readonly client: NeutronClient
    readonly routerId: string
    readonly subnetId: string
  }
): R<void> =>
  _ignoreMissing(
    client.routers.routersIdRemoveRouterInterfacePut({
      params: { id: routerId },
      payload: { subnet_id: subnetId }
    }).pipe(Effect.mapError(_at("router-interface", `${_ROUTERS}/${routerId}`)))
  )


const _FLOATING_IPS = "v2.0/floatingips"

interface FloatingIp extends Named {
  readonly floating_ip_address?: string | undefined
  readonly port_id?: string | null | undefined
}

export interface FloatingIpInfo {
  readonly id: string
  readonly address: string
}

// floating IPs key on `description` (free text), not `port_id`, which breaks once the owning LB is deleted
const _fipKey = (options: CloudProviderOptions): string => _name(options)

const _findFloatingIp = (
  { client, description }: { readonly client: NeutronClient; readonly description: string }
): R<FloatingIp | undefined> =>
  client.floatingips.floatingipsGet({ query: { description } }).pipe(
    Effect.mapError(_at("floating-ip", _FLOATING_IPS)),
    Effect.map((listed) => _first(listed.floatingips))
  )

// first `router:external` network wins, name it on CloudProviderOptions if a project ever has several
const _externalNetworkId = (client: NeutronClient): R<string> =>
  client.networks.networksGet({ query: { "router:external": true } }).pipe(
    Effect.mapError(_at("network", "v2.0/networks")),
    Effect.flatMap((listed) => {
      const found = _first(listed.networks)
      return found === undefined
        ? Effect.fail(new ResourceNotFound({ kind: "network", ref: "router:external=true" }))
        : Effect.succeed(_idOf(found))
    })
  )

const _fipInfo = (fip: FloatingIp | undefined): FloatingIpInfo => ({
  id: _idOf(fip),
  address: fip?.floating_ip_address ?? ""
})

// adopting an existing FIP without re-pointing it publishes an address that silently routes nowhere
const _associate = (
  { client, existing, portId }: {
    readonly client: NeutronClient
    readonly existing: FloatingIp
    readonly portId: string
  }
): R<FloatingIpInfo> =>
  existing.port_id === portId ? Effect.succeed(_fipInfo(existing)) : client.floatingips.floatingipsIdPut({
    params: { id: _idOf(existing) },
    payload: { floatingip: { port_id: portId } }
  }).pipe(Effect.mapError(_at("floating-ip", _FLOATING_IPS)), Effect.as(_fipInfo(existing)))

export const ensureFloatingIp = (
  { options, portId }: { readonly options: CloudProviderOptions; readonly portId: string }
): R<FloatingIpInfo> =>
  Effect.gen(function*() {
    const client = yield* neutronClient(options.region)
    const description = _fipKey(options)
    const existing = yield* _findFloatingIp({ client, description })
    if (existing !== undefined) return yield* _associate({ client, existing, portId })
    const floating_network_id = yield* _externalNetworkId(client)
    const created = yield* client.floatingips.floatingipsPost({
      payload: { floatingip: { floating_network_id, port_id: portId, description } }
    }).pipe(Effect.mapError(_at("floating-ip", _FLOATING_IPS)))
    return _fipInfo(created.floatingip)
  })

export const releaseFloatingIp = ({ options }: { readonly options: CloudProviderOptions }): R<void> =>
  Effect.gen(function*() {
    const client = yield* neutronClient(options.region)
    const found = yield* _findFloatingIp({ client, description: _fipKey(options) })
    if (found === undefined) return
    yield* _ignoreMissing(
      client.floatingips.floatingipsIdDelete({ params: { id: _idOf(found) } }).pipe(
        Effect.mapError(_at("floating-ip", _FLOATING_IPS))
      )
    )
  })


const _decodeRule = (rule: unknown): Effect.Effect<SecurityGroupRuleInput, ResponseDecodeError> =>
  Schema.decodeUnknownEffect(SecurityGroupRuleInput)(rule).pipe(
    Effect.mapError((error) => new ResponseDecodeError({ endpoint: "secgroup-rule", issue: error.issue }))
  )

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


export type ServerGroupRole = "master" | "worker"

// granularity is masters-vs-workers only, split per worker pool once needed
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


const _LOAD_BALANCERS = "v2/lbaas/loadbalancers"
const _LB_FLAVORS = "v2/lbaas/flavors"

type OctaviaClient = Effect.Success<ReturnType<typeof octaviaClient>>

interface Vip extends Named {
  readonly vip_address?: string | undefined
  readonly vip_port_id?: string | undefined
  readonly provisioning_status?: string | undefined
}

const _lbPayload = (
  { flavorId, name, spec }: { readonly name: string; readonly spec: LbSpec; readonly flavorId: string | undefined }
) => ({
  loadbalancer: {
    name,
    ...(spec.vipSubnetId === undefined ? {} : { vip_subnet_id: spec.vipSubnetId }),
    ...(spec.vipNetworkId === undefined ? {} : { vip_network_id: spec.vipNetworkId }),
    ...(flavorId === undefined ? {} : { flavor_id: flavorId })
  }
})

const _resolveFlavorId = (
  { client, spec }: { readonly client: OctaviaClient; readonly spec: LbSpec }
): R<string | undefined> => {
  if (spec.flavorName === undefined) return Effect.succeed(spec.flavorId)
  return client.flavors.lbaasFlavorsGet({}).pipe(
    Effect.mapError(_at("load-balancer-flavor", _LB_FLAVORS)),
    Effect.flatMap((listed) => {
      const flavors = listed.flavors ?? []
      const match = _named(flavors, spec.flavorName ?? "")
      return match === undefined
        ? Effect.fail(
          new ResourceNotFound({
            kind: "load-balancer-flavor",
            ref: `no Octavia flavor named "${spec.flavorName}" in this region; available: ${
              flavors.map((flavor) => flavor.name).filter((n) => n !== undefined).join(", ") || "(none)"
            }`
          })
        )
        : Effect.succeed(_idOf(match))
    })
  )
}

const _lbInfo = (
  { lb, options, spec }: { readonly options: CloudProviderOptions; readonly spec: LbSpec; readonly lb: Vip | undefined }
): R<LbInfo> =>
  Effect.gen(function*() {
    const base = { id: _idOf(lb), vip: lb?.vip_address ?? "" }
    if (spec.floatingIp !== true) return base
    const portId = lb?.vip_port_id ?? ""
    if (portId === "") return yield* Effect.fail(new ResourceNotFound({ kind: "load-balancer-vip-port", ref: base.id }))
    const fip = yield* ensureFloatingIp({ options, portId })
    return { ...base, floatingIp: fip.address }
  })

// an existing LB is read, never written: listeners/pools belong to the CCM once a Service adopts it, not kumulo's to converge/prune
export const ensureLoadBalancer = (
  { options, spec }: { readonly options: CloudProviderOptions; readonly spec: LbSpec }
): R<LbInfo> =>
  Effect.gen(function*() {
    if (!options.octaviaEnabled) {
      return yield* Effect.fail(new CapabilityMissing({ capability: "octavia", region: options.region }))
    }
    const client = yield* octaviaClient(options.region)
    const name = _name(options)
    const fail = _at("load-balancer", _LOAD_BALANCERS)
    const listed = yield* client["load-balancers"].lbaasLoadbalancersGet({}).pipe(Effect.mapError(fail))
    const existing = _named(listed.loadbalancers, name)
    if (existing !== undefined) return yield* _lbInfo({ options, spec, lb: existing })
    const flavorId = yield* _resolveFlavorId({ client, spec })
    const created = yield* client["load-balancers"].lbaasLoadbalancersPost({
      payload: _lbPayload({ name, spec, flavorId })
    }).pipe(Effect.mapError(fail))
    return yield* _lbInfo({ options, spec, lb: created.loadbalancer })
  })


interface ServerDetail {
  readonly status: string
  readonly ip: string
}

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

// a server booted to ERROR is reaped here, or every later apply would keep re-finding and failing on it
const _adoptExisting = (
  { name, options }: { readonly options: CloudProviderOptions; readonly name: string }
): R<ServerInfo | undefined> =>
  Effect.gen(function*() {
    const found = yield* _findServerByName(options, name)
    if (found === undefined) return undefined
    const id = _idOf(found)
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
          metadata: { [CONFIG_HASH_KEY]: configHash(spec) },
          // "auto" keeps Nova's own network selection, pass the cluster network once ServerSpec names one
          networks: "auto"
        },
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
    // if boot never reaches ACTIVE, tear the half-built server down rather than leaving it wedged for the next apply
    const detail = yield* _waitActive(options, id).pipe(
      Effect.flatMap(() => _serverDetail(options, id)),
      Effect.onError(() => Effect.ignore(_deleteServerById(options, id)))
    )
    return { id, name: spec.name, ip: detail.ip }
  })


interface TaggedServer extends Named {
  readonly metadata?: { readonly [key: string]: string } | undefined
}

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

const _findLoadBalancer = (options: CloudProviderOptions): R<Vip | undefined> =>
  Effect.gen(function*() {
    const client = yield* octaviaClient(options.region)
    const listed = yield* client["load-balancers"].lbaasLoadbalancersGet({}).pipe(
      Effect.mapError(_at("load-balancer", _LOAD_BALANCERS))
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

// Octavia ACCEPTS a delete without performing one: the LB enters PENDING_DELETE and keeps its VIP port until amphora teardown finishes, must
// wait or NetworkInUse 409s
const _lbStatus = (options: CloudProviderOptions): R<string> =>
  _findLoadBalancer(options).pipe(
    Effect.map((found) => found === undefined ? "DELETED" : found.provisioning_status ?? "UNKNOWN")
  )

const _waitLbGone = (options: CloudProviderOptions): R<void> =>
  pollUntil({
    check: _lbStatus(options),
    isDone: (status) => status === "DELETED",
    interval: "2 seconds",
    timeout: "10 minutes",
    kind: "load-balancer",
    ref: _name(options)
  }).pipe(Effect.asVoid)

const _deleteLoadBalancer = (options: CloudProviderOptions): R<void> =>
  Effect.gen(function*() {
    const found = yield* _findLoadBalancer(options)
    if (found === undefined) return
    const client = yield* octaviaClient(options.region)
    yield* _ignoreMissing(
      client["load-balancers"].lbaasLoadbalancersLoadbalancerIdDelete({
        params: { loadbalancer_id: _idOf(found) },
        query: { cascade: true }
      }).pipe(Effect.mapError(_at("load-balancer", _LOAD_BALANCERS)))
    )
    yield* _waitLbGone(options)
  })

const _networkInUse = (id: string): ResourceConflict =>
  new ResourceConflict({
    kind: "network-in-use",
    ref: `network ${id} still has ports attached and was NOT deleted — something is still on it ` +
      `(a cluster, a load balancer or a server outside kumulo). Remove it, then re-run delete.`
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
      const id = _idOf(network)
      const subnets = yield* _listSubnets({ client, networkId: id })
      yield* deleteGateway({ options, subnetIds: subnets.map(_idOf).filter((subnetId) => subnetId !== "") })
      // deliberately not _ignoreConflict: swallowing this leaves a half-torn network behind and reports success
      yield* _ignoreMissing(
        client.networks.networksNetworkIdDelete({ params: { network_id: id } }).pipe(
          Effect.mapError(_at("network", "v2.0/networks"))
        )
      ).pipe(Effect.catchTag("ResourceConflict", () => Effect.fail(_networkInUse(id))))
    }
  })

// reverse dependency order: LB, floating IP, servers, server groups, security group, network
export const deleteByTag = ({ options }: { readonly options: CloudProviderOptions }): R<void> =>
  Effect.gen(function*() {
    yield* _deleteLoadBalancer(options)
    yield* releaseFloatingIp({ options })
    yield* _deleteServers(options)
    yield* _deleteServerGroups(options)
    yield* _deleteNetworking(options)
  })


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


export const CloudProviderLive = (options: CloudProviderOptions): Layer.Layer<CloudProvider, never, Deps> =>
  Layer.effect(
    CloudProvider,
    Effect.gen(function*() {
      const context = yield* Effect.context<Deps>()
      const run = <A>(effect: R<A>) => Effect.provide(effect, context)
      return {
        ensureNetwork: (spec: NetworkSpec) => run(ensureNetwork({ options, spec })),
        findNetwork: (spec: NetworkSpec) => run(findNetwork({ options, spec })),
        hasGateway: (spec: GatewayRef) => run(hasGateway({ options, name: spec.name })),
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
