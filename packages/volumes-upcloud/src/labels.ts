// Storage title is display-only and not unique — volumes are identified by labels (kumulo-cluster, kumulo-volume).
import type { UpcloudLabel } from "@kumulo/upcloud"
import type { ClusterTag } from "@kumulo/core"

export const CLUSTER_LABEL_KEY = "kumulo-cluster"
export const VOLUME_LABEL_KEY = "kumulo-volume"

export const volumeLabels = (
  { tag, name }: { readonly tag: ClusterTag; readonly name: string }
): ReadonlyArray<UpcloudLabel> => [
  { key: CLUSTER_LABEL_KEY, value: tag },
  { key: VOLUME_LABEL_KEY, value: name }
]

const _labelValue = (labels: ReadonlyArray<UpcloudLabel> | undefined, key: string): string | undefined =>
  labels?.find((label) => label.key === key)?.value

export const hasClusterLabel = (
  { labels, tag }: { readonly labels: ReadonlyArray<UpcloudLabel> | undefined; readonly tag: ClusterTag }
): boolean => _labelValue(labels, CLUSTER_LABEL_KEY) === tag

export const matchesVolumeLabels = (
  { labels, tag, name }: {
    readonly labels: ReadonlyArray<UpcloudLabel> | undefined
    readonly tag: ClusterTag
    readonly name: string
  }
): boolean => hasClusterLabel({ labels, tag }) && _labelValue(labels, VOLUME_LABEL_KEY) === name
