import { Effect, Option, Schema } from "effect"
import type { HttpTransportError, ResourceConflict, ResourceNotFound } from "../errors/tagged.ts"
import type { K8sManifest } from "../domain/types.ts"
import type { K8sClient, ResourceRef } from "./client.ts"

const _nodeRef = (name: string): ResourceRef => ({ path: `/api/v1/nodes/${name}`, kind: "Node" })

export interface CordonNodeOptions {
  readonly client: K8sClient["Service"]
  readonly name: string
}

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
  // caller must pass podsRef already scoped with ?fieldSelector=spec.nodeName=<node>
  readonly podsRef: ResourceRef
}

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
