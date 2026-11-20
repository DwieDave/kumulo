import { Layer } from "effect"
import { ProviderProfile } from "@kumulo/core"
import { validateOvhConfig } from "./validation.ts"

// `_region` is kept so existing callers (`ovhProfileLive(region)`) keep compiling; validation reads the region from the config.
export const makeOvhProfile = (_region?: string) => ({
  validate: validateOvhConfig
})

export const ovhProfileLive = (region?: string) => Layer.succeed(ProviderProfile, makeOvhProfile(region))
