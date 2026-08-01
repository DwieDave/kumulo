import type { DistroKind } from "@kumulo/core"
import type { ClusterConfig, K3sClusterConfig, MksClusterConfig, UpcloudUksClusterConfig } from "../cluster-config.ts"
import { k3sEntry } from "./k3s-entry.ts"
import { mksEntry } from "./mks-entry.ts"
import { upcloudUksEntry } from "./upcloud-uks-entry.ts"
import type { DistroEntry } from "./types.ts"

export const distroRegistry = {
  "k3s": k3sEntry,
  "ovh-mks": mksEntry,
  "upcloud-uks": upcloudUksEntry
} satisfies Record<DistroKind, DistroEntry<K3sClusterConfig> | DistroEntry<MksClusterConfig> | DistroEntry<UpcloudUksClusterConfig>>

export const distroFor = (
  config: ClusterConfig
): DistroEntry<K3sClusterConfig> | DistroEntry<MksClusterConfig> | DistroEntry<UpcloudUksClusterConfig> => distroRegistry[config.distro]

export const onDistro = (config: ClusterConfig) =>
<A>(f: <C extends ClusterConfig>(a: { readonly entry: DistroEntry<C>; readonly config: C }) => A): A => {
  if (config.distro === "k3s") return f({ entry: k3sEntry, config })
  if (config.distro === "ovh-mks") return f({ entry: mksEntry, config })
  return f({ entry: upcloudUksEntry, config })
}

export const wantsObjectStorage = (config: ClusterConfig): boolean =>
  distroFor(config).supportsObjectStorage && config.object_storage.module === "ovh"
