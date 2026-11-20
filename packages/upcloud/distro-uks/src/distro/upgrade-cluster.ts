import { pollUntil } from "@kumulo/core"
import { Console, Effect } from "effect"
import { mapUpcloudError } from "@kumulo/upcloud"
import type { ManagedDistroError } from "@kumulo/core"
import type { UksClients } from "./types.ts"
import { resolveUpgradeTarget, UpgradeTarget } from "./upgrade.ts"
import type { UksUpgradeStrategy } from "./types.ts"

export const upgradeCluster = (
  { clients, uuid, currentVersion, strategy, upgradeStrategy }: {
    readonly clients: UksClients
    readonly uuid: string
    readonly currentVersion: string
    readonly strategy: UksUpgradeStrategy
    readonly upgradeStrategy: "manual" | "rolling-update"
  }
): Effect.Effect<void, ManagedDistroError> =>
  Effect.gen(function*() {
    const availableUpgrades = yield* mapUpcloudError({
      self: clients.uks.availableUpgrades(uuid),
      ctx: { kind: "uks-upgrade", ref: uuid }
    })

    const target = resolveUpgradeTarget({ strategy, currentVersion, availableUpgrades })

    if (UpgradeTarget.$is("AlreadyCurrent")(target)) return
    yield* mapUpcloudError({
      self: clients.uks.upgrade(uuid, { version: target.version, strategy: { type: upgradeStrategy } }),
      ctx: { kind: "uks-upgrade", ref: uuid }
    })

    yield* pollUntil({
      check: mapUpcloudError({ self: clients.uks.get(uuid), ctx: { kind: "uks-cluster", ref: uuid } }),
      isDone: (cluster) => cluster.state === "running",
      interval: "10 seconds",
      timeout: "30 minutes",
      kind: "uks-cluster",
      ref: uuid
    })

    if (upgradeStrategy === "manual") {
      yield* Console.log("Node groups keep their old kubelet until replaced: re-create each pool to finish the upgrade.")
    }
  })
