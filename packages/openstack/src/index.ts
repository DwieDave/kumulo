/** Placeholder export proving the package resolves; real implementation lands in later tasks. */
export const packageName = "@kumulo/openstack"

// T6.3 (doctor OpenStack half) needs these across the package boundary —
// dep-lint only allows importing another package's root (`no-deep-package-imports`),
// so real internals get re-exported here rather than reached via deep paths.
export { KeystoneAuth, KeystoneAuthLive } from "./auth/keystone-auth.ts"
export type { EndpointOptions, KeystoneAuthLiveOptions } from "./auth/keystone-auth.ts"
export { credentialsFromCloudsYaml, credentialsFromEnv, loadCredentials } from "./auth/credentials.ts"
export type { OpenStackCredentials } from "./auth/credentials.ts"
export { CloudProviderLive, resolveFlavor, resolveImage } from "./provider/cloud-provider.ts"
export type { CloudProviderOptions } from "./provider/cloud-provider.ts"
