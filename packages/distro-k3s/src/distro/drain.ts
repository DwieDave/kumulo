import { Effect } from "effect"
import { BootstrapFailed, cordonNode, deleteNode, drainNode } from "@kumulo/core"
import type { NodeRef, ResourceRef , K8sClient } from "@kumulo/core"

const _podsOnNode = (name: string): ResourceRef => ({
  path: `/api/v1/pods?fieldSelector=spec.nodeName=${name}`,
  kind: "Pod"
})

export interface DrainAndRemoveArgs {
  readonly client: K8sClient["Service"]
  readonly node: NodeRef
}

// Scale-down: cordon → evict pods → delete the k8s Node object.
// Actual server deletion is the reconciler's CloudProvider call, made after
// this succeeds (the Distro port only owns the k8s-side drain).
export const drainAndRemove = (args: DrainAndRemoveArgs): Effect.Effect<void, BootstrapFailed> => {
  const { client, node } = args
  return Effect.gen(function*() {
    yield* cordonNode({ client, name: node.name })
    yield* drainNode({ client, podsRef: _podsOnNode(node.name) })
    yield* deleteNode({ client, name: node.name })
  }).pipe(
    Effect.mapError((cause) => new BootstrapFailed({ node: node.name, phase: "drainAndRemove", log: String(cause) }))
  )
}
