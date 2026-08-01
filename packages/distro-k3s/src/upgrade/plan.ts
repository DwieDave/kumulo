import type { K8sManifest, ResourceRef } from "@kumulo/core"
import { Result, Schema } from "effect"

const NAMESPACE = "system-upgrade"
const SERVICE_ACCOUNT = "system-upgrade"
const UPGRADE_IMAGE = "rancher/k3s-upgrade"

const CRITICAL_ADDONS_TOLERATION = {
  key: "CriticalAddonsOnly",
  operator: "Equal",
  value: "true",
  effect: "NoExecute"
}

export const renderMastersPlan = (version: string): K8sManifest => ({
  apiVersion: "upgrade.cattle.io/v1",
  kind: "Plan",
  metadata: { name: "k3s-server", namespace: NAMESPACE, labels: { "k3s-upgrade": "server" } },
  spec: {
    concurrency: 1,
    version,
    nodeSelector: {
      matchExpressions: [{ key: "node-role.kubernetes.io/control-plane", operator: "In", values: ["true"] }]
    },
    serviceAccountName: SERVICE_ACCOUNT,
    tolerations: [CRITICAL_ADDONS_TOLERATION],
    cordon: true,
    upgrade: { image: UPGRADE_IMAGE }
  }
})

export interface WorkersPlanArgs {
  readonly version: string
  readonly concurrency: number
}

export const renderWorkersPlan = ({ version, concurrency }: WorkersPlanArgs): K8sManifest => ({
  apiVersion: "upgrade.cattle.io/v1",
  kind: "Plan",
  metadata: { name: "k3s-agent", namespace: NAMESPACE, labels: { "k3s-upgrade": "agent" } },
  spec: {
    concurrency,
    version,
    nodeSelector: {
      matchExpressions: [{ key: "node-role.kubernetes.io/control-plane", operator: "NotIn", values: ["true"] }]
    },
    serviceAccountName: SERVICE_ACCOUNT,
    tolerations: [
      { key: "", operator: "Exists", value: "", effect: "NoSchedule" },
      CRITICAL_ADDONS_TOLERATION
    ],
    prepare: { image: UPGRADE_IMAGE, args: ["prepare", "k3s-server"] },
    cordon: true,
    upgrade: { image: UPGRADE_IMAGE }
  }
})

export interface UpgradePlanArgs {
  readonly version: string
  readonly workerConcurrency?: number
}

// apply order matters: agents' prepare step polls the server Plan by name
export const renderUpgradePlan = (
  { version, workerConcurrency = 1 }: UpgradePlanArgs
): ReadonlyArray<K8sManifest> => [renderMastersPlan(version), renderWorkersPlan({ version, concurrency: workerConcurrency })]

const PlanObjectMeta = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  namespace: Schema.optionalKey(Schema.String)
})

const _metadata = (manifest: K8sManifest): { name: string; namespace: string } => {
  const decoded = Result.getOrElse(
    Schema.decodeUnknownResult(PlanObjectMeta)(manifest.metadata),
    () => ({ name: undefined, namespace: undefined })
  )
  return { name: decoded.name ?? "", namespace: decoded.namespace ?? NAMESPACE }
}

export const refForPlan = (manifest: K8sManifest): ResourceRef => {
  const { name, namespace } = _metadata(manifest)
  return { path: `/apis/upgrade.cattle.io/v1/namespaces/${namespace}/plans/${name}`, kind: "Plan" }
}
