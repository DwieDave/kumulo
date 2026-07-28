import { CloudProvider, CONFIG_HASH_KEY, configHash, pollUntil, ResourceNotFound } from "@kumulo/core"
import type { CloudError } from "@kumulo/core"
import type {
  ClusterTag,
  Inventory,
  LbInfo,
  LbSpec,
  NetworkInfo,
  NetworkSpec,
  SecGroupInfo,
  SecGroupRule,
  SecGroupSpec,
  ServerInfo,
  ServerSpec
} from "@kumulo/core"
import { Effect, Layer } from "effect"
import type { HttpClient } from "effect/unstable/http"
import { makeHcloudClient, type HcloudClient } from "../client/hcloud.ts"
import { networkZoneForLocation } from "../profile/locations.ts"
import { waitForAction } from "./actions.ts"
import { ignoreMissing, mapHcloudError, required, type ErrorContext, type HcloudError } from "./errors.ts"
import type { HcloudFirewallRuleInput } from "./firewall-rules.ts"
import { listAll } from "./paginate.ts"

export interface CloudProviderOptions {
  readonly tag: ClusterTag
  readonly location: string
}

type Deps = HttpClient.HttpClient
type R<A> = Effect.Effect<A, CloudError, Deps>

// kumulo: one flat label (`kumulo-cluster=<tag>`) drives idempotent lookup,
// bulk teardown, and inventory listing uniformly across every resource kind
// (R7 — simpler than OpenStack's three separate tagging mechanisms since
// hcloud's `label_selector` works the same way on every list endpoint).
const _name = (options: CloudProviderOptions, suffix?: string): string =>
  suffix === undefined ? `kumulo-${options.tag}` : `kumulo-${options.tag}-${suffix}`
const _clusterLabel = (options: CloudProviderOptions): Record<string, string> => ({ "kumulo-cluster": options.tag })
const _labelSelector = (options: CloudProviderOptions): string => `kumulo-cluster=${options.tag}`

const _ctx = (kind: string, ref: string): ErrorContext => ({ kind, ref })

// ---- Network ----------------------------------------------------------

const _findNetwork = (client: HcloudClient, name: string) =>
  mapHcloudError({ self: client.Networks.listNetworks({ query: { name } }), ctx: _ctx("network", name) }).pipe(
    Effect.map((response) => response.networks[0])
  )

/**
 * Read-only counterpart of `ensureNetwork` (R8). hcloud subnets carry no id of
 * their own, so — exactly as `ensureNetwork` does — the result reports the
 * network only and leaves the subnet-id slots absent.
 */
export const findNetwork = (
  { options, spec }: { readonly options: CloudProviderOptions; readonly spec: NetworkSpec }
): R<NetworkInfo | undefined> =>
  Effect.gen(function*() {
    const client = yield* makeHcloudClient
    const existing = yield* _findNetwork(client, _name(options))
    return existing === undefined ? undefined : { id: String(existing.id), cidr: spec.cidr }
  })

export const ensureNetwork = ({ options, spec }: { readonly options: CloudProviderOptions; readonly spec: NetworkSpec }): R<NetworkInfo> =>
  Effect.gen(function*() {
    const client = yield* makeHcloudClient
    const name = _name(options)
    const existing = yield* _findNetwork(client, name)
    if (existing !== undefined) return { id: String(existing.id), cidr: spec.cidr }
    // kumulo: network zone derived from the location internally (D2) — no
    // `NetworkSpec` change for one provider's constraint.
    const network_zone = networkZoneForLocation(options.location) ?? ""
    const created = yield* mapHcloudError({
      self: client.Networks.createNetwork({
        payload: {
          name,
          ip_range: spec.cidr,
          labels: _clusterLabel(options),
          subnets: [{ type: "cloud", ip_range: spec.cidr, network_zone }]
        }
      }),
      ctx: _ctx("network", name)
    })
    const decoded = yield* required({ value: created.network, kind: "network", ref: name })
    return { id: String(decoded.id), cidr: spec.cidr }
  })

// ---- Security groups (Hetzner Firewalls) --------------------------------

// kumulo: hcloud Firewalls speak `direction`/`port`/`source_ips` and know no
// `any` protocol nor a security-group self-reference, so core's neutral
// `SecGroupRule` is translated here (the two shapes it cannot express are
// rejected rather than silently widened).
const _portRange = (rule: SecGroupRule): string | undefined => {
  if (rule.protocol === "icmp" || rule.portMin === undefined) return undefined
  const max = rule.portMax ?? rule.portMin
  return max === rule.portMin ? `${rule.portMin}` : `${rule.portMin}-${max}`
}

