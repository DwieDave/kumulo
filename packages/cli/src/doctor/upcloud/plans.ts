import { Effect } from "effect"
import type { UksClient } from "@kumulo/upcloud"
import type { DoctorCheck } from "../types.ts"

const _controlPlaneName = "upcloud-control-plane-plan"

export const controlPlanePlanCheck = (args: { readonly uks: UksClient; readonly plan: string | undefined }): DoctorCheck => ({
  name: _controlPlaneName,
  run: args.plan === undefined
    ? Effect.succeed({
      name: _controlPlaneName,
      status: "pass" as const,
      message: "No control plane plan set — UpCloud's default will be used."
    })
    : args.uks.plans().pipe(
      Effect.match({
        onSuccess: (plans) =>
          plans.some((candidate) => candidate.name === args.plan)
            ? { name: _controlPlaneName, status: "pass" as const, message: `Control plane plan "${args.plan}" is available.` }
            : {
              name: _controlPlaneName,
              status: "fail" as const,
              message: `Control plane plan "${args.plan}" was not found (known: ${plans.map((p) => p.name).join(", ") || "none"}).`
            },
        onFailure: () => ({
          name: _controlPlaneName,
          status: "fail" as const,
          message: "Could not list UpCloud control plane plans."
        })
      })
    )
})

const _nodeGroupName = "upcloud-node-group-plans"

// no vendored plan-listing endpoint; only structural presence checked, wire /1.3/plan for live validation
export const nodeGroupPlansCheck = (
  args: { readonly pools: ReadonlyArray<{ readonly plan: string }> }
): DoctorCheck => ({
  name: _nodeGroupName,
  run: Effect.succeed(
    args.pools.every((pool) => pool.plan.length > 0)
      ? {
        name: _nodeGroupName,
        status: "pass" as const,
        message: `${args.pools.length} node group plan(s) declared (not live-validated — no vendored plans endpoint).`
      }
      : { name: _nodeGroupName, status: "fail" as const, message: "One or more worker pools has no plan set." }
  )
})
