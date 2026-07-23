import type { K8sManifest } from "@kumulo/core"

const NAMESPACE = "kube-system"
const IMAGE = "quay.io/cilium/cilium:v1.16.5"

// design §3.4 / D5: optional CNI replacing k3s's built-in flannel — only
// selectable capability-gated (`cilium`), never under ovh-mks (CNI fixed by
// OVH; rejected earlier by core's validateCni, see packages/core/src/ports/validation.ts).
export const ciliumManifests = (): ReadonlyArray<K8sManifest> => [
  {
    apiVersion: "v1",
    kind: "ServiceAccount",
    metadata: { name: "cilium", namespace: NAMESPACE }
  },
  {
    apiVersion: "apps/v1",
    kind: "DaemonSet",
    metadata: { name: "cilium", namespace: NAMESPACE },
    spec: {
      selector: { matchLabels: { "k8s-app": "cilium" } },
      template: {
        metadata: { labels: { "k8s-app": "cilium" } },
        spec: {
          serviceAccountName: "cilium",
          hostNetwork: true,
          containers: [{ name: "cilium-agent", image: IMAGE, args: ["--kube-proxy-replacement=true"] }]
        }
      }
    }
  }
]
