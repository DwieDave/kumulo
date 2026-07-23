import { Effect } from "effect"
import type { Duration } from "effect"
import { pollUntil } from "../reconcile/poll.ts"
import type { HttpTransportError, ProvisioningTimeout, ResourceNotFound } from "../errors/tagged.ts"
import type { K8sManifest } from "../domain/types.ts"
import type { ResourceRef } from "./client.ts"

const _isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

const _conditionStatus = (manifest: K8sManifest, type: string): string | undefined => {
  const status = manifest["status"]
  const conditions = _isRecord(status) ? status["conditions"] : undefined
  if (!Array.isArray(conditions)) return undefined
  const match = conditions.find((c) => _isRecord(c) && c["type"] === type)
  return _isRecord(match) && typeof match["status"] === "string" ? match["status"] : undefined
}

export interface WaitOptions {
  readonly get: (ref: ResourceRef) => Effect.Effect<K8sManifest, ResourceNotFound | HttpTransportError>
  readonly ref: ResourceRef
  readonly interval: Duration.Input
  readonly timeout: Duration.Input
}

// FR-9.2 readiness helper — polls a Deployment until its "Available"
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

// FR-9.2 readiness helper — polls a Node until its "Ready" condition is
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
