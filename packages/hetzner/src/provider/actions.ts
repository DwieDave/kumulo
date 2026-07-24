import { pollUntil, ProvisioningTimeout } from "@kumulo/core"
import type { CloudError } from "@kumulo/core"
import { Effect } from "effect"
import type { HttpClient } from "effect/unstable/http"
import * as Schema from "effect/Schema"
import { decodeSingleField } from "./decode.ts"
import { hcloudRequest } from "./rest.ts"

const HcloudAction = Schema.Struct({
  id: Schema.Number,
  status: Schema.Literals(["running", "success", "error"]),
  error: Schema.Union([Schema.Struct({ code: Schema.String, message: Schema.String }), Schema.Null])
})
type HcloudAction = typeof HcloudAction.Type

const _getAction = (actionId: number): Effect.Effect<HcloudAction, CloudError, HttpClient.HttpClient> =>
  hcloudRequest({ path: `actions/${actionId}`, method: "GET", kind: "action" }).pipe(
    Effect.flatMap(decodeSingleField({ itemSchema: HcloudAction, field: "action", kind: "action" }))
  )

// kumulo: hcloud operations (server/volume create, LB target add/remove, ...)
// return an `Action` to poll (N2) — bounded spaced polling via `@kumulo/core`'s
// `pollUntil` (shared with the OpenStack path's server-status polling),
// `ProvisioningTimeout` on cap, the `error` status surfaced with Hetzner's own
// error message rather than a bare "timed out".
export const waitForAction = (actionId: number): Effect.Effect<void, CloudError, HttpClient.HttpClient> =>
  pollUntil({
    check: _getAction(actionId),
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
