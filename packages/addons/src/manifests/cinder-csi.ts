import type { K8sManifest } from "@kumulo/core"
import { CLOUD_CONF_NAMESPACE, CLOUD_CONF_SECRET_NAME, cloudConfSecretManifest, type CloudConf } from "../cloud-conf.ts"

const SERVICE_ACCOUNT = "cinder-csi-controller-sa"
const IMAGE = "registry.k8s.io/provider-os/cinder-csi-plugin:v1.30.0"

// Shares the cloud.conf Secret with openstack-ccm;
// `defaultVolumeType` comes from config.addons.cinder_csi.default_volume_type.
export interface CinderCsiParams {
  readonly conf: CloudConf
  readonly defaultVolumeType: string
}

export const cinderCsiManifests = ({ conf, defaultVolumeType }: CinderCsiParams): ReadonlyArray<K8sManifest> => [
  cloudConfSecretManifest(conf),
  {
    apiVersion: "v1",
    kind: "ServiceAccount",
    metadata: { name: SERVICE_ACCOUNT, namespace: CLOUD_CONF_NAMESPACE }
  },
  {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: "csi-cinder-controllerplugin", namespace: CLOUD_CONF_NAMESPACE },
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: "csi-cinder-controllerplugin" } },
      template: {
        metadata: { labels: { app: "csi-cinder-controllerplugin" } },
        spec: {
          serviceAccountName: SERVICE_ACCOUNT,
          containers: [{
            name: "cinder-csi-plugin",
            image: IMAGE,
            args: ["/bin/cinder-csi-plugin", "--cloud-config=/etc/config/cloud.conf"],
            volumeMounts: [{ name: "cloud-config", mountPath: "/etc/config", readOnly: true }]
          }],
          volumes: [{ name: "cloud-config", secret: { secretName: CLOUD_CONF_SECRET_NAME } }]
        }
      }
    }
  },
  {
    apiVersion: "storage.k8s.io/v1",
    kind: "StorageClass",
    metadata: { name: "cinder-csi" },
    provisioner: "cinder.csi.openstack.org",
    parameters: { type: defaultVolumeType },
    reclaimPolicy: "Delete",
    volumeBindingMode: "WaitForFirstConsumer"
  }
]
