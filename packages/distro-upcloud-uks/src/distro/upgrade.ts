/**
 * Upgrade target resolution (D12/R13/AC7). The CLI's `strategy` verb stays
 * distro-agnostic (`LATEST_PATCH | NEXT_MINOR`); UKS resolves it against
 * `available-upgrades` rather than posting an endpoint-native strategy the
 * way MKS does — UpCloud's `/upgrade` endpoint takes a target version, not
 * a strategy name.
 */

import type { UksUpgradeStrategy } from "./types.ts"

export type UpgradeTarget =
  | { readonly _tag: "Upgrade"; readonly version: string }
  | { readonly _tag: "AlreadyCurrent" }

/**
 * `NEXT_MINOR` takes the first entry `available-upgrades` reports (UpCloud's
 * own ordering — nearest minor first). `LATEST_PATCH` always resolves to
 * "already current": UKS is minor-only (D7), it exposes no patch
 * granularity to target.
 */
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
