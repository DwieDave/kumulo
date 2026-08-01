import { Effect } from "effect"
import type { UpcloudUksClusterConfig } from "../cluster-config.ts"
import { authValidityCheck, controlPlanePlanCheck, nodeGroupPlansCheck, versionSupportedCheck, zoneExistsCheck } from "../doctor/upcloud/index.ts"
import {
  csiDevicePermissionCheck,
  objectStorageRegionCheck,
  upcloudObjectStorageReachCheck,
  upcloudStorageReachCheck
} from "../doctor/upcloud/storage.ts"
import { UpcloudEnv } from "../upcloud/env.ts"
import { buildUpcloudPlan, lookupUpcloudInventory, upcloudDeletePlanActions } from "../upcloud/plan.ts"
import { applyUpcloudUks, deleteUpcloudUks, kubeconfigUpcloudUks, statusUpcloudUks, upgradeUpcloudUks } from "../upcloud/reconcile.ts"
import { managedUpcloudVolumes } from "../upcloud/volumes.ts"
import type { DistroEntry } from "./types.ts"

const _upcloudDoctorChecks = Effect.fn(function*({ config }: { readonly config: UpcloudUksClusterConfig }) {
  const { clients, zones, storage, objectStorage } = yield* UpcloudEnv
  return [
    authValidityCheck({ uks: clients.uks }),
    zoneExistsCheck({ zone: config.zone, zones }),
    controlPlanePlanCheck({ uks: clients.uks, plan: config.plan }),
    nodeGroupPlansCheck({ pools: config.worker_pools.map((pool) => ({ plan: pool.flavor })) }),
    versionSupportedCheck({ version: config.version }),
    ...(managedUpcloudVolumes(config).length > 0 ? [upcloudStorageReachCheck(storage), csiDevicePermissionCheck] : []),
    ...(config.object_storage.module === "upcloud"
      ? [upcloudObjectStorageReachCheck(objectStorage), objectStorageRegionCheck({ objectStorage, region: config.object_storage.region })]
      : [])
  ]
})

export const upcloudUksEntry: DistroEntry<UpcloudUksClusterConfig> = {
  kind: "upcloud-uks",
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
  appliedPrefixes: ["router/", "network/", "uks-cluster/", "uks-pool/", "volume/", "bucket/"],
  selfProgress: true,
  status: statusUpcloudUks,
  upgrade: upgradeUpcloudUks,
  credentialsLabel: "upcloud api token",
  requiredEnvVars: ["UPCLOUD_API_TOKEN"],
  doctorChecks: _upcloudDoctorChecks
}
