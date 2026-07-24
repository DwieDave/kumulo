import type { K8sManifest } from "@kumulo/core"
import { CLOUD_CONF_NAMESPACE, CLOUD_CONF_SECRET_NAME, cloudConfSecretManifest, type CloudConf } from "../cloud-conf.ts"

const SERVICE_ACCOUNT = "openstack-cloud-controller-manager"
const IMAGE = "registry.k8s.io/provider-os/openstack-cloud-controller-manager:v1.30.0"

// openstack-ccm consumes the generated cloud.conf Secret; manifests are
// static (no Helm) — a DaemonSet on control-plane nodes, per upstream's
// recommended install.
export const openstackCcmManifests = (conf: CloudConf): ReadonlyArray<K8sManifest> => [
  cloudConfSecretManifest(conf),
  {
    apiVersion: "v1",
    kind: "ServiceAccount",
    metadata: { name: SERVICE_ACCOUNT, namespace: CLOUD_CONF_NAMESPACE }
  },
  {
    apiVersion: "rbac.authorization.k8s.io/v1",
    kind: "ClusterRoleBinding",
    metadata: { name: "system:openstack-cloud-controller-manager" },
    roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "ClusterRole", name: "cluster-admin" },
    subjects: [{ kind: "ServiceAccount", name: SERVICE_ACCOUNT, namespace: CLOUD_CONF_NAMESPACE }]
  },
  {
    apiVersion: "apps/v1",
    kind: "DaemonSet",
    metadata: { name: "openstack-cloud-controller-manager", namespace: CLOUD_CONF_NAMESPACE },
    spec: {
      selector: { matchLabels: { k8s_app: "openstack-cloud-controller-manager" } },
      template: {
        metadata: { labels: { k8s_app: "openstack-cloud-controller-manager" } },
        spec: {
          serviceAccountName: SERVICE_ACCOUNT,
          nodeSelector: { "node-role.kubernetes.io/control-plane": "" },
          tolerations: [{ key: "node-role.kubernetes.io/control-plane", effect: "NoSchedule" }],
          containers: [{
            name: "openstack-cloud-controller-manager",
            image: IMAGE,
            args: ["/bin/openstack-cloud-controller-manager", "--cloud-config=/etc/config/cloud.conf", "--cluster-name=kubernetes"],
            volumeMounts: [{ name: "cloud-config", mountPath: "/etc/config", readOnly: true }]
          }],
          volumes: [{ name: "cloud-config", secret: { secretName: CLOUD_CONF_SECRET_NAME } }]
        }
      }
    }
  }
]
