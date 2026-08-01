import { Effect } from "effect"
import { mapUpcloudError } from "@kumulo/upcloud"
import type { MksError } from "@kumulo/core"
import type { UksClients } from "./types.ts"
import { resolveUpgradeTarget } from "./upgrade.ts"
import type { UksUpgradeStrategy } from "./types.ts"

export const upgradeCluster = (
  { clients, uuid, currentVersion, strategy, upgradeStrategy }: {
    readonly clients: UksClients
    readonly uuid: string
    readonly currentVersion: string
    readonly strategy: UksUpgradeStrategy
    readonly upgradeStrategy: "manual" | "rolling-update"
  }
): Effect.Effect<void, MksError> =>
  Effect.gen(function*() {
    const availableUpgrades = yield* mapUpcloudError({
      self: clients.uks.availableUpgrades(uuid),
      ctx: { kind: "uks-upgrade", ref: uuid }
    })
    const target = resolveUpgradeTarget({ strategy, currentVersion, availableUpgrades })
    if (target._tag === "AlreadyCurrent") return
    yield* mapUpcloudError({
      self: clients.uks.upgrade(uuid, { version: target.version, strategy: upgradeStrategy }),
      ctx: { kind: "uks-upgrade", ref: uuid }
    })
  })
