import { Effect, Option, Schema } from "effect"
import type { HttpTransportError, ResourceConflict, ResourceNotFound } from "../errors/tagged.ts"
import type { K8sManifest } from "../domain/types.ts"
import type { K8sClient, ResourceRef } from "./client.ts"

const _nodeRef = (name: string): ResourceRef => ({ path: `/api/v1/nodes/${name}`, kind: "Node" })

export interface CordonNodeOptions {
  readonly client: K8sClient["Service"]
  readonly name: string
}

// Scale-down: mark a node unschedulable via server-side apply
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

// kumulo: a pod without both metadata fields is silently skipped (same
// "not a manifest -> drop it" lenient-decode semantics as `K8sClient.list`),
// not a hard failure — a malformed pod entry shouldn't abort draining the
// rest of the node.
const _PodMetadata = Schema.Struct({
  metadata: Schema.Struct({ name: Schema.String, namespace: Schema.String })
})

const _podRef = (pod: K8sManifest): Effect.Effect<Option.Option<PodRef>> =>
  Schema.decodeUnknownEffect(_PodMetadata)(pod).pipe(
    Effect.map(({ metadata }): PodRef => ({ name: metadata.name, namespace: metadata.namespace })),
    Effect.option
  )

const _podRefs = (pods: ReadonlyArray<K8sManifest>): Effect.Effect<ReadonlyArray<PodRef>> =>
  Effect.forEach(pods, _podRef).pipe(Effect.map((refs) => refs.flatMap(Option.toArray)))

export interface DrainNodeOptions {
  readonly client: K8sClient["Service"]
  // kumulo: caller passes an already fieldSelector-scoped ref
  // (`?fieldSelector=spec.nodeName=<node>`) — building that query string
  // is the caller's concern, same "no GVK mapper" call as `ResourceRef`
  // itself.
  readonly podsRef: ResourceRef
}

// Drain: list a node's pods, evict each.
export const drainNode = (
  options: DrainNodeOptions
): Effect.Effect<void, ResourceNotFound | ResourceConflict | HttpTransportError> =>
  options.client.list(options.podsRef).pipe(
    Effect.flatMap(_podRefs),
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
