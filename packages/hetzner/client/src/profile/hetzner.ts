import { Layer } from "effect"
import { ProviderProfile } from "@kumulo/core"
import { validateHetznerConfig } from "./validation.ts"

export const makeHetznerProfile = () => ({
  validate: validateHetznerConfig
})

export const hetznerProfileLive = Layer.succeed(ProviderProfile, makeHetznerProfile())
