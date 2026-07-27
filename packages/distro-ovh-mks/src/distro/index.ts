// kumulo: `ManagedDistro` implementation for OVH Managed Kubernetes. Not
// wired into `src/index.ts`'s exact `ManagedDistroShape` (that adapter is
// the composition root's job) — these are the concrete building blocks it
// composes.
export { ensureCluster, findClusterByName } from "./ensure-cluster.ts"
export { parseKubeVersion } from "./parse-kube-version.ts"
export { ensureNodePools, listNodePools } from "./ensure-nodepools.ts"
export { fetchKubeconfig } from "./kubeconfig.ts"
export { upgrade } from "./upgrade.ts"
export { deleteCluster } from "./delete.ts"
export { diffNodePools, mksPoolHash } from "./nodepool-diff.ts"
export type { ExistingNodePool, NodePoolDiff } from "./nodepool-diff.ts"
export type { MksClusterConfig, MksClusterRef, MksUpgradeStrategy, MksWorkerPoolConfig } from "./types.ts"
