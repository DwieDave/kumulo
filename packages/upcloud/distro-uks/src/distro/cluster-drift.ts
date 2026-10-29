// None of network/zone/plan/storage_encryption/private_node_groups have an UpCloud PATCH path — drift here is always a refusal, never a mutation.
import { ResourceConflict } from "@kumulo/core"
import { Data } from "effect"

export interface UksClusterState {
  readonly zone?: string | undefined
  readonly plan?: string | undefined
  readonly networkCidr?: string | undefined
  readonly storageEncryption?: boolean | undefined
  readonly privateNodeGroups?: boolean | undefined
}

export interface UksDesiredCluster {
  readonly zone: string
  readonly plan?: string | undefined
  readonly networkCidr?: string | undefined
  readonly storageEncryption?: boolean | undefined
  readonly privateNodeGroups?: boolean | undefined
}

export type UksClusterDrift = Data.TaggedEnum<{
  None: {}
  Blocked: { readonly field: string; readonly reason: string }
}>

export const UksClusterDrift = Data.taggedEnum<UksClusterDrift>()

const _NONE: UksClusterDrift = UksClusterDrift.None()

const REMEDY = "UpCloud sets this at cluster creation and never lets it change in place — " +
  "delete and recreate the cluster deliberately, or revert the change"

const _blocked = (field: string, reason: string): UksClusterDrift => UksClusterDrift.Blocked({ field, reason })

// undefined on either side means "can't tell" — a partial read never fabricates drift.
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

export const driftConflict = (
  { field, reason }: { readonly field: string; readonly reason: string }
): ResourceConflict => new ResourceConflict({ kind: "cluster-drift", ref: `${field}: ${reason}` })

export const clusterDrift = (
  { actual, desired }: { readonly desired: UksDesiredCluster; readonly actual: UksClusterState }
): UksClusterDrift => {
  const zone = _fieldDrift({ field: "zone", actual: actual.zone, desired: desired.zone, format: String })

  if (!UksClusterDrift.$is("None")(zone)) return zone
  const plan = _fieldDrift({ field: "plan", actual: actual.plan, desired: desired.plan, format: String })

  if (!UksClusterDrift.$is("None")(plan)) return plan

  const network = _fieldDrift({
    field: "network_cidr",
    actual: actual.networkCidr,
    desired: desired.networkCidr,
    format: String
  })

  if (!UksClusterDrift.$is("None")(network)) return network

  const storageEncryption = _fieldDrift({
    field: "storage_encryption",
    actual: actual.storageEncryption,
    desired: desired.storageEncryption,
    format: String
  })

  if (!UksClusterDrift.$is("None")(storageEncryption)) return storageEncryption

  return _fieldDrift({
    field: "private_node_groups",
    actual: actual.privateNodeGroups,
    desired: desired.privateNodeGroups,
    format: String
  })
}
