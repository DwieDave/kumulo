import type { K8sManifest } from "@kumulo/core"

const NAMESPACE = "system-upgrade"
const IMAGE = "rancher/system-upgrade-controller:v0.13.4"

// design §3.4 / FR-9.1, FR-6.2: SUC itself is addon-installed; `upgrade`
// (T8.3) renders the Plan CRs consumed by this controller.
export const systemUpgradeControllerManifests = (): ReadonlyArray<K8sManifest> => [
  { apiVersion: "v1", kind: "Namespace", metadata: { name: NAMESPACE } },
  {
    apiVersion: "v1",
    kind: "ServiceAccount",
    metadata: { name: "system-upgrade-controller", namespace: NAMESPACE }
  },
  {
    apiVersion: "rbac.authorization.k8s.io/v1",
    kind: "ClusterRoleBinding",
    metadata: { name: "system-upgrade-controller" },
    roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "ClusterRole", name: "cluster-admin" },
    subjects: [{ kind: "ServiceAccount", name: "system-upgrade-controller", namespace: NAMESPACE }]
  },
  {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: "system-upgrade-controller", namespace: NAMESPACE },
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: "system-upgrade-controller" } },
      template: {
        metadata: { labels: { app: "system-upgrade-controller" } },
        spec: {
          serviceAccountName: "system-upgrade-controller",
          containers: [{ name: "system-upgrade-controller", image: IMAGE }]
        }
      }
    }
  }
]
