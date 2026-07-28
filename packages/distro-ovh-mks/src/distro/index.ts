// kumulo: `ManagedDistro` implementation for OVH Managed Kubernetes. Not
// wired into `src/index.ts`'s exact `ManagedDistroShape` (that adapter is
// the composition root's job) — these are the concrete building blocks it
// composes.
export { ensureCluster, findClusterByName } from "./ensure-cluster.ts"
export type { MksClusterInfo } from "./ensure-cluster.ts"
export { clusterDrift } from "./cluster-drift.ts"
export type { MksClusterDrift, MksClusterState, MksDesiredCluster } from "./cluster-drift.ts"
export { parseKubeVersion } from "./parse-kube-version.ts"
export { ensureNodePools, listNodePools } from "./ensure-nodepools.ts"
export { fetchKubeconfig } from "./kubeconfig.ts"
export { upgrade } from "./upgrade.ts"
export { deleteCluster } from "./delete.ts"
export { requireVrack } from "./vrack.ts"
export { diffNodePools, mksPoolHash } from "./nodepool-diff.ts"
export type { ExistingNodePool, NodePoolDiff } from "./nodepool-diff.ts"
export type { MksClusterConfig, MksClusterRef, MksUpgradeStrategy, MksWorkerPoolConfig } from "./types.ts"
