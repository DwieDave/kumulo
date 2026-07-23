import { Effect } from "effect"
import type { CloudError } from "../ports/cloud-provider.ts"
import { CloudProvider } from "../ports/cloud-provider.ts"
import type { ServerSpec } from "../domain/types.ts"

// FR-2.4/NFR-6 — the "Nodes" phase: bounded-concurrency, idempotent apply.
// `ensureServer` is create-if-missing by tag+name (design §3.1), so an
// interrupted or re-run apply always converges without duplicating servers.
export const applyServers = (
  { concurrency, specs }: { readonly specs: ReadonlyArray<ServerSpec>; readonly concurrency: number }
): Effect.Effect<void, CloudError, CloudProvider> =>
  Effect.gen(function*() {
    const cloudProvider = yield* CloudProvider
    yield* Effect.forEach(specs, cloudProvider.ensureServer, { concurrency, discard: true })
  })
