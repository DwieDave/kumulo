import { Effect, Predicate, Schedule } from "effect"
import { ignoreMissing, mapUpcloudError } from "@kumulo/upcloud"
import type { UpcloudLabel } from "@kumulo/upcloud"
import type { MksError } from "@kumulo/core"
import type { UksClients } from "./types.ts"

export interface EnsuredNetwork {
  readonly networkUuid: string
  readonly routerUuid: string
}

export const networkName = (clusterName: string): string => `${clusterName}-network`
export const routerName = (clusterName: string): string => `${clusterName}-router`

export const uksNetworkLabels = (clusterName: string): ReadonlyArray<UpcloudLabel> => [{ key: "kumulo-cluster", value: clusterName }]

// pre-label clusters own an unlabelled `<cluster>-network`; adopt those by name, never one that carries labels
const _legacyCandidate = <Resource extends { readonly name: string; readonly labels?: ReadonlyArray<UpcloudLabel> }>(
  { resources, name }: { readonly resources: ReadonlyArray<Resource>; readonly name: string }
): Resource | undefined =>
  resources.find((resource) => resource.name === name && (resource.labels === undefined || resource.labels.length === 0))

const _findOwnedRouter = (
  { clients, clusterName, adopt }: { readonly clients: UksClients; readonly clusterName: string; readonly adopt: boolean }
): Effect.Effect<string | undefined, MksError> =>
  Effect.gen(function*() {
    const name = routerName(clusterName)
    const ctx = { kind: "router", ref: name }
    const labels = uksNetworkLabels(clusterName)
    const owned = yield* mapUpcloudError({ self: clients.router.list({ labels }), ctx })

    if (owned.length > 0) return owned[0]?.uuid
    const all = yield* mapUpcloudError({ self: clients.router.list(), ctx })
    const legacy = _legacyCandidate({ resources: all, name })

    if (legacy === undefined) return undefined

    if (adopt) yield* mapUpcloudError({ self: clients.router.modify(legacy.uuid, { name, labels }), ctx })

    return legacy.uuid
  })

export const findOwnedNetwork = (
  { clients, clusterName, zone, adopt = true }: {
    readonly clients: UksClients
    readonly clusterName: string
    readonly zone?: string | undefined
    readonly adopt?: boolean
  }
): Effect.Effect<string | undefined, MksError> =>
  Effect.gen(function*() {
    const name = networkName(clusterName)
    const ctx = { kind: "network", ref: name }
    const labels = uksNetworkLabels(clusterName)
    const owned = yield* mapUpcloudError({ self: clients.network.list({ zone, labels }), ctx })

    if (owned.length > 0) return owned[0]?.uuid
    const inZone = yield* mapUpcloudError({ self: clients.network.list({ zone }), ctx })
    const legacy = _legacyCandidate({ resources: inZone, name })

    if (legacy === undefined) return undefined

    if (adopt) yield* mapUpcloudError({ self: clients.network.modify(legacy.uuid, { labels }), ctx })

    return legacy.uuid
  })

const _ensureRouter = (
  { clients, clusterName }: { readonly clients: UksClients; readonly clusterName: string }
): Effect.Effect<string, MksError> =>
  Effect.gen(function*() {
    const name = routerName(clusterName)
    const existing = yield* _findOwnedRouter({ clients, clusterName, adopt: true })

    if (existing !== undefined) return existing

    const created = yield* mapUpcloudError({
      self: clients.router.create({ name, labels: uksNetworkLabels(clusterName) }),
      ctx: { kind: "router", ref: name }
    })

    return created.uuid
  })

const _ensureUksNetwork = (
  { clients, clusterName, zone, cidr, routerUuid }: {
    readonly clients: UksClients
    readonly clusterName: string
    readonly zone: string
    readonly cidr: string
    readonly routerUuid: string
  }
): Effect.Effect<string, MksError> =>
  Effect.gen(function*() {
    const name = networkName(clusterName)
    const existing = yield* findOwnedNetwork({ clients, clusterName, zone })

    if (existing !== undefined) return existing

    const created = yield* mapUpcloudError({
      self: clients.network.create({
        name,
        zone,
        router: routerUuid,
        labels: uksNetworkLabels(clusterName),
        // UpCloud SDN spells the `dhcp` boolean as the string "yes".
        ip_networks: { ip_network: [{ address: cidr, dhcp: "yes", family: "IPv4" }] }
      }),
      ctx: { kind: "network", ref: name }
    })

    return created.uuid
  })

export const ensureNetwork = (
  { clients, clusterName, zone, cidr }: {
    readonly clients: UksClients
    readonly clusterName: string
    readonly zone: string
    readonly cidr: string
  }
): Effect.Effect<EnsuredNetwork, MksError> =>
  Effect.gen(function*() {
    const routerUuid = yield* _ensureRouter({ clients, clusterName })
    const networkUuid = yield* _ensureUksNetwork({ clients, clusterName, zone, cidr, routerUuid })

    return { networkUuid, routerUuid }
  })

// the network or router can stay busy for a while after the cluster leaves the list
const _retryConflicts = <A, E>(self: Effect.Effect<A, E>): Effect.Effect<A, E> =>
  self.pipe(
    Effect.retry({
      while: Predicate.isTagged("ResourceConflict"),
      schedule: Schedule.spaced("10 seconds"),
      times: 30
    })
  )

export const deleteNetwork = (
  { clients, clusterName, zone }: { readonly clients: UksClients; readonly clusterName: string; readonly zone?: string | undefined }
): Effect.Effect<void, MksError> =>
  Effect.gen(function*() {
    // Delete network before router: router delete 409s while a network is still attached.
    const networkUuid = yield* findOwnedNetwork({ clients, clusterName, zone, adopt: false })

    if (networkUuid !== undefined) {
      yield* ignoreMissing(
        _retryConflicts(mapUpcloudError({ self: clients.network.delete(networkUuid), ctx: { kind: "network", ref: networkUuid } }))
      )
    }

    const routerUuid = yield* _findOwnedRouter({ clients, clusterName, adopt: false })

    if (routerUuid !== undefined) {
      yield* ignoreMissing(
        _retryConflicts(mapUpcloudError({ self: clients.router.delete(routerUuid), ctx: { kind: "router", ref: routerUuid } }))
      )
    }
  })
