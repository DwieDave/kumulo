// kumulo: hcloud Volumes have a hard 10GB minimum (R8) — requests below it
// are rounded up rather than rejected, matching the OVH path's tolerance for
// under-sized requests while still surfacing the adjustment loudly (caller
// logs when `requested !== size`).
export const HCLOUD_MIN_VOLUME_SIZE_GB = 10

export const enforceMinimumVolumeSize = (requestedGb: number): number => Math.max(requestedGb, HCLOUD_MIN_VOLUME_SIZE_GB)
