import type { K8sManifest } from "@kumulo/core"

// Minimal-scope cloud.conf for openstack-ccm/cinder-csi:
// application-credential auth only, no username/password fallback — the
// credential itself is created out-of-band, scoped to just what CCM/CSI need.
export interface CloudConf {
  readonly authUrl: string
  readonly region: string
  readonly applicationCredentialId: string
  readonly applicationCredentialSecret: string
}

export const renderCloudConfIni = (conf: CloudConf): string =>
  [
    "[Global]",
    `auth-url=${conf.authUrl}`,
    `region=${conf.region}`,
    `application-credential-id=${conf.applicationCredentialId}`,
    `application-credential-secret=${conf.applicationCredentialSecret}`,
    "use-application-credentials=true"
  ].join("\n") + "\n"

// kumulo: name/namespace fixed — both CCM and CSI reference this exact
// Secret by convention, no need for it to be configurable.
export const CLOUD_CONF_SECRET_NAME = "cloud-config"
export const CLOUD_CONF_NAMESPACE = "kube-system"

export const cloudConfSecretManifest = (conf: CloudConf): K8sManifest => ({
  apiVersion: "v1",
  kind: "Secret",
  metadata: { name: CLOUD_CONF_SECRET_NAME, namespace: CLOUD_CONF_NAMESPACE },
  type: "Opaque",
  stringData: { "cloud.conf": renderCloudConfIni(conf) }
})
