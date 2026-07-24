import type { K8sManifest } from "@kumulo/core"
import { HCLOUD_NAMESPACE, HCLOUD_SECRET_NAME, hcloudSecretManifest, type HcloudCredential } from "../hcloud-secret.ts"

const SERVICE_ACCOUNT = "hcloud-csi-controller"
const IMAGE = "hetznercloud/hcloud-csi-driver:v2.22.0"
const STORAGE_CLASS = "hcloud-volumes"

// Shares the `hcloud` Secret with hcloud-ccm; provisioner `csi.hetzner.cloud`,
// `hcloud-volumes` the default StorageClass (R10). Compact controller-only
// representation (mirrors `cinder-csi.ts`'s style) — the node-side driver
// registration/attach machinery is out of this addon's scope.
export const hcloudCsiManifests = (credential: HcloudCredential): ReadonlyArray<K8sManifest> => [
  hcloudSecretManifest(credential),
  {
    apiVersion: "v1",
    kind: "ServiceAccount",
    metadata: { name: SERVICE_ACCOUNT, namespace: HCLOUD_NAMESPACE }
  },
  {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: "hcloud-csi-controller", namespace: HCLOUD_NAMESPACE },
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: "hcloud-csi-controller" } },
      template: {
        metadata: { labels: { app: "hcloud-csi-controller" } },
        spec: {
          serviceAccountName: SERVICE_ACCOUNT,
          containers: [{
            name: "hcloud-csi-driver",
            image: IMAGE,
            args: ["-controller"],
            env: [
              { name: "CSI_ENDPOINT", value: "unix:///run/csi/socket" },
              { name: "HCLOUD_TOKEN", valueFrom: { secretKeyRef: { name: HCLOUD_SECRET_NAME, key: "token" } } }
            ]
          }]
        }
      }
    }
  },
  {
    apiVersion: "storage.k8s.io/v1",
    kind: "StorageClass",
    metadata: { name: STORAGE_CLASS, annotations: { "storageclass.kubernetes.io/is-default-class": "true" } },
    provisioner: "csi.hetzner.cloud",
    reclaimPolicy: "Delete",
    volumeBindingMode: "WaitForFirstConsumer",
    allowVolumeExpansion: true
  }
]
