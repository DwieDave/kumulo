import { ResourceConflict } from "@kumulo/core"

// network/version/region are immutable or update-restricted on OVH's side; drift here blocks instead of silently applying illegal changes.
export interface MksClusterState {
  readonly version?: string | undefined
  readonly region?: string | undefined
  readonly privateNetworkId?: string | null | undefined
  readonly nodesSubnetId?: string | null | undefined
  readonly loadBalancersSubnetId?: string | null | undefined
}

export interface MksDesiredCluster {
  readonly region: string
  readonly version?: string | undefined
  readonly privateNetwork?: boolean | undefined
  readonly nodesSubnetId?: string | undefined
  readonly loadBalancersSubnetId?: string | undefined
}

export type MksClusterDrift =
  | { readonly _tag: "None" }
  | { readonly _tag: "Upgrade"; readonly field: "version"; readonly from: string; readonly to: string }
  | { readonly _tag: "Blocked"; readonly field: string; readonly reason: string }

const _NONE: MksClusterDrift = { _tag: "None" }

const _blocked = (field: string, reason: string): MksClusterDrift => ({ _tag: "Blocked", field, reason })

const _majorMinor = (version: string): readonly [number, number] | undefined => {
  const [major, minor] = version.replace(/^v/, "").split(".").map(Number)
  return major === undefined || minor === undefined || !Number.isInteger(major) || !Number.isInteger(minor)
    ? undefined
    : [major, minor]
}

const _show = ([major, minor]: readonly [number, number]): string => `${major}.${minor}`

const _versionDrift = (
  { actual, desired }: { readonly actual: string; readonly desired: string }
): MksClusterDrift => {
  const from = _majorMinor(actual)
  const to = _majorMinor(desired)
  if (from === undefined || to === undefined) return _NONE
  if (from[0] === to[0] && from[1] === to[1]) return _NONE
  const move = `${_show(from)} → ${_show(to)}`
  if (from[0] !== to[0]) return _blocked("version", `cannot change the Kubernetes major version in place (${move})`)
  if (to[1] < from[1]) return _blocked("version", `cannot downgrade Kubernetes in place (${move})`)
  return to[1] === from[1] + 1
    ? { _tag: "Upgrade", field: "version", from: _show(from), to: _show(to) }
    : _blocked("version", `OVH upgrades one minor at a time; ${move} skips ${to[1] - from[1] - 1} — step through them`)
}

const _regionDrift = (
  { actual, desired }: { readonly actual: string | undefined; readonly desired: string }
): MksClusterDrift =>
  actual === undefined || actual.toUpperCase() === desired.toUpperCase()
    ? _NONE
    : _blocked(
      "auth.region",
      `cluster lives in region "${actual}" but the config asks for "${desired}"; an MKS cluster cannot be ` +
        `moved between regions — destroy and recreate it deliberately`
    )

const _NETWORK_REMEDY = "MKS sets a cluster's network at creation and can never change it — " +
  "delete and recreate the cluster deliberately, or revert the change"

const _networkDrift = (
  { actual, desired }: { readonly actual: string | null | undefined; readonly desired: boolean | undefined }
): MksClusterDrift => {
  if (desired === undefined || actual === undefined) return _NONE
  const live = actual !== null && actual !== ""
  if (live === desired) return _NONE
  return _blocked(
    "network",
    desired
      ? `the config declares a network block but cluster was created without a private network; ${_NETWORK_REMEDY}`
      : `cluster lives on private network "${actual}" but the config declares no network block; ${_NETWORK_REMEDY}`
  )
}

const _subnetSlotDrift = (
  { actual, desired, slot }: {
    readonly actual: string | null | undefined
    readonly desired: string | undefined
    readonly slot: string
  }
): MksClusterDrift =>
  desired === undefined || actual === undefined || actual === null || actual === "" || actual === desired
    ? _NONE
    : _blocked(
      "network",
      `the config's ${slot} resolves to subnet "${desired}" but the cluster was created on "${actual}"; ${_NETWORK_REMEDY}`
    )

const _subnetDrift = (
  { actual, desired }: { readonly desired: MksDesiredCluster; readonly actual: MksClusterState }
): MksClusterDrift => {
  const nodes = _subnetSlotDrift({
    actual: actual.nodesSubnetId,
    desired: desired.nodesSubnetId,
    slot: "nodes_subnet"
  })
  return nodes._tag !== "None" ? nodes : _subnetSlotDrift({
    actual: actual.loadBalancersSubnetId,
    desired: desired.loadBalancersSubnetId,
    slot: "load_balancers_subnet"
  })
}

export const driftConflict = (
  { field, reason }: { readonly field: string; readonly reason: string }
): ResourceConflict => new ResourceConflict({ kind: "cluster-drift", ref: `${field}: ${reason}` })

export const clusterDrift = (
  { actual, desired }: { readonly desired: MksDesiredCluster; readonly actual: MksClusterState }
): MksClusterDrift => {
  const network = _networkDrift({ actual: actual.privateNetworkId, desired: desired.privateNetwork })
  if (network._tag !== "None") return network
  const subnets = _subnetDrift({ actual, desired })
  if (subnets._tag !== "None") return subnets
  const region = _regionDrift({ actual: actual.region, desired: desired.region })
  if (region._tag !== "None") return region
  return desired.version === undefined || actual.version === undefined
    ? _NONE
    : _versionDrift({ actual: actual.version, desired: desired.version })
}
