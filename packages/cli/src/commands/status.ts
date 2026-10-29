import { dirname } from "node:path"
import { Console, Effect } from "effect"
import { Command } from "effect/cli"
import type { ClusterConfig } from "../cluster-config.ts"
import { loadConfig } from "../config.ts"
import { onDistro, wantsObjectStorage } from "../distro/registry.ts"
import { cdnHandleFor, cdnStatusLines } from "../cdn.ts"
import { bucketStatus } from "../storage/reconcile.ts"
import { configArgument } from "../root.ts"

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

const _statusCdn = Effect.fn(function*(config: ClusterConfig, configDir: string) {
  const cdn = yield* cdnHandleFor({ config, configDir })
  const lines = yield* cdnStatusLines({ config, cdn })
  yield* Effect.forEach(lines, (line) => Console.log(line), { discard: true })
})

/** `status`: inventory + cluster health, for both distro kinds. */
export const status = Command.make(
  "status",
  { config: configArgument() },
  Effect.fn(function*({ config: configPath }) {
    const config = yield* loadConfig(configPath)
    yield* onDistro(config)(({ config: cfg, entry }) => entry.status(cfg))
    yield* _statusBuckets(config, dirname(configPath))
    yield* _statusCdn(config, dirname(configPath))
  })
).pipe(Command.withDescription("Show cluster inventory + health"))
