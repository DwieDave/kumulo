import type { NodeRole } from "../domain/types.ts"

export interface ResourceCoordinates {
  readonly cluster: string
  readonly role: NodeRole
  readonly pool: string
  readonly index: number
}

// Design §6 / Appendix B naming convention: kumulo-<cluster>-<role>-<pool>-<index>
export const resourceName = ({ cluster, role, pool, index }: ResourceCoordinates): string =>
  `kumulo-${cluster}-${role}-${pool}-${index}`
