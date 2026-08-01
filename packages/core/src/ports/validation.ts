import { Option } from "effect"
import { PlanRejected } from "../errors/tagged.ts"
import { distroCapabilities } from "../domain/capabilities.ts"
import type { ClusterConfigShape } from "../domain/types.ts"

export const validateAutoscaling = (config: ClusterConfigShape): Option.Option<PlanRejected> =>
  !distroCapabilities[config.distro].autoscaling && config.worker_pools.some((pool) => pool.autoscaling?.enabled === true)
    ? Option.some(new PlanRejected({ reason: `autoscaling is not yet implemented for ${config.distro}` }))
    : Option.none()

export const validateCni = (config: ClusterConfigShape): Option.Option<PlanRejected> =>
  !distroCapabilities[config.distro].selectableCni && config.addons.cni === "cilium"
    ? Option.some(new PlanRejected({ reason: "cilium is not selectable under ovh-mks; CNI is fixed by OVH" }))
    : Option.none()
