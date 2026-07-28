import { Option } from "effect"
import { PlanRejected } from "../errors/tagged.ts"
import { distroCapabilities } from "../domain/capabilities.ts"
import type { ClusterConfigShape } from "../domain/types.ts"

// Cross-distro validation rules: accepted by the config
// schema, rejected at runtime because the capability doesn't exist under
// the chosen distro.

// kumulo: schema accepts the autoscaling block on every distro for
// forward-compat; runtime rejects it wherever the distro doesn't implement
// it (AC8), naming the offending distro rather than hardcoding one.
export const validateAutoscaling = (config: ClusterConfigShape): Option.Option<PlanRejected> =>
  !distroCapabilities[config.distro].autoscaling && config.worker_pools.some((pool) => pool.autoscaling?.enabled === true)
    ? Option.some(new PlanRejected({ reason: `autoscaling is not yet implemented for ${config.distro}` }))
    : Option.none()

// ovh-mks is a fixed-CNI managed product; Cilium is only selectable when
// self-managing the CNI.
export const validateCni = (config: ClusterConfigShape): Option.Option<PlanRejected> =>
  !distroCapabilities[config.distro].selectableCni && config.addons.cni === "cilium"
    ? Option.some(new PlanRejected({ reason: "cilium is not selectable under ovh-mks; CNI is fixed by OVH" }))
    : Option.none()
