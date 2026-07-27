import { Schema } from "effect"
import type { Duration , Effect} from "effect"
import { pollUntil } from "../reconcile/poll.ts"
import type { HttpTransportError, ProvisioningTimeout, ResourceNotFound } from "../errors/tagged.ts"
import type { K8sManifest } from "../domain/types.ts"
import type { ResourceRef } from "./client.ts"

// kumulo: lenient decode — a manifest missing/malformed `status`
// (not yet populated by the controller, e.g. a brand-new Node) decodes to
// `undefined` conditions rather than failing, same as before.
const _ConditionsShape = Schema.Struct({
  status: Schema.optional(Schema.Struct({
    conditions: Schema.optional(Schema.Array(Schema.Struct({ type: Schema.String, status: Schema.String })))
  }))
})

const _conditionStatus = (manifest: K8sManifest, type: string): string | undefined => {
  const decoded = Schema.decodeUnknownExit(_ConditionsShape)(manifest)
  if (decoded._tag !== "Success") return undefined
  return decoded.value.status?.conditions?.find((c) => c.type === type)?.status
}

export interface WaitOptions {
  readonly get: (ref: ResourceRef) => Effect.Effect<K8sManifest, ResourceNotFound | HttpTransportError>
  readonly ref: ResourceRef
  readonly interval: Duration.Input
  readonly timeout: Duration.Input
}

// Readiness helper — polls a Deployment until its "Available"
// condition is "True".
export const waitForDeploymentAvailable = (
  options: WaitOptions
): Effect.Effect<K8sManifest, ResourceNotFound | HttpTransportError | ProvisioningTimeout> =>
  pollUntil({
    check: options.get(options.ref),
    isDone: (manifest) => _conditionStatus(manifest, "Available") === "True",
    interval: options.interval,
    timeout: options.timeout,
    kind: "Deployment",
    ref: options.ref.path
  })

// Readiness helper — polls a Node until its "Ready" condition is
// "True".
export const waitForNodeReady = (
  options: WaitOptions
): Effect.Effect<K8sManifest, ResourceNotFound | HttpTransportError | ProvisioningTimeout> =>
  pollUntil({
    check: options.get(options.ref),
    isDone: (manifest) => _conditionStatus(manifest, "Ready") === "True",
    interval: options.interval,
    timeout: options.timeout,
    kind: "Node",
    ref: options.ref.path
  })
