import { Effect } from "effect"
import type { UpcloudUksClusterConfig } from "@kumulo/core"
import { authValidityCheck, controlPlanePlanCheck, nodeGroupPlansCheck, versionSupportedCheck, zoneExistsCheck } from "../doctor/upcloud/index.ts"
import { UpcloudEnv } from "../upcloud/env.ts"
import { buildUpcloudPlan, lookupUpcloudInventory, upcloudDeletePlanActions } from "../upcloud/plan.ts"
import { applyUpcloudUks, deleteUpcloudUks, kubeconfigUpcloudUks, statusUpcloudUks, upgradeUpcloudUks } from "../upcloud/reconcile.ts"
import type { DistroEntry } from "./types.ts"

const _upcloudDoctorChecks = Effect.fn(function*({ config }: { readonly config: UpcloudUksClusterConfig }) {
  const { clients, zones } = yield* UpcloudEnv
  return [
    authValidityCheck({ uks: clients.uks }),
    zoneExistsCheck({ zone: config.zone, zones }),
    controlPlanePlanCheck({ uks: clients.uks, plan: config.plan }),
    nodeGroupPlansCheck({ pools: config.worker_pools.map((pool) => ({ plan: pool.flavor })) }),
    versionSupportedCheck({ version: config.version })
  ]
})

export const upcloudUksEntry: DistroEntry<UpcloudUksClusterConfig> = {
  kind: "upcloud-uks",
  // UpCloud sells no object storage product this cut wires (scope.md) —
  // `upcloud-uks` configs have no `object_storage.module: "upcloud"` variant.
  supportsObjectStorage: false,
  plan: (config) =>
    lookupUpcloudInventory(config).pipe(Effect.map((inventory) => buildUpcloudPlan({ config, inventory }))),
  deletePlanActions: upcloudDeletePlanActions,
  apply: (a) =>
    applyUpcloudUks({ config: a.config, replace: a.replace }).pipe(
      Effect.map((info) => ({ summary: `\nCluster "${a.config.name}" is ${info.status}.` }))
    ),
  delete: deleteUpcloudUks,
  kubeconfig: kubeconfigUpcloudUks,
  deletedLabel: "uks-cluster",
  // Router/network are converged inside `applyUpcloudUksEffect` too, ahead of the cluster (mirrors mks-entry.ts's note).
  appliedPrefixes: ["router/", "network/", "uks-cluster/", "uks-pool/"],
  status: statusUpcloudUks,
  upgrade: upgradeUpcloudUks,
  credentialsLabel: "upcloud api token",
  requiredEnvVars: ["UPCLOUD_API_TOKEN"],
  doctorChecks: _upcloudDoctorChecks
}
