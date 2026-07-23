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
export { openstackCcmManifests } from "./manifests/openstack-ccm.ts"
export { systemUpgradeControllerManifests } from "./manifests/system-upgrade-controller.ts"

export { refFor } from "./resource-ref.ts"

export { gateAddons, resolveAddons } from "./registry.ts"
export type { AddonSelectionInput, AddonToggles } from "./registry.ts"

export { installAddons } from "./install.ts"
