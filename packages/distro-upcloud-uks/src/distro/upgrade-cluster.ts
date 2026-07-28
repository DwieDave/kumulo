/**
 * `upgradeCluster` (T5.5, R13, D12, AC7): resolves the target per
 * `resolveUpgradeTarget` (T4.4) against UpCloud's own `available-upgrades`,
 * then posts it with the configured `upgrade_strategy` — a no-op when the
 * resolution says "already current" (`LATEST_PATCH`, or `NEXT_MINOR` with no
 * upgrade available).
 */
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
