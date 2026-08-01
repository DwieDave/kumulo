import { pollUntil, ProvisioningTimeout } from "@kumulo/core"
import { Effect } from "effect"
import type { HcloudClient } from "../client/hcloud.ts"
import { mapHcloudError, type HcloudError } from "./errors.ts"

interface ActionState {
  readonly status: "running" | "success" | "error"
  readonly error: { readonly message: string } | null
}

const _getAction = (
  { actionId, client }: { readonly client: HcloudClient; readonly actionId: number }
): Effect.Effect<ActionState, HcloudError> =>
  mapHcloudError({
    self: client.Actions.getAction({ params: { id: actionId } }),
    ctx: { kind: "action", ref: String(actionId) }
  }).pipe(Effect.map((response) => response.action))

export const waitForAction = (
  { actionId, client }: { readonly client: HcloudClient; readonly actionId: number }
): Effect.Effect<void, HcloudError | ProvisioningTimeout> =>
  pollUntil({
    check: _getAction({ client, actionId }),
    isDone: (action) => action.status !== "running",
    interval: "2 seconds",
    timeout: "5 minutes",
    kind: "action",
    ref: String(actionId)
  }).pipe(
    Effect.flatMap((action) =>
      action.status === "success"
        ? Effect.void
        : Effect.fail(new ProvisioningTimeout({ kind: "action", ref: String(actionId), lastStatus: action.error?.message ?? "error" }))
    )
  )
