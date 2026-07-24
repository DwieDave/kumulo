import { CloudProvider, pollUntil, ResourceNotFound } from "@kumulo/core"
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
import { Effect, Layer } from "effect"
import type { HttpClient } from "effect/unstable/http"
import * as Schema from "effect/Schema"
import { networkZoneForLocation } from "../profile/locations.ts"
import { HcloudFirewallRuleInput } from "./firewall-rules.ts"
import { waitForAction } from "./actions.ts"
import { decodeHcloud, decodeListField, decodeSingleField } from "./decode.ts"
import { hcloudRequest } from "./rest.ts"
import { HcloudLoadBalancerRecord, HcloudNamedResource, HcloudServerRecord, serverIp } from "./schemas.ts"

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

const _findByName = <A>(
  { itemSchema, listField, name, path }: {
    readonly path: string
    readonly listField: string
    readonly itemSchema: Schema.Codec<A, unknown>
    readonly name: string
  }
): R<A | undefined> =>
  hcloudRequest({ path: `${path}?name=${encodeURIComponent(name)}`, method: "GET", kind: path }).pipe(
    Effect.flatMap(decodeListField({ itemSchema, listField, kind: path })),
    Effect.map((records) => records[0])
  )

// ---- Network ----------------------------------------------------------

export const ensureNetwork = ({ options, spec }: { readonly options: CloudProviderOptions; readonly spec: NetworkSpec }): R<NetworkInfo> =>
  Effect.gen(function*() {
    const name = _name(options)
    const existing = yield* _findByName({ itemSchema: HcloudNamedResource, listField: "networks", path: "networks", name })
    if (existing !== undefined) return { id: String(existing.id), cidr: spec.cidr }
    // kumulo: network zone derived from the location internally (D2) — no
    // `NetworkSpec` change for one provider's constraint.
    const zone = networkZoneForLocation(options.location) ?? ""
    const created = yield* hcloudRequest({
      path: "networks",
      method: "POST",
      kind: "networks",
      body: { name, ip_range: spec.cidr, labels: _clusterLabel(options), subnets: [{ type: "cloud", ip_range: spec.cidr, network_zone: zone }] }
    }).pipe(Effect.flatMap(decodeSingleField({ itemSchema: HcloudNamedResource, field: "network", kind: "networks" })))
    return { id: String(created.id), cidr: spec.cidr }
  })

// ---- Security groups (Hetzner Firewalls) --------------------------------

const _decodeFirewallRule = (rule: unknown): Effect.Effect<HcloudFirewallRuleInput, CloudError> =>
  Schema.decodeUnknownEffect(HcloudFirewallRuleInput)(rule).pipe(
    Effect.mapError(() => new ResourceNotFound({ kind: "firewall-rule", ref: JSON.stringify(rule) }))
  )

const _toHcloudRule = (rule: HcloudFirewallRuleInput) => ({
  direction: rule.direction,
  protocol: rule.protocol,
  port: rule.port,
  source_ips: rule.sourceCidrs
})

const _ensureFirewallId = ({ hcloudRules, options }: { readonly options: CloudProviderOptions; readonly hcloudRules: ReadonlyArray<unknown> }): R<number> =>
  Effect.gen(function*() {
    const name = _name(options)
    const existing = yield* _findByName({ itemSchema: HcloudNamedResource, listField: "firewalls", path: "firewalls", name })
    if (existing !== undefined) return existing.id
    const created = yield* hcloudRequest({
      path: "firewalls",
      method: "POST",
      kind: "firewalls",
      body: { name, labels: _clusterLabel(options), rules: hcloudRules }
    }).pipe(Effect.flatMap(decodeSingleField({ itemSchema: HcloudNamedResource, field: "firewall", kind: "firewalls" })))
    return created.id
  })

