/** @kumulo/distro-ovh-mks — package barrel. */
export const packageName = "@kumulo/distro-ovh-mks"

export { MksClusterConfig } from "./config.ts"
export type { MksClusterConfigEncoded } from "./config.ts"

export { makeMksClient } from "./client/mks.ts"
export type { Mks, MksError } from "./client/mks.ts"

export {
  clusterDrift,
  deleteCluster,
  diffNodePools,
  driftConflict,
  ensureCluster,
  ensureNodePools,
  fetchKubeconfig,
  findClusterByName,
  listNodePools,
  mksPoolHash,
  parseKubeVersion,
  pollUntil,
  ensureGateway,
  type GatewayModel,
  requireVrack,
  upgrade
} from "./distro/index.ts"
export type {
  ExistingNodePool,
  MksDriverConfig,
  MksClusterDrift,
  MksClusterInfo,
  MksClusterRef,
  MksClusterState,
  MksDesiredCluster,
  MksUpgradeStrategy,
  MksWorkerPoolConfig,
  NodePoolDiff
} from "./distro/index.ts"
