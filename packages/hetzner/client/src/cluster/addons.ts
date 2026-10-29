import type { Addon } from "@kumulo/core"
import { hcloudCcmManifests } from "./hcloud-ccm.ts"
import { hcloudCsiManifests } from "./hcloud-csi.ts"

export interface HetznerClusterAddonsInput {
  readonly token: string
  readonly network?: string
  readonly ccm: boolean
  readonly csi: boolean
}

export const hetznerClusterAddons = (input: HetznerClusterAddonsInput): ReadonlyArray<Addon> => {
  const credential = input.network === undefined ? { token: input.token } : { token: input.token, network: input.network }

  return [
    ...(input.ccm ? [{ name: "hcloud-ccm", manifests: hcloudCcmManifests(credential) }] : []),
    ...(input.csi ? [{ name: "hcloud-csi", manifests: hcloudCsiManifests(credential) }] : [])
  ]
}
