import type { Addon } from "@kumulo/core"
import { cinderCsiManifests } from "./cinder-csi.ts"
import type { CloudConf } from "./cloud-conf.ts"
import { openstackCcmManifests } from "./openstack-ccm.ts"

export interface OpenstackClusterAddonsInput {
  readonly conf: CloudConf
  readonly ccm: boolean
  readonly csi: false | { readonly defaultVolumeType?: string | undefined }
}

export const openstackClusterAddons = ({ ccm, conf, csi }: OpenstackClusterAddonsInput): ReadonlyArray<Addon> => [
  ...(ccm ? [{ name: "openstack-ccm", manifests: openstackCcmManifests(conf) }] : []),
  ...(csi !== false
    ? [{ name: "cinder-csi", manifests: cinderCsiManifests({ conf, defaultVolumeType: csi.defaultVolumeType }) }]
    : [])
]