const _hcloudRule = (
  { cidr, port, protocol }: { readonly protocol: "tcp" | "udp" | "icmp"; readonly port: string | undefined; readonly cidr: string }
): HcloudFirewallRuleInput => ({
  direction: "in",
  protocol,
  ...(port === undefined ? {} : { port }),
  sourceCidrs: [cidr]
})

const _toHcloudRule = (rule: SecGroupRule): Effect.Effect<HcloudFirewallRuleInput, CloudError> =>
  rule.protocol === "any" || rule.remoteCidr === undefined
    ? Effect.fail(new ResourceNotFound({ kind: "firewall-rule", ref: JSON.stringify(rule) }))
    : Effect.succeed(_hcloudRule({ protocol: rule.protocol, port: _portRange(rule), cidr: rule.remoteCidr }))

type FirewallRuleWire = { readonly direction: "in" | "out"; readonly protocol: "tcp" | "udp" | "icmp"; readonly source_ips: ReadonlyArray<string>; readonly port?: string }

const _toHcloudWire = (rule: HcloudFirewallRuleInput): FirewallRuleWire => ({
  direction: rule.direction,
  protocol: rule.protocol,
  source_ips: rule.sourceCidrs,
  ...(rule.port === undefined ? {} : { port: rule.port })
})

const _ensureFirewallId = (
  { client, options, rules }: { readonly client: HcloudClient; readonly options: CloudProviderOptions; readonly rules: ReadonlyArray<FirewallRuleWire> }
): R<number> =>
  Effect.gen(function*() {
    const name = _name(options)
    const found = yield* mapHcloudError({ self: client.Firewalls.listFirewalls({ query: { name } }), ctx: _ctx("firewall", name) })
    const existing = found.firewalls[0]
    if (existing !== undefined) return existing.id
    const created = yield* mapHcloudError({
      self: client.Firewalls.createFirewall({ payload: { name, labels: _clusterLabel(options), rules } }),
      ctx: _ctx("firewall", name)
    })
    return (yield* required({ value: created.firewall, kind: "firewall", ref: name })).id
  })

export const ensureSecurityGroups = (
  { options, spec }: { readonly options: CloudProviderOptions; readonly spec: SecGroupSpec }
): R<SecGroupInfo> =>
  Effect.gen(function*() {
    const client = yield* makeHcloudClient
    const translated = yield* Effect.forEach(spec.rules, _toHcloudRule)
    const rules = translated.map(_toHcloudWire)
    const id = yield* _ensureFirewallId({ client, options, rules })
    // kumulo: heal drifted rules on every re-run (N1) — hcloud's set_rules
    // action is a full replace, no per-rule diff endpoint to reuse instead.
    yield* mapHcloudError({
      self: client["Firewall Actions"].setFirewallRules({ params: { id }, payload: { rules } }),
      ctx: _ctx("firewall", String(id))
    })
    return { id: String(id) }
  })

// ---- Load balancer (native Hetzner product) -----------------------------

const _findLoadBalancer = (client: HcloudClient, name: string) =>
  mapHcloudError({ self: client["Load Balancers"].listLoadBalancers({ query: { name } }), ctx: _ctx("load-balancer", name) }).pipe(
    Effect.map((response) => response.load_balancers[0])
  )

export const ensureLoadBalancer = (
  { options, spec: _spec }: { readonly options: CloudProviderOptions; readonly spec: LbSpec }
): R<LbInfo> =>
  Effect.gen(function*() {
    const client = yield* makeHcloudClient
    const name = _name(options)
    const existing = yield* _findLoadBalancer(client, name)
    if (existing !== undefined) return { id: String(existing.id), vip: existing.public_net.ipv4.ip ?? "" }
    const created = yield* mapHcloudError({
      self: client["Load Balancers"].createLoadBalancer({
        payload: {
          name,
          load_balancer_type: "lb11",
          location: options.location,
          labels: _clusterLabel(options),
          // kumulo: target-by-label (R7's uniform label_selector) instead of
          // `spec.members` — every server labeled `kumulo-cluster=<tag>` is
          // added/removed automatically as it comes and goes, no explicit
          // add/remove-target call needed (unlike OpenStack's Octavia members).
          targets: [{ type: "label_selector", label_selector: { selector: _labelSelector(options) } }]
        }
      }),
      ctx: _ctx("load-balancer", name)
    })
    return { id: String(created.load_balancer.id), vip: created.load_balancer.public_net.ipv4.ip ?? "" }
  })

// ---- Servers -------------------------------------------------------------

