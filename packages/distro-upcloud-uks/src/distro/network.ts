/**
 * `ensureNetwork` / `deleteNetwork` (T5.2, R11, D10). kumulo owns the SDN
 * network and its router: created before the cluster, deleted after it
 * (order enforced by `delete.ts`, not here).
 *
 * kumulo: UpCloud's `Network`/`Router` API carries no `labels` field (unlike
 * the UKS cluster and node-group resources `ownership.ts` stamps) — network
 * and router resources are synchronous (no `state`/poll) and are owned by
 * identity instead: a deterministic name derived from the cluster name, so
 * `ensureNetwork` finds "its" network/router by that name rather than
 * adopting whatever it lists first (D10: no adoption of pre-existing
 * networks).
 */
import { Effect } from "effect"
import { ignoreMissing, mapUpcloudError } from "@kumulo/upcloud"
import type { MksError } from "@kumulo/core"
import type { UksClients } from "./types.ts"

export interface EnsuredNetwork {
  readonly networkUuid: string
  readonly routerUuid: string
}

/** The deterministic identity a kumulo-managed network/router is found by (D10). */
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
        // Double-wrapped, and `dhcp` is the string "yes" — UpCloud's SDN
        // endpoints spell booleans that way (see `network.ts` in @kumulo/upcloud).
        ip_networks: { ip_network: [{ address: cidr, dhcp: "yes", family: "IPv4" }] }
      }),
      ctx: { kind: "network", ref: name }
    })
    return created.uuid
  })

/** Router first (network attaches to it), then the network itself — the reverse of `deleteNetwork`'s order. */
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

/**
 * Network, then router (R11) — deleting an already-gone resource is a
 * success (`ignoreMissing`), so this is safe to call from any partial state
 * (N5). Looks resources up by the same deterministic name `ensureNetwork`
 * used, so it never needs the caller to remember uuids across a re-run.
 */
export const deleteNetwork = (
  { clients, clusterName }: { readonly clients: UksClients; readonly clusterName: string }
): Effect.Effect<void, MksError> =>
  Effect.gen(function*() {
    // kumulo: network BEFORE router — live probe (2026-08-01) showed the
    // router delete 409s while a network is still attached; deleting the
    // network detaches it. AC3's "router, then network" reading was wrong.
    const networkUuid = yield* _findNetworkByName({ clients, name: networkName(clusterName) })
    if (networkUuid !== undefined) {
      yield* ignoreMissing(mapUpcloudError({ self: clients.network.delete(networkUuid), ctx: { kind: "network", ref: networkUuid } }))
    }
    const routerUuid = yield* _findRouterByName({ clients, name: routerName(clusterName) })
    if (routerUuid !== undefined) {
      yield* ignoreMissing(mapUpcloudError({ self: clients.router.delete(routerUuid), ctx: { kind: "router", ref: routerUuid } }))
    }
  })
