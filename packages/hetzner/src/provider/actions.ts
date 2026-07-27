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

// kumulo: hcloud operations (server/volume create, LB target add/remove, ...)
// return an `Action` to poll (N2) — bounded spaced polling via `@kumulo/core`'s
// `pollUntil` (shared with the OpenStack path's server-status polling),
// `ProvisioningTimeout` on cap, the `error` status surfaced with Hetzner's own
// error message rather than a bare "timed out".
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
