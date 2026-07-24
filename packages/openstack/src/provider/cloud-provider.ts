import { CapabilityMissing, CloudProvider, ProvisioningTimeout, ResourceNotFound } from "@kumulo/core"
import type { CloudError } from "@kumulo/core"
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
import { KeystoneAuth } from "../auth/keystone-auth.ts"
import { restRequest } from "./rest.ts"
import {
  decodeListField,
  decodeSingleField,
  LoadBalancerRecord,
  NamedResource,
  ServerRecord
} from "./schemas.ts"
import { SecurityGroupRuleInput } from "./security-group-rules.ts"

export interface CloudProviderOptions {
  readonly tag: ClusterTag
  readonly region: string
  readonly octaviaEnabled: boolean
  readonly imageAliases: Record<string, string>
}

type Deps = KeystoneAuth | HttpClient.HttpClient
type R<A> = Effect.Effect<A, CloudError, Deps>

const _name = (options: CloudProviderOptions, suffix?: string): string =>
  suffix === undefined ? `kumulo-${options.tag}` : `kumulo-${options.tag}-${suffix}`

const _findByName = <A extends { readonly id?: string; readonly name?: string }>(
  { itemSchema, listField, name, path, region, service }: {
    readonly service: string
    readonly region: string
    readonly path: string
    readonly itemSchema: Schema.Codec<A, unknown>
    readonly listField: string
    readonly name: string
  }
): R<A | undefined> =>
  // kumulo: the server already filters by `?name=` — take the first hit
  // rather than re-filtering client-side by `.name` (fixtures/some OpenStack
  // list responses omit `name` on entries the caller doesn't otherwise use).
  restRequest({ service, region, path: `${path}?name=${encodeURIComponent(name)}`, method: "GET", kind: listField }).pipe(
    Effect.flatMap(decodeListField({ itemSchema, listField, kind: path })),
    Effect.map((records) => records[0])
  )

// ---- Network ----------------------------------------------------------

export const ensureNetwork = ({ options, spec }: { readonly options: CloudProviderOptions; readonly spec: NetworkSpec }): R<NetworkInfo> =>
  Effect.gen(function*() {
    const name = _name(options)
    const existing = yield* _findByName({ itemSchema: NamedResource, service: "network", region: options.region, path: "v2.0/networks", listField: "networks", name })
    if (existing !== undefined) return { id: existing.id ?? "", cidr: spec.cidr }
    const created = yield* restRequest({
      service: "network",
      region: options.region,
      path: "v2.0/networks",
      method: "POST",
      body: { network: { name } },
      kind: "network"
    }).pipe(Effect.flatMap(decodeSingleField({ itemSchema: NamedResource, field: "network", kind: "v2.0/networks" })))
    yield* restRequest({
      service: "network",
      region: options.region,
      path: "v2.0/subnets",
      method: "POST",
      body: { subnet: { network_id: created.id ?? "", cidr: spec.cidr, ip_version: 4 } },
      kind: "subnet",
      okStatuses: [409]
    })
    return { id: created.id ?? "", cidr: spec.cidr }
  })

// ---- Security groups ---------------------------------------------------

const _decodeRule = (rule: unknown): Effect.Effect<SecurityGroupRuleInput, CloudError> =>
  Schema.decodeUnknownEffect(SecurityGroupRuleInput)(rule).pipe(
    Effect.mapError(() => new ResourceNotFound({ kind: "secgroup-rule", ref: JSON.stringify(rule) }))
  )

const _applyRule = (
  { groupId, options, rule }: { readonly options: CloudProviderOptions; readonly groupId: string; readonly rule: SecurityGroupRuleInput }
): Effect.Effect<void, CloudError, Deps> =>
  restRequest({
    service: "network",
    region: options.region,
    path: "v2.0/security-group-rules",
    method: "POST",
    kind: "security-group-rule",
    // kumulo: 409 = rule already present — idempotent re-apply, not an error.
    okStatuses: [409],
    body: {
      security_group_rule: {
        security_group_id: groupId,
        direction: "ingress",
        protocol: rule.protocol === "any" ? undefined : rule.protocol,
        port_range_min: rule.portMin,
        port_range_max: rule.portMax,
        remote_ip_prefix: rule.remoteCidr,
        remote_group_id: rule.remoteGroupSelf === true ? groupId : undefined
      }
    }
  }).pipe(Effect.asVoid)

