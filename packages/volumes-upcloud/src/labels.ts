/**
 * D4: storage `title` is display-only and not unique — kumulo identifies its
 * managed volumes by `labels` (`kumulo-cluster=<tag>`, `kumulo-volume=<name>`),
 * mirroring how UKS node groups are found by the `kumulo-pool` label.
 */
import type { UpcloudLabel } from "@kumulo/upcloud"
import type { ClusterTag } from "@kumulo/core"

export const CLUSTER_LABEL_KEY = "kumulo-cluster"
export const VOLUME_LABEL_KEY = "kumulo-volume"

/** Labels stamped on every kumulo-managed storage (R4/D4). */
export const volumeLabels = (
  { tag, name }: { readonly tag: ClusterTag; readonly name: string }
): ReadonlyArray<UpcloudLabel> => [
  { key: CLUSTER_LABEL_KEY, value: tag },
  { key: VOLUME_LABEL_KEY, value: name }
]

const _labelValue = (labels: ReadonlyArray<UpcloudLabel> | undefined, key: string): string | undefined =>
  labels?.find((label) => label.key === key)?.value

/** True when the labels carry this cluster's tag (used to scope `listClusterVolumes`). */
export const hasClusterLabel = (
  { labels, tag }: { readonly labels: ReadonlyArray<UpcloudLabel> | undefined; readonly tag: ClusterTag }
): boolean => _labelValue(labels, CLUSTER_LABEL_KEY) === tag

/** True when the labels carry both this cluster's tag and this volume's name (R4's find-by-label). */
export const matchesVolumeLabels = (
  { labels, tag, name }: {
    readonly labels: ReadonlyArray<UpcloudLabel> | undefined
    readonly tag: ClusterTag
    readonly name: string
  }
): boolean => hasClusterLabel({ labels, tag }) && _labelValue(labels, VOLUME_LABEL_KEY) === name
