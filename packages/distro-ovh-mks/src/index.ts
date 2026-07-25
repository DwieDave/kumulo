/** @kumulo/distro-ovh-mks — package barrel. */
export const packageName = "@kumulo/distro-ovh-mks"

export { makeMksClient } from "./client/mks.ts"
export type { Mks, MksError } from "./client/mks.ts"

export {
  deleteCluster,
  diffNodePools,
  ensureCluster,
  ensureNodePools,
  fetchKubeconfig,
  findClusterByName,
  listNodePools,
  parseKubeVersion,
  upgrade
} from "./distro/index.ts"
export type {
  ExistingNodePool,
  MksClusterConfig,
  MksClusterRef,
  MksUpgradeStrategy,
  MksWorkerPoolConfig,
  NodePoolDiff
} from "./distro/index.ts"
