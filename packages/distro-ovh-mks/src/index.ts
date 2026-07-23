/** Placeholder export proving the package resolves; real implementation lands in later tasks. */
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