export type ServerGroupRole = "master" | "worker"

// ponytail: granularity is masters-vs-workers only (`ServerSpec` carries no
// pool id) — split per worker pool once the port grows one, same limitation
// `@kumulo/openstack`'s `ensureServerGroups` already documents.
export const ensurePlacementGroup = (
  { options, role }: { readonly options: CloudProviderOptions; readonly role: ServerGroupRole }
): R<number> =>
  Effect.gen(function*() {
    const client = yield* makeHcloudClient
    const name = _name(options, `${role}s`)
    const found = yield* mapHcloudError({
      self: client["Placement Groups"].listPlacementGroups({ query: { name } }),
      ctx: _ctx("placement-group", name)
    })
    const existing = found.placement_groups[0]
    if (existing !== undefined) return existing.id
    // ponytail: the 10-server-per-group hard cap (R9/D7) isn't enforced here —
    // D7 is an OPEN design choice (hard-fail vs auto-split) out of this task's
    // scope; add the pre-flight check once that's decided.
    const created = yield* mapHcloudError({
      self: client["Placement Groups"].createPlacementGroup({ payload: { name, type: "spread", labels: _clusterLabel(options) } }),
      ctx: _ctx("placement-group", name)
    })
    return created.placement_group.id
  })

interface ServerRecord {
  readonly id: number
  readonly name: string
  readonly status: string
  readonly public_net: { readonly ipv4: { readonly ip: string } | null }
  readonly labels?: { readonly [key: string]: string | undefined } | undefined
}

// Servers created before hash stamping carry no label -> `undefined` (unknown), not "".
const _hashOf = (server: ServerRecord): string | undefined => server.labels?.[CONFIG_HASH_KEY]

const _serverIp = (server: ServerRecord): string => server.public_net.ipv4?.ip ?? ""

const _findServer = (client: HcloudClient, name: string): R<ServerRecord | undefined> =>
  mapHcloudError({ self: client.Servers.listServers({ query: { name } }), ctx: _ctx("server", name) }).pipe(
    Effect.map((response) => response.servers[0])
  )

const _getServer = ({ client, id }: { readonly client: HcloudClient; readonly id: number }): R<ServerRecord> =>
  mapHcloudError({ self: client.Servers.getServer({ params: { id } }), ctx: _ctx("server", String(id)) }).pipe(
    Effect.flatMap((response) => required({ value: response.server, kind: "server", ref: String(id) }))
  )

const _waitServerRunning = ({ client, id }: { readonly client: HcloudClient; readonly id: number }): R<ServerRecord> =>
  pollUntil({
    check: _getServer({ client, id }),
    isDone: (server) => server.status === "running",
    interval: "2 seconds",
    timeout: "5 minutes",
    kind: "server",
    ref: String(id)
  })

const _createServer = (
  { client, groupId, options, spec }: {
    readonly client: HcloudClient
    readonly options: CloudProviderOptions
    readonly spec: ServerSpec
    readonly groupId: number
  }
) =>
  mapHcloudError({
    self: client.Servers.createServer({
      payload: {
        name: spec.name,
        server_type: spec.flavor,
        image: spec.image,
        location: options.location,
        placement_group: groupId,
        labels: { ..._clusterLabel(options), "kumulo-role": spec.role, [CONFIG_HASH_KEY]: configHash(spec) }
      }
    }),
    ctx: _ctx("server", spec.name)
  })

export const ensureServer = ({ options, spec }: { readonly options: CloudProviderOptions; readonly spec: ServerSpec }): R<ServerInfo> =>
  Effect.gen(function*() {
    const client = yield* makeHcloudClient
    const existing = yield* _findServer(client, spec.name)
    if (existing !== undefined) {
      const settled = yield* _waitServerRunning({ client, id: existing.id })
      return { id: String(settled.id), name: spec.name, ip: _serverIp(settled) }
    }
    const groupId = yield* ensurePlacementGroup({ options, role: spec.role })
    const created = yield* _createServer({ client, options, spec, groupId })
    yield* waitForAction({ client, actionId: created.action.id })
    return { id: String(created.server.id), name: spec.name, ip: _serverIp(created.server) }
  })

// kumulo: deletes a single server and waits until its (async) delete Action
// completes, for scale-down's per-worker teardown — whole-cluster
// `deleteByTag` doesn't wait per-server (bulk teardown, see `_deleteServersByTag`).
export const deleteServer = (ref: ServerInfo): R<void> =>
  Effect.gen(function*() {
    const client = yield* makeHcloudClient
    const id = Number(ref.id)
    const deleted = yield* mapHcloudError({ self: client.Servers.deleteServer({ params: { id } }), ctx: _ctx("server", ref.id) }).pipe(
      Effect.catchTag("ResourceNotFound", () => Effect.succeed(undefined))
    )
    if (deleted?.action !== undefined) yield* waitForAction({ client, actionId: deleted.action.id })
  })

