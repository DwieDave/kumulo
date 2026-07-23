export const packageName = "@kumulo/provider-ovh"

export { makeOvhProfile, ovhProfileLive } from "./profile/ovh.ts"
export { hasOctavia, octaviaRegions } from "./profile/regions.ts"
export { imageAliasesForRegion } from "./profile/image-aliases.ts"
export { validateOvhConfig } from "./profile/validation.ts"

export { OvhAuth } from "./auth/port.ts"
export type { OvhAuthShape } from "./auth/port.ts"
export { OvhAuthLive, OVH_TOKEN_ENDPOINT } from "./auth/live.ts"
export type { OvhCredentials } from "./auth/live.ts"
export { ovhHttpClientLayer, OVH_API_BASE_URL } from "./auth/client.ts"
