/** @kumulo/openstack — package barrel. */
export const packageName = "@kumulo/openstack"

// kumulo: WHY re-exported here — dep-lint only allows importing another
// package's root (`no-deep-package-imports`), so real internals get
// re-exported here rather than reached via deep paths.
export { KeystoneAuth, KeystoneAuthLive } from "./auth/keystone-auth.ts"
export type { EndpointOptions, KeystoneAuthLiveOptions } from "./auth/keystone-auth.ts"
export { credentialsFromCloudsYaml, credentialsFromEnv, loadCredentials } from "./auth/credentials.ts"
export type { OpenStackCredentials } from "./auth/credentials.ts"
export { CloudProviderLive, resolveFlavor, resolveImage } from "./provider/cloud-provider.ts"
export type { CloudProviderOptions } from "./provider/cloud-provider.ts"
// kumulo: WHY re-exported here — the k3s CLI composition root (packages/cli)
// needs the rule builder to assemble `SecGroupSpec`; dep-lint's
// no-deep-package-imports rule only allows reaching another package's
// declared barrel, not `provider/security-group-rules.ts` directly.
export { OpenStackHttpLive } from "./transport/http-client.ts"
export type { OpenStackError } from "./provider/errors.ts"
export { buildFr57Rules } from "./provider/security-group-rules.ts"
export type { SecurityGroupRuleInput } from "./provider/security-group-rules.ts"
