import { configHash } from "./hash.ts"
import { resourceName } from "./naming.ts"
import type { DesiredResource, Inventory, Plan, PlanAction, TaggedResource } from "./types.ts"

// One desired resource vs. its matching tagged inventory entry (if any) —
// create (missing), no-op (hash matches), or replace-with-
// confirmation (flavor/image/etc. changed, i.e. config-hash drifted).
const _planForDesired = (
  { actual, desired }: { readonly desired: DesiredResource; readonly actual: TaggedResource | undefined }
): PlanAction => {
  const name = resourceName(desired)
  if (actual === undefined) return { _tag: "Create", name }
  const desiredHash = configHash(desired.spec)
  return desiredHash === actual.configHash
    ? { _tag: "NoOp", name }
    : { _tag: "ReplaceNeedsConfirm", name, reason: "config-hash drifted from desired spec" }
}

// Tagged resources with no corresponding desired entry get deleted.
const _planForOrphaned = (
  { actual, desiredNames }: { readonly actual: Inventory; readonly desiredNames: ReadonlySet<string> }
): ReadonlyArray<PlanAction> =>
  actual.filter((resource) => !desiredNames.has(resource.name)).map((resource) => ({
    _tag: "Delete",
    name: resource.name
  }))

// Turns a desired resource into what its tagged inventory entry would look
// like once created — used to prove plan-after-apply converges to all
// no-ops.
export const toTaggedResource = (desired: DesiredResource): TaggedResource => ({
  name: resourceName(desired),
  cluster: desired.cluster,
  role: desired.role,
  pool: desired.pool,
  index: desired.index,
  configHash: configHash(desired.spec)
})

export const computePlan = (
  { desired, actual }: { readonly desired: ReadonlyArray<DesiredResource>; readonly actual: Inventory }
): Plan => {
  const byName = new Map(actual.map((resource) => [resource.name, resource]))
  const desiredNames = new Set(desired.map((resource) => resourceName(resource)))
  const forDesired = desired.map((resource) =>
    _planForDesired({ desired: resource, actual: byName.get(resourceName(resource)) })
  )
  return { actions: [...forDesired, ..._planForOrphaned({ actual, desiredNames })] }
}
