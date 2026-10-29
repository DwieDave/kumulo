import { Data } from "effect"
import type { UksUpgradeStrategy } from "./types.ts"

export type UpgradeTarget = Data.TaggedEnum<{
  Upgrade: { readonly version: string }
  AlreadyCurrent: {}
}>

export const UpgradeTarget = Data.taggedEnum<UpgradeTarget>()

// LATEST_PATCH always resolves AlreadyCurrent — UKS is minor-only, no patch granularity exists
export const resolveUpgradeTarget = (
  { strategy, availableUpgrades }: {
    readonly strategy: UksUpgradeStrategy
    readonly currentVersion: string
    readonly availableUpgrades: ReadonlyArray<string>
  }
): UpgradeTarget => {
  if (strategy === "LATEST_PATCH") return UpgradeTarget.AlreadyCurrent()
  const [next] = availableUpgrades

  return next === undefined ? UpgradeTarget.AlreadyCurrent() : UpgradeTarget.Upgrade({ version: next })
}