export const ensureSecurityGroups = (
  { options, spec }: { readonly options: CloudProviderOptions; readonly spec: SecGroupSpec }
): R<SecGroupInfo> =>
  Effect.gen(function*() {
    const name = _name(options)
    const existing = yield* _findByName({ itemSchema: NamedResource, service: "network", region: options.region, path: "v2.0/security-groups", listField: "security_groups", name })
    const groupId = existing !== undefined
      ? existing.id ?? ""
      : (yield* restRequest({ service: "network", region: options.region, path: "v2.0/security-groups", method: "POST", body: { security_group: { name } }, kind: "security-group" }).pipe(
        Effect.flatMap(decodeSingleField({ itemSchema: NamedResource, field: "security_group", kind: "v2.0/security-groups" }))
      )).id ?? ""
    const rules = yield* Effect.forEach(spec.rules, _decodeRule)
    yield* Effect.forEach(rules, (rule) => _applyRule({ options, groupId, rule }), { discard: true })
    return { id: groupId }
  })

// ---- Server groups (D8: soft-anti-affinity per role) -------------------

export type ServerGroupRole = "master" | "worker"

// ponytail: granularity is masters-vs-workers only (ServerSpec carries no
// pool id) — split per worker pool once the port grows one.
export const ensureServerGroups = (
  { options, role }: { readonly options: CloudProviderOptions; readonly role: ServerGroupRole }
): R<string> =>
  Effect.gen(function*() {
    const name = _name(options, `${role}s`)
    const existing = yield* _findByName({ itemSchema: NamedResource, service: "compute", region: options.region, path: "v2.1/os-server-groups", listField: "server_groups", name })
    if (existing !== undefined) return existing.id ?? ""
    const created = yield* restRequest({
      service: "compute",
      region: options.region,
      path: "v2.1/os-server-groups",
      method: "POST",
      body: { server_group: { name, policy: "soft-anti-affinity" } },
      kind: "server-group"
    }).pipe(Effect.flatMap(decodeSingleField({ itemSchema: NamedResource, field: "server_group", kind: "v2.1/os-server-groups" })))
    return created.id ?? ""
  })

// ---- Load balancer (Octavia, capability-gated) --------------------------

export const ensureLoadBalancer = (
  { options, spec }: { readonly options: CloudProviderOptions; readonly spec: LbSpec }
): R<LbInfo> =>
  Effect.gen(function*() {
    if (!options.octaviaEnabled) {
      return yield* Effect.fail(new CapabilityMissing({ capability: "octavia", region: options.region }))
    }
    const name = _name(options)
    const existing = yield* _findByName({ itemSchema: LoadBalancerRecord, service: "load-balancer", region: options.region, path: "v2/lbaas/loadbalancers", listField: "loadbalancers", name })
    if (existing !== undefined) return { id: existing.id ?? "", vip: existing.vip_address ?? "" }
    const created = yield* restRequest({
      service: "load-balancer",
      region: options.region,
      path: "v2/lbaas/loadbalancers",
      method: "POST",
      body: { loadbalancer: { name, members: spec.members } },
      kind: "load-balancer"
    }).pipe(Effect.flatMap(decodeSingleField({ itemSchema: LoadBalancerRecord, field: "loadbalancer", kind: "v2/lbaas/loadbalancers" })))
    return { id: created.id ?? "", vip: created.vip_address ?? "" }
  })

// ---- Servers -------------------------------------------------------------

const _serverStatus = (options: CloudProviderOptions, id: string): R<string> =>
  restRequest({ service: "compute", region: options.region, path: `v2.1/servers/${id}`, method: "GET", kind: "server" }).pipe(
    Effect.flatMap(decodeSingleField({ itemSchema: ServerRecord, field: "server", kind: "v2.1/servers" })),
    Effect.map((server) => server.status ?? "UNKNOWN")
  )

const _waitActive = (options: CloudProviderOptions, id: string): R<void> =>
  _serverStatus(options, id).pipe(
    Effect.repeat({ schedule: Schedule.spaced("2 seconds"), times: 150, while: (status) => status !== "ACTIVE" && status !== "ERROR" }),
    Effect.flatMap((status) =>
      status === "ACTIVE" ? Effect.void : Effect.fail(new ProvisioningTimeout({ kind: "server", ref: id, lastStatus: status }))
    )
  )

const _serverIp = (server: ServerRecord): string => {
  const addresses = server.addresses ?? {}
  const firstNetwork = Object.values(addresses)[0]
  const firstAddress = firstNetwork?.find((candidate) => candidate.addr !== undefined)
  return firstAddress?.addr ?? ""
}

