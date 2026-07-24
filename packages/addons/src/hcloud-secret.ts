import type { K8sManifest } from "@kumulo/core"

// Env-var delivery (HCLOUD_TOKEN/HCLOUD_NETWORK), not a mounted file, unlike
// `cloud-conf.ts`'s INI — hcloud-ccm/hcloud-csi both read these directly
// from their container env (R10). `network` is only present when
// private-network routing is enabled; its absence is not an error.
export interface HcloudCredential {
  readonly token: string
  readonly network?: string
}

export const HCLOUD_SECRET_NAME = "hcloud"
export const HCLOUD_NAMESPACE = "kube-system"

export const hcloudSecretManifest = ({ network, token }: HcloudCredential): K8sManifest => ({
  apiVersion: "v1",
  kind: "Secret",
  metadata: { name: HCLOUD_SECRET_NAME, namespace: HCLOUD_NAMESPACE },
  type: "Opaque",
  stringData: network === undefined ? { token } : { network, token }
})
