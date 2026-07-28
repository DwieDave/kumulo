/** @kumulo/distro-ovh-mks — package barrel. */
export const packageName = "@kumulo/distro-ovh-mks"

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
  requireVrack,
  upgrade
} from "./distro/index.ts"
export type {
  ExistingNodePool,
  MksClusterConfig,
  MksClusterDrift,
  MksClusterInfo,
  MksClusterRef,
  MksClusterState,
  MksDesiredCluster,
  MksUpgradeStrategy,
  MksWorkerPoolConfig,
  NodePoolDiff
} from "./distro/index.ts"