// ---- Inventory + delete --------------------------------------------------

const _labeledServers = ({ client, options }: { readonly client: HcloudClient; readonly options: CloudProviderOptions }): R<ReadonlyArray<ServerRecord>> =>
  listAll((query) =>
    mapHcloudError({
      self: client.Servers.listServers({ query: { ...query, label_selector: _labelSelector(options) } }),
      ctx: _ctx("server", options.tag)
    }).pipe(Effect.map((response) => ({ items: response.servers, meta: response.meta })))
  )

export const listClusterResources = ({ options }: { readonly options: CloudProviderOptions }): R<Inventory> =>
  Effect.gen(function*() {
    const client = yield* makeHcloudClient
    const label_selector = _labelSelector(options)
    const [servers, networks, firewalls, lbs] = yield* Effect.all([
      _labeledServers({ client, options }),
      listAll((query) =>
        mapHcloudError({ self: client.Networks.listNetworks({ query: { ...query, label_selector } }), ctx: _ctx("network", options.tag) })
          .pipe(Effect.map((r) => ({ items: r.networks, meta: r.meta })))
      ),
      listAll((query) =>
        mapHcloudError({ self: client.Firewalls.listFirewalls({ query: { ...query, label_selector } }), ctx: _ctx("firewall", options.tag) })
          .pipe(Effect.map((r) => ({ items: r.firewalls, meta: r.meta })))
      ),
      listAll((query) =>
        mapHcloudError({
          self: client["Load Balancers"].listLoadBalancers({ query: { ...query, label_selector } }),
          ctx: _ctx("load-balancer", options.tag)
        }).pipe(Effect.map((r) => ({ items: r.load_balancers, meta: r.meta })))
      )
    ], { concurrency: 4 })
    return {
      servers: servers.map((s) => ({ id: String(s.id), name: s.name, ip: _serverIp(s), configHash: _hashOf(s) })),
      networks: networks.map((n) => ({ id: String(n.id), cidr: "" })),
      securityGroups: firewalls.map((f) => ({ id: String(f.id) })),
      loadBalancers: lbs.map((l) => ({ id: String(l.id), vip: l.public_net.ipv4.ip ?? "" }))
    }
  })

const _deleteServersByTag = ({ client, options }: { readonly client: HcloudClient; readonly options: CloudProviderOptions }): R<void> =>
  _labeledServers({ client, options }).pipe(
    Effect.flatMap((servers) =>
      Effect.forEach(servers, (s) => deleteServer({ id: String(s.id), name: s.name, ip: "" }), { discard: true })
    )
  )

const _deleteIfExists = (
  { find, remove }: {
    readonly find: R<{ readonly id: number } | undefined>
    readonly remove: (id: number) => Effect.Effect<unknown, HcloudError, Deps>
  }
): R<void> =>
  find.pipe(Effect.flatMap((found) => found === undefined ? Effect.void : ignoreMissing(remove(found.id))))

const _placementGroupRoles: ReadonlyArray<ServerGroupRole> = ["master", "worker"]

const _findPlacementGroup = (client: HcloudClient, name: string) =>
  mapHcloudError({ self: client["Placement Groups"].listPlacementGroups({ query: { name } }), ctx: _ctx("placement-group", name) }).pipe(
    Effect.map((response) => response.placement_groups[0])
  )

const _findFirewall = (client: HcloudClient, name: string) =>
  mapHcloudError({ self: client.Firewalls.listFirewalls({ query: { name } }), ctx: _ctx("firewall", name) }).pipe(
    Effect.map((response) => response.firewalls[0])
  )

