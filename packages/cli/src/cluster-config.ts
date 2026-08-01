import { Schema } from "effect"
import { decodeConfigWith, encodeConfigWith, parseConfigYamlWith } from "@kumulo/core"
import { K3sClusterConfig } from "@kumulo/distro-k3s"
import { MksClusterConfig } from "@kumulo/distro-ovh-mks"
import { UpcloudUksClusterConfig } from "@kumulo/distro-upcloud-uks"

export const ClusterConfig = Schema.Union([K3sClusterConfig, MksClusterConfig, UpcloudUksClusterConfig])
export type ClusterConfig = typeof ClusterConfig.Type
export type ClusterConfigEncoded = typeof ClusterConfig.Encoded

export const decodeConfig = decodeConfigWith(ClusterConfig)
export const encodeConfig = encodeConfigWith(ClusterConfig)
export const parseConfigYaml = parseConfigYamlWith(ClusterConfig)

export { K3sClusterConfig, MksClusterConfig, UpcloudUksClusterConfig }
export type { K3sClusterConfigEncoded } from "@kumulo/distro-k3s"
export type { MksClusterConfigEncoded } from "@kumulo/distro-ovh-mks"
export type { UpcloudUksClusterConfigEncoded } from "@kumulo/distro-upcloud-uks"
