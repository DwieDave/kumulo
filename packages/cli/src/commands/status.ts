import { dirname } from "node:path"
import { Console, Effect } from "effect"
import { Command } from "effect/unstable/cli"
import type { ClusterConfig } from "@kumulo/core"
import { loadConfig } from "../config.ts"
import { distroFor, wantsObjectStorage } from "../distro/registry.ts"
import { bucketStatus } from "../storage/reconcile.ts"
import { kumulo } from "../root.ts"

// R11: buckets + credentials-file presence, ovh-mks only.
const _statusBuckets = Effect.fn(function*(config: ClusterConfig, configDir: string) {
  if (!wantsObjectStorage(config)) return
  const info = yield* bucketStatus({ config, configDir })
  const buckets = info.buckets.length === 0
    ? "(none)"
    : info.buckets.map((b) => `${b.name} (${b.region}${b.retain ? ", retained" : ""})`).join(", ")
  yield* Console.log(`  Buckets: ${buckets}`)
  yield* Console.log(`  Credentials file: ${info.credentialsExist ? "present" : "missing"}`)
})

/** `status`: inventory + cluster health, for both distro kinds. */
export const status = Command.make(
  "status",
  {},
  Effect.fn(function*() {
    const root = yield* kumulo
    const config = yield* loadConfig(root.config)
    yield* distroFor(config).status(config)
    yield* _statusBuckets(config, dirname(root.config))
  })
).pipe(Command.withDescription("Show cluster inventory + health"))
