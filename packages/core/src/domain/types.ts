import type { Redacted } from "effect"

export type ClusterTag = string
export type NodeRole = "master" | "worker"
export type DistroKind = "k3s" | "ovh-mks" | "upcloud-uks"
export type Capability = "octavia" | "floatingIps" | "cilium"
export type Version = string

export interface NetworkSpec {
  readonly cidr: string
  readonly nodesSubnet?: string
  readonly loadBalancersSubnet?: string
}
export interface GatewayRef {
  readonly name: string
}

export interface NetworkInfo {
  readonly id: string
  readonly cidr: string
  readonly nodesSubnetId?: string
  readonly loadBalancersSubnetId?: string
}

export interface SecGroupRule {
  readonly protocol: "tcp" | "udp" | "icmp" | "any"
  readonly portMin?: number
  readonly portMax?: number
  readonly remoteCidr?: string
  readonly remoteGroupSelf?: boolean
}

export interface SecGroupSpec {
  readonly rules: ReadonlyArray<SecGroupRule>
}
export interface SecGroupInfo {
  readonly id: string
}

// kumulo: LB is created EMPTY — once a Service adopts it by id, listeners/pools/members belong to the CCM; kumulo never diffs them again.
export interface LbSpec {
  readonly members: ReadonlyArray<string>
  readonly vipSubnetId?: string
  readonly vipNetworkId?: string
  readonly flavorId?: string
  readonly flavorName?: string
  readonly floatingIp?: boolean
}
export interface LbInfo {
  readonly id: string
  readonly vip: string
  readonly floatingIp?: string
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
  readonly configHash?: string | undefined
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
  readonly name: string
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

export interface BucketSpec {
  readonly name: string
  readonly region: string
  readonly versioning: boolean
  readonly encryption: boolean
  readonly retain: boolean
}
export interface BucketInfo {
  readonly name: string
  readonly region: string
  readonly endpoint: string
}
export interface BucketRef {
  readonly name: string
  readonly region: string
}

export interface S3Credentials {
  readonly user: string
  readonly accessKey: Redacted.Redacted<string>
  readonly secretKey: Redacted.Redacted<string>
  readonly buckets: ReadonlyArray<BucketInfo>
}

export interface CredentialEntry {
  readonly key: string
  readonly value: Redacted.Redacted<string>
}

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
  readonly auth?: { readonly region: string }
  readonly api_server?: { readonly high_availability: boolean }
  readonly volumes?: { readonly managed: ReadonlyArray<{ readonly type: string }> }
}
