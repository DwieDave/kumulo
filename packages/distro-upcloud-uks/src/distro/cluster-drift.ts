/**
 * Cluster-LEVEL drift for UKS — the analogue of `nodegroup-diff.ts`, one
 * level up. Node groups drift by config hash; the control plane has no hash
 * to stamp, so the creation-time-only fields a config can actually declare
 * are compared field-by-field against what UpCloud reads back:
 *
 * `network`, `zone`, `plan`, `storage_encryption`, `private_node_groups`
 * (R9/AC6/D11) — none of these have an UpCloud PATCH path. Any drift here is
 * a refusal, never a mutation: the CLI must name the field and stop, not
 * silently apply something UpCloud would either reject or (worse) ignore.
 *
 * `version` is deliberately absent — that's `resolveUpgradeTarget`'s job
 * (T4.4), driven by the explicit `upgrade` verb, not plan-time drift.
 */

import { ResourceConflict } from "@kumulo/core"

/** Cluster state as read back from UpCloud; absent fields mean "can't tell". */
export interface UksClusterState {
  readonly zone?: string | undefined
  readonly plan?: string | undefined
  /**
   * The cluster's `network_cidr`, not "has a network" — every live cluster has
   * one, so a boolean always agreed and an edited CIDR planned as a NoOp (AC6).
   */
  readonly networkCidr?: string | undefined
  readonly storageEncryption?: boolean | undefined
  readonly privateNodeGroups?: boolean | undefined
}

/** The cluster-level slice of the desired config (`UksClusterConfig` satisfies it structurally). */
export interface UksDesiredCluster {
  readonly zone: string
  readonly plan?: string | undefined
  readonly networkCidr?: string | undefined
  readonly storageEncryption?: boolean | undefined
  readonly privateNodeGroups?: boolean | undefined
}

export type UksClusterDrift =
  | { readonly _tag: "None" }
  | { readonly _tag: "Blocked"; readonly field: string; readonly reason: string }

const _NONE: UksClusterDrift = { _tag: "None" }

const REMEDY = "UpCloud sets this at cluster creation and never lets it change in place — " +
  "delete and recreate the cluster deliberately, or revert the change"

const _blocked = (field: string, reason: string): UksClusterDrift => ({ _tag: "Blocked", field, reason })

/** `undefined` on either side means "can't tell" — a partial read never fabricates drift. */
const _fieldDrift = <A>(
  { field, actual, desired, format }: {
    readonly field: string
    readonly actual: A | undefined
    readonly desired: A | undefined
    readonly format: (value: A) => string
  }
): UksClusterDrift =>
  actual === undefined || desired === undefined || actual === desired
    ? _NONE
    : _blocked(field, `cluster has ${field} "${format(actual)}" but the config asks for "${format(desired)}"; ${REMEDY}`)

/**
 * A `Blocked` verdict as the failure every writer refuses with — one wording
 * whether the refusal happens at plan time or ahead of an apply call.
 */
export const driftConflict = (
  { field, reason }: { readonly field: string; readonly reason: string }
): ResourceConflict => new ResourceConflict({ kind: "cluster-drift", ref: `${field}: ${reason}` })

/**
 * Pure and total: same inputs always produce the same verdict (R9/AC6).
 */
export const clusterDrift = (
  { actual, desired }: { readonly desired: UksDesiredCluster; readonly actual: UksClusterState }
): UksClusterDrift => {
  const zone = _fieldDrift({ field: "zone", actual: actual.zone, desired: desired.zone, format: String })
  if (zone._tag !== "None") return zone
  const plan = _fieldDrift({ field: "plan", actual: actual.plan, desired: desired.plan, format: String })
  if (plan._tag !== "None") return plan
  const network = _fieldDrift({
    field: "network_cidr",
    actual: actual.networkCidr,
    desired: desired.networkCidr,
    format: String
  })
  if (network._tag !== "None") return network
  const storageEncryption = _fieldDrift({
    field: "storage_encryption",
    actual: actual.storageEncryption,
    desired: desired.storageEncryption,
    format: String
  })
  if (storageEncryption._tag !== "None") return storageEncryption
  return _fieldDrift({
    field: "private_node_groups",
    actual: actual.privateNodeGroups,
    desired: desired.privateNodeGroups,
    format: String
  })
}
