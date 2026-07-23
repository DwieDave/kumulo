export const packageName = "@kumulo/provider-ovh"

export { makeOvhProfile, ovhProfileLive } from "./profile/ovh.ts"
export { hasOctavia, octaviaRegions } from "./profile/regions.ts"
export { imageAliasesForRegion } from "./profile/image-aliases.ts"
export { validateOvhConfig } from "./profile/validation.ts"
