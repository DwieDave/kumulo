/**
 * Cluster-LEVEL drift for MKS — the analogue of `nodepool-diff.ts`, one level up.
 *
 * Node pools drift by config hash; the control plane has no hash to stamp, so
 * the cluster-scoped fields a config can actually change are compared
 * field-by-field against what OVH reads back:
 *
 * - `network` — immutable, and the most consequential: `Cloud_ProjectKubeUpdate`
 *   is `{ name?, updatePolicy? }`, so networking is set at creation and never
 *   again. Only *presence* is compared, because the id a config resolves to is
 *   not knowable at plan time (`ensureNetwork` is create-if-missing, not a read).
 * - `version` — updatable in place, but only the way OVH's `/update` endpoint
 *   allows: one minor step forward. Anything else (downgrade, minor skip,
 *   major change) is refused rather than silently ignored.
 * - `auth.region` — immutable: a cluster cannot be moved between regions.
 *
 * Everything else on `MksDriverConfig` is either identity (`name` — a rename
 * plans as a `Create`, the cluster is looked up by name) or OVH-derived
 * (status, url, patch level — OVH owns the patch track).
 */

import { ResourceConflict } from "@kumulo/core"

/** Cluster state as read back from OVH (`Cloud_kube_Cluster`); absent fields mean "can't tell". */
export interface MksClusterState {
  readonly version?: string | undefined
  readonly region?: string | undefined
  /** `null`/`""` mean OVH reported no private network; `undefined` means it was never read. */
  readonly privateNetworkId?: string | null | undefined
  /** Subnet ids OVH stamped on the cluster at creation; `undefined` means never read. */
  readonly nodesSubnetId?: string | null | undefined
  readonly loadBalancersSubnetId?: string | null | undefined
}

/** The cluster-level slice of the desired config (`MksDriverConfig` satisfies it structurally). */
export interface MksDesiredCluster {
  readonly region: string
  readonly version?: string | undefined
  /**
   * Whether the config asks for a private network. Absent means the caller
   * models no networking, so no claim is made — plan fixtures predating the
   * `network` block never start reading as drifted.
   */
  readonly privateNetwork?: boolean | undefined
  /**
   * Subnet ids the config's CIDRs resolve to in the live network, as read by
   * `CloudProvider.findNetwork`. Absent means unresolved — the network may not
   * exist yet — which is "can't tell", never drift.
   */
  readonly nodesSubnetId?: string | undefined
  readonly loadBalancersSubnetId?: string | undefined
}

export type MksClusterDrift =
  | { readonly _tag: "None" }
  | { readonly _tag: "Upgrade"; readonly field: "version"; readonly from: string; readonly to: string }
  | { readonly _tag: "Blocked"; readonly field: string; readonly reason: string }

const _NONE: MksClusterDrift = { _tag: "None" }

const _blocked = (field: string, reason: string): MksClusterDrift => ({ _tag: "Blocked", field, reason })

/** `v1.31.4` / `1.31` → `[1, 31]`; unparseable → `undefined` (no drift claim, same stance as an absent hash). */
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
  // Patch level is OVH's to manage — only the minor track is ours.
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

/**
 * Presence, not identity. At plan time the desired network id is unknowable —
 * the network may not exist yet — so comparing ids would either fabricate drift
 * on every apply or demand a read-only lookup that does not exist. Presence is
 * the honest comparison, and it catches both unappliable edits.
 */
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

/**
 * One subnet slot. Either side unknown is "can't tell", never drift: an
 * unresolved desired id means the network does not exist yet, and an unread
 * actual one means OVH was never asked.
 */
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

/**
 * Subnet-level identity (R8). Presence drift only catches adding or dropping the
 * whole block — editing a subnet CIDR keeps the same tag-named network, so only
 * the resolved subnet ids move. MKS fixes both at creation, so this is `Blocked`.
 */
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

/**
 * A `Blocked` verdict as the failure every writer refuses with — one wording
 * whether the refusal happens at the cluster write or ahead of the network one.
 */
export const driftConflict = (
  { field, reason }: { readonly field: string; readonly reason: string }
): ResourceConflict => new ResourceConflict({ kind: "cluster-drift", ref: `${field}: ${reason}` })

/**
 * Pure and total: same inputs always produce the same verdict. `None` on any
 * field OVH didn't report, so a partial read never fabricates drift on a live
 * cluster.
 */
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
