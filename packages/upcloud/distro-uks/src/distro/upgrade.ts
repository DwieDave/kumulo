import { Data } from "effect"
import type { UksUpgradeStrategy } from "./types.ts"

export type UpgradeTarget = Data.TaggedEnum<{
  Upgrade: { readonly version: string }
  AlreadyCurrent: {}
}>

export const UpgradeTarget = Data.taggedEnum<UpgradeTarget>()

const _minor = (version: string): readonly [number, number] => {
  const match = /^v?(\d+)\.(\d+)/.exec(version)

  return match === null ? [Number.NaN, Number.NaN] : [Number(match[1]), Number(match[2])]
}

// compares major.minor numerically; NaN when either side is not a version
export const compareMinor = ({ a, b }: { readonly a: string; readonly b: string }): number => {
  const [aMajor, aMinor] = _minor(a)
  const [bMajor, bMinor] = _minor(b)

  return aMajor === bMajor ? aMinor - bMinor : aMajor - bMajor
}

// LATEST_PATCH always resolves AlreadyCurrent — UKS is minor-only, no patch granularity exists
export const resolveUpgradeTarget = (
  { strategy, currentVersion, availableUpgrades }: {
    readonly strategy: UksUpgradeStrategy
    readonly currentVersion: string
    readonly availableUpgrades: ReadonlyArray<string>
  }
): UpgradeTarget => {
  if (strategy === "LATEST_PATCH") return UpgradeTarget.AlreadyCurrent()

  const [next] = availableUpgrades.filter((version) => compareMinor({ a: version, b: currentVersion }) > 0)
    .toSorted((a, b) => compareMinor({ a, b }))

  return next === undefined ? UpgradeTarget.AlreadyCurrent() : UpgradeTarget.Upgrade({ version: next })
}
