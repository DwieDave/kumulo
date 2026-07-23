// Domain types shared by port interfaces (design doc §3). Structural and
// minimal on purpose — the full config schema lives in a sibling package
// under concurrent development; only the shapes ports need are defined here.

export type ClusterTag = string
export type NodeRole = "master" | "worker"
export type DistroKind = "k3s" | "ovh-mks"
export type Capability = "octavia" | "floatingIps" | "cilium"
export type Version = string

export interface NetworkSpec {
  readonly cidr: string
}
export interface NetworkInfo {
  readonly id: string
  readonly cidr: string
}

export interface SecGroupSpec {
  readonly rules: ReadonlyArray<unknown>
}
export interface SecGroupInfo {
  readonly id: string
}

export interface LbSpec {
  readonly members: ReadonlyArray<string>
}
export interface LbInfo {
  readonly id: string
  readonly vip: string
}

export interface ServerSpec {
  readonly name: string
  readonly role: NodeRole
  readonly flavor: string
  readonly image: string
  readonly tag: ClusterTag
}
export interface ServerInfo {
  readonly id: string
  readonly name: string
  readonly ip: string
}

export type ImageRef = string
export type ImageId = string
export type FlavorRef = string
export type FlavorId = string

export interface Inventory {
  readonly servers: ReadonlyArray<ServerInfo>
  readonly networks: ReadonlyArray<NetworkInfo>
  readonly securityGroups: ReadonlyArray<SecGroupInfo>
  readonly loadBalancers: ReadonlyArray<LbInfo>
}

export interface ManagedClusterRef {
  readonly id: string
}
export interface ManagedClusterInfo {
  readonly id: string
  readonly apiEndpoint: string
  readonly status: string
}

export interface Kubeconfig {
  readonly content: string
}
export interface SshTarget {
  readonly host: string
  readonly user: string
}
export interface NodeContext {
  readonly role: NodeRole
  readonly token?: string
  readonly apiEndpoint: string
}
export interface BootstrapPlan {
  readonly order: ReadonlyArray<string>
}
export interface NodeRef {
  readonly name: string
  readonly role: NodeRole
}
export interface ResolvedVersion {
  readonly value: string
}

export interface K8sManifest {
  readonly apiVersion: string
  readonly kind: string
  readonly [key: string]: unknown
}
export interface AddonContext {
  readonly clusterName: string
  readonly capabilities: ReadonlyArray<Capability>
}

export interface DesiredRecord {
  readonly name: string
  readonly target: "api_server" | "ingress" | string
}

export interface VolumeSpec {
  readonly name: string
  readonly sizeGb: number
  readonly type: string
  readonly retain: boolean
}
export interface VolumeInfo {
  readonly id: string
  readonly name: string
}
export interface VolumeRef {
  readonly id: string
}

// Minimal structural slice of ClusterConfig needed for cross-distro
// validation rules (§5, §9) — field names match the real config schema
// (packages/core/src/config/schema.ts) so any `ClusterConfig.Type` value
// satisfies this shape structurally, with no adapter/cast required.
export interface AutoscalingRule {
  readonly enabled: boolean
}
export interface WorkerPoolShape {
  readonly name: string
  readonly autoscaling?: AutoscalingRule
}
export interface ClusterConfigShape {
  readonly distro: DistroKind
  readonly worker_pools: ReadonlyArray<WorkerPoolShape>
  readonly addons: { readonly cni: "flannel" | "cilium" }
  // kumulo: added for T6.2 provider-profile validation (FR-1.4) — region
  // for per-region capability checks, HA flag for the Octavia-fallback
  // rule, retained volume types for the volume-type allowlist rule. Real
  // ClusterConfig (config/schema.ts) is a structural superset, so any
  // decoded config satisfies this shape with no adapter.
  readonly auth?: { readonly region: string }
  readonly api_server?: { readonly high_availability: boolean }
  readonly volumes?: { readonly retained: ReadonlyArray<{ readonly type: string }> }
}
