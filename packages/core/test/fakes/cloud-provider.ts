import { Effect, Layer, Ref } from "effect"
import { CloudProvider } from "../../src/ports/cloud-provider.ts"
import type { ClusterTag, LbInfo, NetworkInfo, SecGroupInfo, ServerInfo } from "../../src/domain/types.ts"

// Shared fake `CloudProvider` (in-memory, tagged store), create-if-missing
// by tag+name. Network/security-group/LB are process-wide singletons (the
// port doesn't thread a cluster tag through those `ensure*` calls); only
// servers are tracked per-tag, which is all `deleteByTag`/
// `listClusterResources` need.
interface ServerRecord {
  readonly info: ServerInfo
  readonly tag: ClusterTag
}

// ponytail: no fixture-replay/network simulation here — just enough state
// to prove idempotent apply + interruption-safety for the reconcile
// pipeline. Extend when a richer provider behavior is needed.
export const FakeCloudProviderLive: Layer.Layer<CloudProvider> = Layer.effect(
  CloudProvider,
  Effect.gen(function*() {
    const servers = yield* Ref.make<ReadonlyMap<string, ServerRecord>>(new Map())
    const network = yield* Ref.make<NetworkInfo | undefined>(undefined)
    const secGroup = yield* Ref.make<SecGroupInfo | undefined>(undefined)
    const lb = yield* Ref.make<LbInfo | undefined>(undefined)
    const nextId = yield* Ref.make(0)

    const freshId = (prefix: string) => Ref.updateAndGet(nextId, (n) => n + 1).pipe(Effect.map((n) => `${prefix}-${n}`))

    return {
      findNetwork: (_spec) => Ref.get(network),

      ensureNetwork: (spec) =>
        Ref.get(network).pipe(
          Effect.flatMap((existing) => {
            if (existing !== undefined) return Effect.succeed(existing)
            return freshId("net").pipe(
              Effect.flatMap((id) => {
                const info: NetworkInfo = { id, cidr: spec.cidr }
                return Ref.set(network, info).pipe(Effect.as(info))
              })
            )
          })
        ),
      ensureSecurityGroups: (_spec) =>
        Ref.get(secGroup).pipe(
          Effect.flatMap((existing) => {
            if (existing !== undefined) return Effect.succeed(existing)
            return freshId("sg").pipe(
              Effect.flatMap((id) => {
                const info: SecGroupInfo = { id }
                return Ref.set(secGroup, info).pipe(Effect.as(info))
              })
            )
          })
        ),
      ensureLoadBalancer: (_spec) =>
        Ref.get(lb).pipe(
          Effect.flatMap((existing) => {
            if (existing !== undefined) return Effect.succeed(existing)
            return freshId("lb").pipe(
              Effect.flatMap((id) => {
                const info: LbInfo = { id, vip: `10.0.0.100` }
                return Ref.set(lb, info).pipe(Effect.as(info))
              })
            )
          })
        ),
      ensureServer: (spec) =>
        Ref.get(servers).pipe(
          Effect.flatMap((map) => {
            const existing = map.get(spec.name)
            if (existing !== undefined) return Effect.succeed(existing.info)
            return freshId("srv").pipe(
              Effect.flatMap((id) => {
                const info: ServerInfo = { id, name: spec.name, ip: `10.0.0.${map.size + 1}` }
                return Ref.update(servers, (current) => new Map(current).set(spec.name, { info, tag: spec.tag })).pipe(
                  Effect.as(info)
                )
              })
            )
          })
        ),
      deleteServer: (ref) =>
        Ref.update(servers, (current) => new Map([...current].filter(([name]) => name !== ref.name))).pipe(
          Effect.asVoid
        ),
      deleteByTag: (tag) =>
        Ref.update(servers, (current) => new Map([...current].filter(([, record]) => record.tag !== tag))).pipe(
          Effect.asVoid
        ),
      listClusterResources: (tag) =>
        Effect.all({ servers: Ref.get(servers), network: Ref.get(network), secGroup: Ref.get(secGroup), lb: Ref.get(lb) }).pipe(
          Effect.map(({ lb: lbInfo, network: net, secGroup: sg, servers: map }) => ({
            servers: [...map.values()].filter((record) => record.tag === tag).map((record) => record.info),
            networks: net === undefined ? [] : [net],
            securityGroups: sg === undefined ? [] : [sg],
            loadBalancers: lbInfo === undefined ? [] : [lbInfo]
          }))
        ),
      resolveImage: (ref) => Effect.succeed(ref),
      resolveFlavor: (ref) => Effect.succeed(ref)
    }
  })
)
