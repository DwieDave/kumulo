export type ClusterKind = "self-managed" | "managed"

export const SELF_MANAGED_PHASES = [
  "Network",
  "Security",
  "ServerGroups",
  "LB",
  "Nodes",
  "Bootstrap",
  "Addons",
  "DNS",
  "Volumes",
  "Kubeconfig"
] as const

// Managed control planes (OVH MKS) own network/nodes themselves, so the
// infra phases are skipped entirely rather than no-op'ed.
export const MANAGED_PHASES = [
  "EnsureCluster",
  "EnsureNodePools",
  "Addons",
  "DNS",
  "Volumes",
  "Kubeconfig"
] as const

export type PhaseName = (typeof SELF_MANAGED_PHASES)[number] | (typeof MANAGED_PHASES)[number]

export const phasesForKind = (kind: ClusterKind): ReadonlyArray<PhaseName> =>
  kind === "managed" ? MANAGED_PHASES : SELF_MANAGED_PHASES
