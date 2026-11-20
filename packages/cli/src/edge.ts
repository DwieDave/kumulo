import { Effect } from "effect"
import type { CdnHandle } from "./cdn.ts"
import { cdnHandleFor, pullZoneIdFor } from "./cdn.ts"
import type { ClusterConfig } from "./cluster-config.ts"
import { dnsProviderLayerWith } from "./dns.ts"

// Resolves the cdn handle once and gives `run` the DNS layer that already knows the pull zone, so apply and delete share one edge setup.
export const withEdge = <A, E, R>(
  { config, configDir, run }: {
    readonly config: ClusterConfig
    readonly configDir: string
    readonly run: (cdn: CdnHandle | undefined) => Effect.Effect<A, E, R>
  }
) =>
  Effect.gen(function*() {
    const cdn = yield* cdnHandleFor({ config, configDir })
    const result = yield* run(cdn).pipe(Effect.provide(dnsProviderLayerWith({ config, pullZoneIdFor: pullZoneIdFor(cdn) })))

    return { result, cdn }
  })