export const ensureSecurityGroups = (
  { options, spec }: { readonly options: CloudProviderOptions; readonly spec: SecGroupSpec }
): R<SecGroupInfo> =>
  Effect.gen(function*() {
    const rules = yield* Effect.forEach(spec.rules, _decodeFirewallRule)
    const hcloudRules = rules.map(_toHcloudRule)
    const id = yield* _ensureFirewallId({ options, hcloudRules })
    // kumulo: heal drifted rules on every re-run (N1) — hcloud's set_rules
    // action is a full replace, no per-rule diff endpoint to reuse instead.
    yield* hcloudRequest({ path: `firewalls/${id}/actions/set_rules`, method: "POST", kind: "firewalls", body: { rules: hcloudRules } })
    return { id: String(id) }
  })

// ---- Load balancer (native Hetzner product) -----------------------------

export const ensureLoadBalancer = (
  { options, spec: _spec }: { readonly options: CloudProviderOptions; readonly spec: LbSpec }
): R<LbInfo> =>
  Effect.gen(function*() {
    const name = _name(options)
    const existing = yield* _findByName({ itemSchema: HcloudLoadBalancerRecord, listField: "load_balancers", path: "load_balancers", name })
    if (existing !== undefined) return { id: String(existing.id), vip: existing.public_net.ipv4.ip ?? "" }
    const created = yield* hcloudRequest({
      path: "load_balancers",
      method: "POST",
      kind: "load_balancers",
      body: {
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
    }).pipe(Effect.flatMap(decodeSingleField({ itemSchema: HcloudLoadBalancerRecord, field: "load_balancer", kind: "load_balancers" })))
    return { id: String(created.id), vip: created.public_net.ipv4.ip ?? "" }
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
    const name = _name(options, `${role}s`)
    const existing = yield* _findByName({ itemSchema: HcloudNamedResource, listField: "placement_groups", path: "placement_groups", name })
    if (existing !== undefined) return existing.id
    // ponytail: the 10-server-per-group hard cap (R9/D7) isn't enforced here —
    // D7 is an OPEN design choice (hard-fail vs auto-split) out of this task's
    // scope; add the pre-flight check once that's decided.
    const created = yield* hcloudRequest({
      path: "placement_groups",
      method: "POST",
      kind: "placement_groups",
      body: { name, type: "spread", labels: _clusterLabel(options) }
    }).pipe(Effect.flatMap(decodeSingleField({ itemSchema: HcloudNamedResource, field: "placement_group", kind: "placement_groups" })))
    return created.id
  })

const CreateServerResponse = Schema.Struct({ server: HcloudServerRecord, action: Schema.Struct({ id: Schema.Number }) })

const _createServer = (
  { groupId, options, spec }: { readonly options: CloudProviderOptions; readonly spec: ServerSpec; readonly groupId: number }
): R<typeof CreateServerResponse.Type> =>
  hcloudRequest({
    path: "servers",
    method: "POST",
    kind: "servers",
    body: {
      name: spec.name,
      server_type: spec.flavor,
      image: spec.image,
      location: options.location,
      placement_group: groupId,
      labels: { ..._clusterLabel(options), "kumulo-role": spec.role }
    }
  }).pipe(Effect.flatMap(decodeHcloud({ schema: CreateServerResponse, kind: "servers" })))

const _getServerRecord = (id: number): R<typeof HcloudServerRecord.Type> =>
  hcloudRequest({ path: `servers/${id}`, method: "GET", kind: "servers" }).pipe(
    Effect.flatMap(decodeSingleField({ itemSchema: HcloudServerRecord, field: "server", kind: "servers" }))
  )

const _waitServerRunning = (id: number): R<typeof HcloudServerRecord.Type> =>
  pollUntil({
    check: _getServerRecord(id),
    isDone: (server) => server.status === "running",
    interval: "2 seconds",
    timeout: "5 minutes",
    kind: "server",
    ref: String(id)
  })

export const ensureServer = ({ options, spec }: { readonly options: CloudProviderOptions; readonly spec: ServerSpec }): R<ServerInfo> =>
  Effect.gen(function*() {
    const existing = yield* _findByName({ itemSchema: HcloudServerRecord, listField: "servers", path: "servers", name: spec.name })
    if (existing !== undefined) {
      const settled = yield* _waitServerRunning(existing.id)
      return { id: String(settled.id), name: spec.name, ip: serverIp(settled) }
    }
    const groupId = yield* ensurePlacementGroup({ options, role: spec.role })
    const created = yield* _createServer({ options, spec, groupId })
    yield* waitForAction(created.action.id)
    return { id: String(created.server.id), name: spec.name, ip: serverIp(created.server) }
  })

const DeleteServerResponse = Schema.Struct({ action: Schema.optionalKey(Schema.Struct({ id: Schema.Number })) })

// kumulo: deletes a single server and waits until its (async) delete Action
// completes, for scale-down's per-worker teardown — whole-cluster
// `deleteByTag` doesn't wait per-server (bulk teardown, see `_deleteServersByTag`).
export const deleteServer = (ref: ServerInfo): R<void> =>
  hcloudRequest({ path: `servers/${ref.id}`, method: "DELETE", kind: "servers", okStatuses: [404] }).pipe(
    Effect.flatMap((body) =>
      Schema.decodeUnknownEffect(DeleteServerResponse)(body ?? {}).pipe(
        Effect.orElseSucceed(() => ({ action: undefined })),
        Effect.flatMap((decoded) => decoded.action === undefined ? Effect.void : waitForAction(decoded.action.id))
      )
    )
  )

// ---- Inventory + delete --------------------------------------------------

const _labeled = <A>(
  { itemSchema, listField, options, path }: { readonly path: string; readonly listField: string; readonly itemSchema: Schema.Codec<A, unknown>; readonly options: CloudProviderOptions }
): R<ReadonlyArray<A>> =>
  hcloudRequest({ path: `${path}?label_selector=${encodeURIComponent(_labelSelector(options))}`, method: "GET", kind: path }).pipe(
    Effect.flatMap(decodeListField({ itemSchema, listField, kind: path }))
  )

export const listClusterResources = ({ options }: { readonly options: CloudProviderOptions }): R<Inventory> =>
  Effect.gen(function*() {
    const servers = yield* _labeled({ itemSchema: HcloudServerRecord, listField: "servers", path: "servers", options })
    const networks = yield* _labeled({ itemSchema: HcloudNamedResource, listField: "networks", path: "networks", options })
    const firewalls = yield* _labeled({ itemSchema: HcloudNamedResource, listField: "firewalls", path: "firewalls", options })
    const lbs = yield* _labeled({ itemSchema: HcloudLoadBalancerRecord, listField: "load_balancers", path: "load_balancers", options })
    return {
      servers: servers.map((s) => ({ id: String(s.id), name: s.name, ip: serverIp(s) })),
      networks: networks.map((n) => ({ id: String(n.id), cidr: "" })),
      securityGroups: firewalls.map((f) => ({ id: String(f.id) })),
      loadBalancers: lbs.map((l) => ({ id: String(l.id), vip: l.public_net.ipv4.ip ?? "" }))
    }
  })

const _deleteServersByTag = (options: CloudProviderOptions): R<void> =>
  _labeled({ itemSchema: HcloudNamedResource, listField: "servers", path: "servers", options }).pipe(
    Effect.flatMap((servers) =>
      Effect.forEach(servers, (s) => deleteServer({ id: String(s.id), name: s.name, ip: "" }), { discard: true })
    )
  )

const _deleteIfExists = (
  { options, path, suffix }: { readonly path: string; readonly options: CloudProviderOptions; readonly suffix?: string }
): R<void> =>
  _findByName({ itemSchema: HcloudNamedResource, listField: path, path, name: _name(options, suffix) }).pipe(
    Effect.flatMap((found) =>
      found === undefined ? Effect.void : hcloudRequest({ path: `${path}/${found.id}`, method: "DELETE", kind: path, okStatuses: [404] }).pipe(Effect.asVoid)
    )
  )

const _placementGroupRoles: ReadonlyArray<ServerGroupRole> = ["master", "worker"]

// kumulo: reverse dependency order — LB, servers, placement groups, firewall, network.
export const deleteByTag = ({ options }: { readonly options: CloudProviderOptions }): R<void> =>
  Effect.gen(function*() {
    yield* _deleteIfExists({ path: "load_balancers", options })
    yield* _deleteServersByTag(options)
    yield* Effect.forEach(_placementGroupRoles, (role) => _deleteIfExists({ path: "placement_groups", options, suffix: `${role}s` }), { discard: true })
    yield* _deleteIfExists({ path: "firewalls", options })
    yield* _deleteIfExists({ path: "networks", options })
  })

// ---- Image / flavor resolution: exact name -> fuzzy (+warn) -------------

const _fuzzyMatch = (entries: ReadonlyArray<HcloudNamedResource>, ref: string): HcloudNamedResource | undefined =>
  entries.find((entry) => entry.name.toLowerCase().includes(ref.toLowerCase()))

// kumulo: restricted to `type=system` — the only image kind this port
// resolves (OS base images for cluster nodes), and the only kind whose
// `name` is always non-null (snapshots/backups can have a null `name`,
// which `HcloudNamedResource` doesn't accept).
export const resolveImage = ({ ref }: { readonly ref: string }): R<string> =>
  Effect.gen(function*() {
    const exact = yield* hcloudRequest({ path: `images?type=system&name=${encodeURIComponent(ref)}`, method: "GET", kind: "images" }).pipe(
      Effect.flatMap(decodeListField({ itemSchema: HcloudNamedResource, listField: "images", kind: "images" })),
      Effect.map((records) => records[0])
    )
    if (exact !== undefined) return String(exact.id)
    const all = yield* hcloudRequest({ path: "images?type=system", method: "GET", kind: "images" }).pipe(
      Effect.flatMap(decodeListField({ itemSchema: HcloudNamedResource, listField: "images", kind: "images" }))
    )
    const fuzzy = _fuzzyMatch(all, ref)
    if (fuzzy === undefined) return yield* Effect.fail(new ResourceNotFound({ kind: "image", ref }))
    yield* Effect.logWarning(`image "${ref}" matched by fuzzy lookup: "${fuzzy.name}"`)
    return String(fuzzy.id)
  })

export const resolveFlavor = ({ ref }: { readonly ref: string }): R<string> =>
  Effect.gen(function*() {
    const exact = yield* _findByName({ itemSchema: HcloudNamedResource, listField: "server_types", path: "server_types", name: ref })
    if (exact !== undefined) return String(exact.id)
    const all = yield* hcloudRequest({ path: "server_types", method: "GET", kind: "server_types" }).pipe(
      Effect.flatMap(decodeListField({ itemSchema: HcloudNamedResource, listField: "server_types", kind: "server_types" }))
    )
    const fuzzy = _fuzzyMatch(all, ref)
    if (fuzzy === undefined) return yield* Effect.fail(new ResourceNotFound({ kind: "flavor", ref }))
    yield* Effect.logWarning(`flavor "${ref}" matched by fuzzy lookup: "${fuzzy.name}"`)
    return String(fuzzy.id)
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
        deleteServer: (ref: ServerInfo) => run(deleteServer(ref)),
        deleteByTag: (_tag: ClusterTag) => run(deleteByTag({ options })),
        listClusterResources: (_tag: ClusterTag) => run(listClusterResources({ options })),
        resolveImage: (ref: string) => run(resolveImage({ ref })),
        resolveFlavor: (ref: string) => run(resolveFlavor({ ref }))
      }
    })
  )
