import type { ClusterConfig, DistroKind, K3sClusterConfig, MksClusterConfig } from "@kumulo/core"
import { k3sEntry } from "./k3s-entry.ts"
import { mksEntry } from "./mks-entry.ts"
import type { DistroEntry } from "./types.ts"

/** The one distro-kind branch point: a new `DistroKind` literal fails to compile here. */
export const distroRegistry = {
  "k3s": k3sEntry,
  "ovh-mks": mksEntry
} satisfies Record<DistroKind, DistroEntry<K3sClusterConfig> | DistroEntry<MksClusterConfig>>

/** Config-independent entry metadata (labels, prefixes, env vars) — for the config-taking members use `onDistro`. */
export const distroFor = (
  config: ClusterConfig
): DistroEntry<K3sClusterConfig> | DistroEntry<MksClusterConfig> => distroRegistry[config.distro]

/**
 * The one narrowing point: `config.distro` narrows the union, so each branch
 * pairs a variant-typed entry with its own config variant. Callers stay
 * union-typed and never cast.
 */
export const onDistro = (config: ClusterConfig) =>
<A>(f: <C extends ClusterConfig>(a: { readonly entry: DistroEntry<C>; readonly config: C }) => A): A =>
  config.distro === "k3s" ? f({ entry: k3sEntry, config }) : f({ entry: mksEntry, config })

// Object storage is only wired for the ovh-mks path (scope.md) — k3s
// compiles against the same config shape but never converges buckets.
export const wantsObjectStorage = (config: ClusterConfig): boolean =>
  distroFor(config).supportsObjectStorage && config.object_storage.module === "ovh"
