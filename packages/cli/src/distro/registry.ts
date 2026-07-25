import type { ClusterConfig, DistroKind } from "@kumulo/core"
import { k3sEntry } from "./k3s-entry.ts"
import { mksEntry } from "./mks-entry.ts"
import type { DistroEntry } from "./types.ts"

/** The one distro-kind branch point: a new `DistroKind` literal fails to compile here. */
export const distroRegistry: Record<DistroKind, DistroEntry> = {
  "k3s": k3sEntry,
  "ovh-mks": mksEntry
}

export const distroFor = (config: ClusterConfig): DistroEntry => distroRegistry[config.distro]

// Object storage is only wired for the ovh-mks path (scope.md) — k3s
// compiles against the same config shape but never converges buckets.
export const wantsObjectStorage = (config: ClusterConfig): boolean =>
  distroFor(config).supportsObjectStorage && config.object_storage.module === "ovh"
