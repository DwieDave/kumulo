import type { K8sManifest } from "@kumulo/core"

// FR-5.6 / design §3.4: SUC (rancher/system-upgrade-controller) Plan CRs for
// a k3s version bump. Ports hetzner-k3s's templates/upgrade_plan_for_*.yaml
// mechanics (concurrency, cordon, prepare-waits-on-server), fixing the
// source's duplicate-`matchExpressions`-key YAML bug (the second key
// silently clobbers the first there) by folding both role labels into one
// selector.
const NAMESPACE = "system-upgrade"
const SERVICE_ACCOUNT = "system-upgrade"
const UPGRADE_IMAGE = "rancher/k3s-upgrade"

const CRITICAL_ADDONS_TOLERATION = {
  key: "CriticalAddonsOnly",
  operator: "Equal",
  value: "true",
  effect: "NoExecute"
}

/** Masters plan: concurrency 1 (etcd quorum safety), cordon, control-plane-only nodeSelector. */
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

/** Workers plan: configurable concurrency, `prepare` waits on the k3s-server Plan reaching this version first. */
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

/** FR-5.6 — the full SUC plan set for a target k3s version; masters listed before workers (apply order matters: agents' `prepare` step polls the server Plan by name). */
export const renderUpgradePlan = (
  { version, workerConcurrency = 1 }: UpgradePlanArgs
): ReadonlyArray<K8sManifest> => [renderMastersPlan(version), renderWorkersPlan({ version, concurrency: workerConcurrency })]
