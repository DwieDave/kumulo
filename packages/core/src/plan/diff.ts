import { configHash } from "./hash.ts"
import { resourceName } from "./naming.ts"
import type { DesiredResource, Plan, PlanAction, TaggedResource } from "./types.ts"

export const toTaggedResource = (desired: DesiredResource): TaggedResource => ({
  name: resourceName(desired),
  configHash: configHash(desired.spec)
})

const _actionFor = (desired: DesiredResource, actual: TaggedResource | undefined): PlanAction => {
  const name = resourceName(desired)
  if (actual === undefined) return { _tag: "Create", name }
  if (actual.configHash === undefined) return { _tag: "NoOp", name }
  return actual.configHash === configHash(desired.spec)
    ? { _tag: "NoOp", name }
    : { _tag: "ReplaceNeedsConfirm", name, reason: "config-hash drifted from desired spec" }
}

// Callers hand this to the reconciler only once the operator confirmed — never re-derive replace intent from names/inventory.
export const namesToReplace = (plan: Plan): ReadonlySet<string> =>
  new Set(plan.actions.filter((action) => action._tag === "ReplaceNeedsConfirm").map((action) => action.name))

export const computePlan = (
  { actual, desired }: { readonly desired: ReadonlyArray<DesiredResource>; readonly actual: ReadonlyArray<TaggedResource> }
): Plan => {
  const byName = new Map(actual.map((resource) => [resource.name, resource]))
  const desiredNames = new Set(desired.map(resourceName))
  return {
    actions: [
      ...desired.map((resource) => _actionFor(resource, byName.get(resourceName(resource)))),
      ...actual
        .filter((resource) => !desiredNames.has(resource.name))
        .map((resource): PlanAction => ({ _tag: "Delete", name: resource.name }))
    ]
  }
}
