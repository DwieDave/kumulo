// kumulo: `ManagedDistro` building blocks for UpCloud Managed Kubernetes —
// the pure M4 pieces plus the M5 driver functions that talk to
// `@kumulo/upcloud`. Not wired into a literal `ManagedDistroShape` here (that
// adapter is the CLI composition root's job, M6, same as `distro-ovh-mks`) —
// this barrel is what it composes.
export { clusterDrift, driftConflict } from "./cluster-drift.ts"
export type { UksClusterDrift, UksClusterState, UksDesiredCluster } from "./cluster-drift.ts"
export { KUMULO_POOL_LABEL_KEY, diffNodePools, uksPoolHash, uksPoolName } from "./nodegroup-diff.ts"
export type { ExistingNodeGroup, NodeGroupDiff } from "./nodegroup-diff.ts"
export { resolveUpgradeTarget } from "./upgrade.ts"
export type { UpgradeTarget } from "./upgrade.ts"
export { isValidLabel, KUMULO_OWNER_LABEL_KEY, ownershipLabels } from "./ownership.ts"
export type { UksClusterConfig, UksClusterRef, UksClients, UksLabel, UksUpgradeStrategy, UksWorkerPoolConfig } from "./types.ts"

export { pollUntil } from "./status.ts"
export type { StatusPollOptions } from "./status.ts"
export { ensureNetwork, deleteNetwork, networkName, routerName } from "./network.ts"
export type { EnsuredNetwork } from "./network.ts"
export { ensureCluster, findClusterByName } from "./ensure-cluster.ts"
export type { UksClusterInfo } from "./ensure-cluster.ts"
export { ensureNodePools, listNodeGroups } from "./ensure-nodepools.ts"
export { fetchKubeconfig } from "./kubeconfig.ts"
export { upgradeCluster } from "./upgrade-cluster.ts"
export { deleteAll, deleteCluster } from "./delete.ts"
