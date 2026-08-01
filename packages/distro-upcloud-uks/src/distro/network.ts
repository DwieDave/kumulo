import { Effect } from "effect"
import { ignoreMissing, mapUpcloudError } from "@kumulo/upcloud"
import type { MksError } from "@kumulo/core"
import type { UksClients } from "./types.ts"

export interface EnsuredNetwork {
  readonly networkUuid: string
  readonly routerUuid: string
}

export const networkName = (clusterName: string): string => `${clusterName}-network`
export const routerName = (clusterName: string): string => `${clusterName}-router`

const _findRouterByName = (
  { clients, name }: { readonly clients: UksClients; readonly name: string }
): Effect.Effect<string | undefined, MksError> =>
  mapUpcloudError({ self: clients.router.list(), ctx: { kind: "router", ref: name } }).pipe(
    Effect.map((routers) => routers.find((router) => router.name === name)?.uuid)
  )

const _findNetworkByName = (
  { clients, name }: { readonly clients: UksClients; readonly name: string }
): Effect.Effect<string | undefined, MksError> =>
  mapUpcloudError({ self: clients.network.list(), ctx: { kind: "network", ref: name } }).pipe(
    Effect.map((networks) => networks.find((network) => network.name === name)?.uuid)
  )

const _ensureRouter = (
  { clients, clusterName }: { readonly clients: UksClients; readonly clusterName: string }
): Effect.Effect<string, MksError> =>
  Effect.gen(function*() {
    const name = routerName(clusterName)
    const existing = yield* _findRouterByName({ clients, name })
    if (existing !== undefined) return existing
    const created = yield* mapUpcloudError({ self: clients.router.create({ name }), ctx: { kind: "router", ref: name } })
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
    const existing = yield* _findNetworkByName({ clients, name })
    if (existing !== undefined) return existing
    const created = yield* mapUpcloudError({
      self: clients.network.create({
        name,
        zone,
        router: routerUuid,
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

export const deleteNetwork = (
  { clients, clusterName }: { readonly clients: UksClients; readonly clusterName: string }
): Effect.Effect<void, MksError> =>
  Effect.gen(function*() {
    // Delete network before router: router delete 409s while a network is still attached.
    const networkUuid = yield* _findNetworkByName({ clients, name: networkName(clusterName) })
    if (networkUuid !== undefined) {
      yield* ignoreMissing(mapUpcloudError({ self: clients.network.delete(networkUuid), ctx: { kind: "network", ref: networkUuid } }))
    }
    const routerUuid = yield* _findRouterByName({ clients, name: routerName(clusterName) })
    if (routerUuid !== undefined) {
      yield* ignoreMissing(mapUpcloudError({ self: clients.router.delete(routerUuid), ctx: { kind: "router", ref: routerUuid } }))
    }
  })
