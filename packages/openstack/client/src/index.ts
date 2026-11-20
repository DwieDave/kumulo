/** @kumulo/openstack — package barrel. */
export const packageName = "@kumulo/openstack"

export { KeystoneAuth, KeystoneAuthLive } from "./auth/keystone-auth.ts"

export { loadCredentials } from "./auth/credentials.ts"

export { openstackCloudProviderLive, resolveFlavor, resolveImage } from "./provider/cloud-provider.ts"

export type { CloudProviderOptions } from "./provider/cloud-provider.ts"

export { OpenStackHttpLive } from "./transport/http-client.ts"

export type { OpenStackError } from "./errors.ts"

export { buildFr57Rules } from "./provider/security-group-rules.ts"

export { openstackClusterAddons } from "./cluster/index.ts"