// kumulo: reverse dependency order — LB, servers, placement groups, firewall, network.
export const deleteByTag = ({ options }: { readonly options: CloudProviderOptions }): R<void> =>
  Effect.gen(function*() {
    const client = yield* makeHcloudClient
    const name = _name(options)
    yield* _deleteIfExists({
      find: _findLoadBalancer(client, name),
      remove: (id) => mapHcloudError({ self: client["Load Balancers"].deleteLoadBalancer({ params: { id } }), ctx: _ctx("load-balancer", name) })
    })
    yield* _deleteServersByTag({ client, options })
    yield* Effect.forEach(_placementGroupRoles, (role) => {
      const groupName = _name(options, `${role}s`)
      return _deleteIfExists({
        find: _findPlacementGroup(client, groupName),
        remove: (id) =>
          mapHcloudError({ self: client["Placement Groups"].deletePlacementGroup({ params: { id } }), ctx: _ctx("placement-group", groupName) })
      })
    }, { discard: true })
    yield* _deleteIfExists({
      find: _findFirewall(client, name),
      remove: (id) => mapHcloudError({ self: client.Firewalls.deleteFirewall({ params: { id } }), ctx: _ctx("firewall", name) })
    })
    yield* _deleteIfExists({
      find: _findNetwork(client, name),
      remove: (id) => mapHcloudError({ self: client.Networks.deleteNetwork({ params: { id } }), ctx: _ctx("network", name) })
    })
  })

// ---- Image / flavor resolution: exact name -> fuzzy (+warn) -------------

interface NamedRecord {
  readonly id: number
  readonly name: string | null
}

const _fuzzyMatch = (entries: ReadonlyArray<NamedRecord>, ref: string): NamedRecord | undefined =>
  entries.find((entry) => entry.name?.toLowerCase().includes(ref.toLowerCase()) === true)

const _resolved = <A extends NamedRecord>(
  { entries, kind, ref }: { readonly entries: ReadonlyArray<A>; readonly kind: string; readonly ref: string }
): R<string> => {
  const fuzzy = _fuzzyMatch(entries, ref)
  if (fuzzy === undefined) return Effect.fail(new ResourceNotFound({ kind, ref }))
  return Effect.logWarning(`${kind} "${ref}" matched by fuzzy lookup: "${fuzzy.name}"`).pipe(Effect.as(String(fuzzy.id)))
}

// kumulo: restricted to `type=system` — the only image kind this port
// resolves (OS base images for cluster nodes), and the only kind whose
// `name` is reliably non-null (snapshots/backups can have a null `name`).
export const resolveImage = ({ ref }: { readonly ref: string }): R<string> =>
  Effect.gen(function*() {
    const client = yield* makeHcloudClient
    const listImages = (query: { readonly page?: number; readonly per_page?: number }) =>
      mapHcloudError({ self: client.Images.listImages({ query: { ...query, type: ["system"], name: ref } }), ctx: _ctx("image", ref) })
    const exact = yield* listImages({}).pipe(Effect.map((response) => response.images[0]))
    if (exact !== undefined) return String(exact.id)
    const all = yield* listAll((query) =>
      mapHcloudError({ self: client.Images.listImages({ query: { ...query, type: ["system"] } }), ctx: _ctx("image", ref) })
        .pipe(Effect.map((r) => ({ items: r.images, meta: r.meta })))
    )
    return yield* _resolved({ entries: all, kind: "image", ref })
  })

export const resolveFlavor = ({ ref }: { readonly ref: string }): R<string> =>
  Effect.gen(function*() {
    const client = yield* makeHcloudClient
    const exact = yield* mapHcloudError({
      self: client["Server Types"].listServerTypes({ query: { name: ref } }),
      ctx: _ctx("flavor", ref)
    }).pipe(Effect.map((response) => response.server_types[0]))
    if (exact !== undefined) return String(exact.id)
    const all = yield* listAll((query) =>
      mapHcloudError({ self: client["Server Types"].listServerTypes({ query }), ctx: _ctx("flavor", ref) })
        .pipe(Effect.map((r) => ({ items: r.server_types, meta: r.meta })))
    )
    return yield* _resolved({ entries: all, kind: "flavor", ref })
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
        findNetwork: (spec: NetworkSpec) => run(findNetwork({ options, spec })),
        // hcloud networks reach the internet through each server's own public
        // interface and floating IPs attach straight to a server — there is no
        // gateway object, so there is never one to find.
        hasGateway: () => Effect.succeed(false),
        ensureSecurityGroups: (spec: SecGroupSpec) => run(ensureSecurityGroups({ options, spec })),
        ensureLoadBalancer: (spec: LbSpec) => run(ensureLoadBalancer({ options, spec })),
        ensureServer: (spec: ServerSpec) => run(ensureServer({ options, spec })),
        deleteServer: (ref: ServerInfo) => run(deleteServer(ref)),
        deleteByTag: (_tag: ClusterTag) => run(deleteByTag({ options })),
        listClusterResources: (_tag: ClusterTag) => run(listClusterResources({ options })),
        resolveImage: (ref: string) => run(resolveImage({ ref })),
        resolveFlavor: (ref: string) => run(resolveFlavor({ ref }))
      }
    })
  )
