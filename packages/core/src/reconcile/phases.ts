// Design §2/§3.3.1, FR-2.3 — the phase pipeline branches exactly once on
// distro kind. Ordering is data, not control flow, so the branch itself
// stays a one-line lookup and every phase's dependency order is visible
// in one place instead of scattered across if/else chains.

export type PhaseName =
  | "Network"
  | "Security"
  | "ServerGroups"
  | "LB"
  | "Nodes"
  | "Bootstrap"
  | "Addons"
  | "DNS"
  | "Volumes"
  | "Kubeconfig"
  | "EnsureCluster"
  | "EnsureNodePools"

// Self-managed (k3s): full infra pipeline, design §2.
export const SELF_MANAGED_PHASES: ReadonlyArray<PhaseName> = [
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
]

// Managed (ovh-mks): OVH owns the infra phases, design §3.3.1.
export const MANAGED_PHASES: ReadonlyArray<PhaseName> = [
  "EnsureCluster",
  "EnsureNodePools",
  "Addons",
  "DNS",
  "Volumes",
  "Kubeconfig"
]

// The single distro-kind branch point (FR-2.3). Concrete phase Effects are
// supplied by callers (later milestones); this just picks the order.
export const phasesForKind = (kind: "self-managed" | "managed"): ReadonlyArray<PhaseName> =>
  kind === "self-managed" ? SELF_MANAGED_PHASES : MANAGED_PHASES
