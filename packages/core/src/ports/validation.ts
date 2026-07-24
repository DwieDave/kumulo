import { Option } from "effect"
import { PlanRejected } from "../errors/tagged.ts"
import type { ClusterConfigShape } from "../domain/types.ts"

// Cross-distro validation rules: accepted by the config
// schema, rejected at runtime because the capability doesn't exist under
// the chosen distro.

// kumulo: k3s has no autoscaler yet — schema accepts the block
// for forward-compat, runtime rejects it.
export const validateAutoscaling = (config: ClusterConfigShape): Option.Option<PlanRejected> =>
  config.distro === "k3s" && config.worker_pools.some((pool) => pool.autoscaling?.enabled === true)
    ? Option.some(new PlanRejected({ reason: "autoscaling is not yet implemented for k3s" }))
    : Option.none()

// ovh-mks is a fixed-CNI managed product; Cilium is only selectable when
// self-managing the CNI.
export const validateCni = (config: ClusterConfigShape): Option.Option<PlanRejected> =>
  config.distro === "ovh-mks" && config.addons.cni === "cilium"
    ? Option.some(new PlanRejected({ reason: "cilium is not selectable under ovh-mks; CNI is fixed by OVH" }))
    : Option.none()