export const ensureServer = ({ options, spec }: { readonly options: CloudProviderOptions; readonly spec: ServerSpec }): R<ServerInfo> =>
  Effect.gen(function*() {
    const existing = yield* _findByName({ itemSchema: ServerRecord, service: "compute", region: options.region, path: "v2.1/servers", listField: "servers", name: spec.name })
    if (existing !== undefined) {
      yield* _waitActive(options, existing.id ?? "")
      return { id: existing.id ?? "", name: spec.name, ip: _serverIp(existing) }
    }
    const groupId = yield* ensureServerGroups({ options, role: spec.role })
    const created = yield* restRequest({
      service: "compute",
      region: options.region,
      path: "v2.1/servers",
      method: "POST",
      kind: "server",
      body: {
        server: { name: spec.name, imageRef: spec.image, flavorRef: spec.flavor, tags: [spec.tag], scheduler_hints: { group: groupId } }
      }
    }).pipe(Effect.flatMap(decodeSingleField({ itemSchema: ServerRecord, field: "server", kind: "v2.1/servers" })))
    const id = created.id ?? ""
    yield* _waitActive(options, id)
    const detail = yield* restRequest({ service: "compute", region: options.region, path: `v2.1/servers/${id}`, method: "GET", kind: "server" }).pipe(
      Effect.flatMap(decodeSingleField({ itemSchema: ServerRecord, field: "server", kind: "v2.1/servers" }))
    )
    return { id, name: spec.name, ip: _serverIp(detail) }
  })

const _waitGone = (options: CloudProviderOptions, id: string): R<void> =>
  _serverStatus(options, id).pipe(
    Effect.repeat({ schedule: Schedule.spaced("2 seconds"), times: 150 }),
    Effect.flatMap(() => Effect.fail(new ProvisioningTimeout({ kind: "server", ref: id, lastStatus: "still present" }))),
    Effect.catchTag("ResourceNotFound", () => Effect.void)
  )

// FR-2.7 — deletes a single server and waits until it's gone (404), for
// scale-down's per-worker teardown (whole-cluster `deleteByTag` doesn't wait).
export const deleteServer = ({ options, ref }: { readonly options: CloudProviderOptions; readonly ref: ServerInfo }): R<void> =>
  restRequest({ service: "compute", region: options.region, path: `v2.1/servers/${ref.id}`, method: "DELETE", kind: "server", okStatuses: [404] }).pipe(
    Effect.flatMap(() => _waitGone(options, ref.id))
  )

// ---- Inventory + delete --------------------------------------------------

const _listServersByTag = (options: CloudProviderOptions): R<ReadonlyArray<ServerRecord>> =>
  restRequest({ service: "compute", region: options.region, path: `v2.1/servers?tags=${encodeURIComponent(options.tag)}`, method: "GET", kind: "server" }).pipe(
    Effect.flatMap(decodeListField({ itemSchema: ServerRecord, listField: "servers", kind: "v2.1/servers" }))
  )

export const listClusterResources = ({ options }: { readonly options: CloudProviderOptions }): R<Inventory> =>
  Effect.gen(function*() {
    const serverRecords = yield* _listServersByTag(options)
    const network = yield* _findByName({ itemSchema: NamedResource, service: "network", region: options.region, path: "v2.0/networks", listField: "networks", name: _name(options) })
    const secGroup = yield* _findByName({ itemSchema: NamedResource, service: "network", region: options.region, path: "v2.0/security-groups", listField: "security_groups", name: _name(options) })
    const lb = yield* _findByName({ itemSchema: LoadBalancerRecord, service: "load-balancer", region: options.region, path: "v2/lbaas/loadbalancers", listField: "loadbalancers", name: _name(options) })
    return {
      servers: serverRecords.map((record) => ({ id: record.id ?? "", name: record.name ?? "", ip: _serverIp(record) })),
      networks: network === undefined ? [] : [{ id: network.id ?? "", cidr: "" }],
      securityGroups: secGroup === undefined ? [] : [{ id: secGroup.id ?? "" }],
      loadBalancers: lb === undefined ? [] : [{ id: lb.id ?? "", vip: lb.vip_address ?? "" }]
    }
  })

const _deleteServers = (options: CloudProviderOptions): R<void> =>
  _listServersByTag(options).pipe(
    Effect.flatMap((servers) =>
      Effect.forEach(
        servers,
        (record) => restRequest({ service: "compute", region: options.region, path: `v2.1/servers/${record.id ?? ""}`, method: "DELETE", kind: "server", okStatuses: [404] }),
        { discard: true }
      )
    )
  )

const _serverGroupRoles: ReadonlyArray<ServerGroupRole> = ["master", "worker"]

