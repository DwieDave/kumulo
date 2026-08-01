import type { K8sManifest } from "@kumulo/core"
import { HCLOUD_NAMESPACE, HCLOUD_SECRET_NAME, hcloudSecretManifest, type HcloudCredential } from "../hcloud-secret.ts"

const SERVICE_ACCOUNT = "hcloud-cloud-controller-manager"
// kumulo: pinned >= v1.30.1 (2026-07-01 removed `server.datacenter`, breaks <= v1.30.0); never pin `:latest`.
const IMAGE = "hetznercloud/hcloud-cloud-controller-manager:v1.34.0"

export const hcloudCcmManifests = (credential: HcloudCredential): ReadonlyArray<K8sManifest> => [
  hcloudSecretManifest(credential),
  {
    apiVersion: "v1",
    kind: "ServiceAccount",
    metadata: { name: SERVICE_ACCOUNT, namespace: HCLOUD_NAMESPACE }
  },
  {
    apiVersion: "rbac.authorization.k8s.io/v1",
    kind: "ClusterRoleBinding",
    metadata: { name: "system:hcloud-cloud-controller-manager" },
    roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "ClusterRole", name: "cluster-admin" },
    subjects: [{ kind: "ServiceAccount", name: SERVICE_ACCOUNT, namespace: HCLOUD_NAMESPACE }]
  },
  {
    apiVersion: "apps/v1",
    kind: "DaemonSet",
    metadata: { name: "hcloud-cloud-controller-manager", namespace: HCLOUD_NAMESPACE },
    spec: {
      selector: { matchLabels: { app: "hcloud-cloud-controller-manager" } },
      template: {
        metadata: { labels: { app: "hcloud-cloud-controller-manager" } },
        spec: {
          serviceAccountName: SERVICE_ACCOUNT,
          hostNetwork: true,
          nodeSelector: { "node-role.kubernetes.io/control-plane": "" },
          tolerations: [
            { key: "node-role.kubernetes.io/control-plane", effect: "NoSchedule" },
            { key: "node.cloudprovider.kubernetes.io/uninitialized", value: "true", effect: "NoSchedule" }
          ],
          containers: [{
            name: "hcloud-cloud-controller-manager",
            image: IMAGE,
            args: ["--cloud-provider=hcloud", "--allow-untagged-cloud", "--leader-elect=false"],
            env: [
              { name: "HCLOUD_TOKEN", valueFrom: { secretKeyRef: { name: HCLOUD_SECRET_NAME, key: "token" } } },
              { name: "HCLOUD_NETWORK", valueFrom: { secretKeyRef: { name: HCLOUD_SECRET_NAME, key: "network", optional: true } } }
            ]
          }]
        }
      }
    }
  }
]
