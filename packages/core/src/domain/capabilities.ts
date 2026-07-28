import type { DistroKind } from "./types.ts"

// What each distro can actually do. Adding a DistroKind breaks compilation here.
export interface DistroCapabilities {
  readonly autoscaling: boolean
  readonly selectableCni: boolean
}

export const distroCapabilities: Record<DistroKind, DistroCapabilities> = {
  "k3s": { autoscaling: false, selectableCni: true },
  "ovh-mks": { autoscaling: true, selectableCni: false },
  "upcloud-uks": { autoscaling: false, selectableCni: false }
}