const _deleteServerGroups = (options: CloudProviderOptions): R<void> =>
  Effect.forEach(
    _serverGroupRoles,
    (role) =>
      _findByName({ itemSchema: NamedResource, service: "compute", region: options.region, path: "v2.1/os-server-groups", listField: "server_groups", name: _name(options, `${role}s`) }).pipe(
        Effect.flatMap((group) =>
          group === undefined
            ? Effect.void
            : restRequest({ service: "compute", region: options.region, path: `v2.1/os-server-groups/${group.id ?? ""}`, method: "DELETE", kind: "server-group", okStatuses: [404] })
        )
      ),
    { discard: true }
  )

const _deleteIfExists = (
  { deleteSuffix, itemSchema, listField, options, path, service }: {
    readonly service: string
    readonly path: string
    readonly itemSchema: Schema.Codec<NamedResource, unknown>
    readonly listField: string
    readonly options: CloudProviderOptions
    readonly deleteSuffix?: string
  }
): R<void> =>
  _findByName({ itemSchema, service, region: options.region, path, listField, name: _name(options) }).pipe(
    Effect.flatMap((found) =>
      found === undefined
        ? Effect.void
        : restRequest({ service, region: options.region, path: `${path}/${found.id ?? ""}${deleteSuffix ?? ""}`, method: "DELETE", kind: listField, okStatuses: [404] })
    )
  )

// kumulo: reverse dependency order — LB, servers, server groups, security group, network.
export const deleteByTag = ({ options }: { readonly options: CloudProviderOptions }): R<void> =>
  Effect.gen(function*() {
    yield* _deleteIfExists({ service: "load-balancer", path: "v2/lbaas/loadbalancers", listField: "loadbalancers", itemSchema: NamedResource, deleteSuffix: "?cascade=true", options })
    yield* _deleteServers(options)
    yield* _deleteServerGroups(options)
    yield* _deleteIfExists({ service: "network", path: "v2.0/security-groups", listField: "security_groups", itemSchema: NamedResource, options })
    yield* _deleteIfExists({ service: "network", path: "v2.0/networks", listField: "networks", itemSchema: NamedResource, options })
  })

// ---- Image / flavor resolution: alias -> exact -> fuzzy (+warn) ---------

const _fuzzyMatch = (entries: ReadonlyArray<NamedResource>, ref: string): NamedResource | undefined =>
  entries.find((entry) => (entry.name ?? "").toLowerCase().includes(ref.toLowerCase()))

export const resolveImage = ({ options, ref }: { readonly options: CloudProviderOptions; readonly ref: string }): R<string> =>
  Effect.gen(function*() {
    const wanted = options.imageAliases[ref] ?? ref
    const exact = yield* _findByName({ itemSchema: NamedResource, service: "image", region: options.region, path: "v2/images", listField: "images", name: wanted })
    if (exact !== undefined) return exact.id ?? ""
    const all = yield* restRequest({ service: "image", region: options.region, path: "v2/images", method: "GET", kind: "image" }).pipe(
      Effect.flatMap(decodeListField({ itemSchema: NamedResource, listField: "images", kind: "v2/images" }))
    )
    const fuzzy = _fuzzyMatch(all, wanted)
    if (fuzzy === undefined) return yield* Effect.fail(new ResourceNotFound({ kind: "image", ref }))
    yield* Effect.logWarning(`image "${wanted}" matched by fuzzy lookup: "${fuzzy.name ?? ""}"`)
    return fuzzy.id ?? ""
  })

export const resolveFlavor = ({ options, ref }: { readonly options: CloudProviderOptions; readonly ref: string }): R<string> =>
  Effect.gen(function*() {
    const exact = yield* _findByName({ itemSchema: NamedResource, service: "compute", region: options.region, path: "v2.1/flavors", listField: "flavors", name: ref })
    if (exact !== undefined) return exact.id ?? ""
    const all = yield* restRequest({ service: "compute", region: options.region, path: "v2.1/flavors/detail", method: "GET", kind: "flavor" }).pipe(
      Effect.flatMap(decodeListField({ itemSchema: NamedResource, listField: "flavors", kind: "v2.1/flavors/detail" }))
    )
    const fuzzy = _fuzzyMatch(all, ref)
    if (fuzzy === undefined) return yield* Effect.fail(new ResourceNotFound({ kind: "flavor", ref }))
    yield* Effect.logWarning(`flavor "${ref}" matched by fuzzy lookup: "${fuzzy.name ?? ""}"`)
    return fuzzy.id ?? ""
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
