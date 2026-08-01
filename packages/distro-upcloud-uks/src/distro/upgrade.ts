import type { UksUpgradeStrategy } from "./types.ts"

export type UpgradeTarget =
  | { readonly _tag: "Upgrade"; readonly version: string }
  | { readonly _tag: "AlreadyCurrent" }

// LATEST_PATCH always resolves AlreadyCurrent — UKS is minor-only, no patch granularity exists
export const resolveUpgradeTarget = (
  { strategy, availableUpgrades }: {
    readonly strategy: UksUpgradeStrategy
    readonly currentVersion: string
    readonly availableUpgrades: ReadonlyArray<string>
  }
): UpgradeTarget => {
  if (strategy === "LATEST_PATCH") return { _tag: "AlreadyCurrent" }
  const [next] = availableUpgrades
  return next === undefined ? { _tag: "AlreadyCurrent" } : { _tag: "Upgrade", version: next }
}
