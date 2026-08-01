import type { K8sManifest } from "@kumulo/core"

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

export const CLOUD_CONF_SECRET_NAME = "cloud-config"
export const CLOUD_CONF_NAMESPACE = "kube-system"

export const cloudConfSecretManifest = (conf: CloudConf): K8sManifest => ({
  apiVersion: "v1",
  kind: "Secret",
  metadata: { name: CLOUD_CONF_SECRET_NAME, namespace: CLOUD_CONF_NAMESPACE },
  type: "Opaque",
  stringData: { "cloud.conf": renderCloudConfIni(conf) }
})
