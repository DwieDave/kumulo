import type { ClusterConfig, DistroKind, K3sClusterConfig, MksClusterConfig, UpcloudUksClusterConfig } from "@kumulo/core"
import { k3sEntry } from "./k3s-entry.ts"
import { mksEntry } from "./mks-entry.ts"
import { upcloudUksEntry } from "./upcloud-uks-entry.ts"
import type { DistroEntry } from "./types.ts"

/** The one distro-kind branch point: a new `DistroKind` literal fails to compile here. */
export const distroRegistry = {
  "k3s": k3sEntry,
  "ovh-mks": mksEntry,
  "upcloud-uks": upcloudUksEntry
} satisfies Record<DistroKind, DistroEntry<K3sClusterConfig> | DistroEntry<MksClusterConfig> | DistroEntry<UpcloudUksClusterConfig>>

/** Config-independent entry metadata (labels, prefixes, env vars) — for the config-taking members use `onDistro`. */
export const distroFor = (
  config: ClusterConfig
): DistroEntry<K3sClusterConfig> | DistroEntry<MksClusterConfig> | DistroEntry<UpcloudUksClusterConfig> => distroRegistry[config.distro]

/**
 * The one narrowing point: `config.distro` narrows the union, so each branch
 * pairs a variant-typed entry with its own config variant. Callers stay
 * union-typed and never cast.
 */
export const onDistro = (config: ClusterConfig) =>
<A>(f: <C extends ClusterConfig>(a: { readonly entry: DistroEntry<C>; readonly config: C }) => A): A => {
  if (config.distro === "k3s") return f({ entry: k3sEntry, config })
  if (config.distro === "ovh-mks") return f({ entry: mksEntry, config })
  return f({ entry: upcloudUksEntry, config })
}

// Object storage is only wired for the ovh-mks path (scope.md) — k3s and
// upcloud-uks compile against the same config shape but never converge buckets.
export const wantsObjectStorage = (config: ClusterConfig): boolean =>
  distroFor(config).supportsObjectStorage && config.object_storage.module === "ovh"
