export const packageName = "@kumulo/addons"

export {
  CLOUD_CONF_NAMESPACE,
  CLOUD_CONF_SECRET_NAME,
  cloudConfSecretManifest,
  renderCloudConfIni
} from "./cloud-conf.ts"
export type { CloudConf } from "./cloud-conf.ts"

export { ciliumManifests } from "./manifests/cilium.ts"
export { cinderCsiManifests } from "./manifests/cinder-csi.ts"
export { hcloudCcmManifests } from "./manifests/hcloud-ccm.ts"
export { hcloudCsiManifests } from "./manifests/hcloud-csi.ts"
export { openstackCcmManifests } from "./manifests/openstack-ccm.ts"
export { systemUpgradeControllerManifests } from "./manifests/system-upgrade-controller.ts"

export { HCLOUD_NAMESPACE, HCLOUD_SECRET_NAME, hcloudSecretManifest } from "./hcloud-secret.ts"
export type { HcloudCredential } from "./hcloud-secret.ts"

export { refFor } from "./resource-ref.ts"

export { gateAddons, resolveAddons } from "./registry.ts"
export type { AddonSelectionInput, AddonToggles, CloudCredential } from "./registry.ts"

export { installAddons } from "./install.ts"
