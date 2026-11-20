import { crossFieldRule } from "@kumulo/core"

export const hetznerVolumesConsistentWithProvider = crossFieldRule({
  check: (config: { provider: string; volumes: { module: string } }) => {
    if (config.volumes.module === "hcloud" && config.provider !== "hetzner")
      return "volumes.module hcloud requires provider hetzner"

    if (config.volumes.module === "cinder" && config.provider === "hetzner")
      return "volumes.module cinder is not available on provider hetzner"

    return undefined
  },
  jsonSchema: [
    {
      if: { properties: { provider: { const: "hetzner" } }, required: ["provider"] },
      then: { properties: { volumes: { properties: { module: { enum: ["hcloud", "none"] } } } } },
      else: { properties: { volumes: { properties: { module: { not: { const: "hcloud" } } } } } }
    }
  ]
})

export const hetznerCsiHasNoVolumeType = crossFieldRule({
  check: (config: { provider: string; addons?: { csi: { default_volume_type?: string | undefined } } }) =>
    config.provider === "hetzner" && config.addons?.csi.default_volume_type !== undefined
      ? "addons.csi.default_volume_type is not supported when provider is hetzner (Hetzner volumes have no types)"
      : undefined,
  jsonSchema: [
    {
      if: { properties: { provider: { const: "hetzner" } }, required: ["provider"] },
      then: { properties: { addons: { properties: { csi: { not: { required: ["default_volume_type"] } } } } } }
    }
  ]
})

export const hetznerConfigRules = [hetznerVolumesConsistentWithProvider, hetznerCsiHasNoVolumeType]
