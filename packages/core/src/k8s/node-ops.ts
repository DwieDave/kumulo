import { Effect } from "effect"
import type { HttpTransportError, ResourceConflict, ResourceNotFound } from "../errors/tagged.ts"
import type { K8sManifest } from "../domain/types.ts"
import type { K8sClient, ResourceRef } from "./client.ts"

const _nodeRef = (name: string): ResourceRef => ({ path: `/api/v1/nodes/${name}`, kind: "Node" })

export interface CordonNodeOptions {
  readonly client: K8sClient["Service"]
  readonly name: string
}

// FR-9.2 scale-down: mark a node unschedulable via server-side apply
// (spec.unschedulable is a plain field, no dedicated cordon subresource).
export const cordonNode = (
  options: CordonNodeOptions
): Effect.Effect<K8sManifest, ResourceConflict | HttpTransportError> =>
  options.client.apply(_nodeRef(options.name), {
    apiVersion: "v1",
    kind: "Node",
    metadata: { name: options.name },
    spec: { unschedulable: true }
  })

interface PodRef {
  readonly namespace: string
  readonly name: string
}

const _isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null
const _field = (value: unknown, key: string): unknown => _isRecord(value) ? value[key] : undefined

const _podRefs = (pods: ReadonlyArray<K8sManifest>): ReadonlyArray<PodRef> =>
  pods.flatMap((pod) => {
    const metadata = pod["metadata"]
    const name = _field(metadata, "name")
    const namespace = _field(metadata, "namespace")
    return typeof name === "string" && typeof namespace === "string" ? [{ namespace, name }] : []
  })

export interface DrainNodeOptions {
  readonly client: K8sClient["Service"]
  // kumulo: caller passes an already fieldSelector-scoped ref
  // (`?fieldSelector=spec.nodeName=<node>`) — building that query string
  // is the caller's concern, same "no GVK mapper" call as `ResourceRef`
  // itself.
  readonly podsRef: ResourceRef
}

// FR-9.2 drain: list a node's pods, evict each.
export const drainNode = (
  options: DrainNodeOptions
): Effect.Effect<void, ResourceNotFound | ResourceConflict | HttpTransportError> =>
  options.client.list(options.podsRef).pipe(
    Effect.map(_podRefs),
    Effect.flatMap((pods) =>
      Effect.forEach(pods, (pod) => options.client.evict(pod.namespace, pod.name), { discard: true })
    )
  )

export interface DeleteNodeOptions {
  readonly client: K8sClient["Service"]
  readonly name: string
}

export const deleteNode = (
  options: DeleteNodeOptions
): Effect.Effect<void, ResourceNotFound | HttpTransportError> => options.client.delete(_nodeRef(options.name))
