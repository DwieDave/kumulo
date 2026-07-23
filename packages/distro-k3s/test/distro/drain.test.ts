import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { ResourceConflict } from "@kumulo/core"
import type { K8sClient, K8sManifest, ResourceRef } from "@kumulo/core"
import { drainAndRemove } from "../../src/distro/drain.ts"

const _node = (name: string): K8sManifest => ({ apiVersion: "v1", kind: "Node", metadata: { name } })

const _fakeClient = (pods: ReadonlyArray<K8sManifest>): K8sClient["Service"] => {
  const calls: Array<string> = []
  return {
    get: (ref: ResourceRef) => Effect.succeed(_node(ref.path)),
    list: (_ref: ResourceRef) => Effect.sync(() => {
      calls.push("list")
      return pods
    }),
    apply: (_ref: ResourceRef, manifest: K8sManifest) => Effect.sync(() => {
      calls.push("cordon")
      return manifest
    }),
    delete: (_ref: ResourceRef) => Effect.sync(() => {
      calls.push("delete")
    }),
    evict: (_ns: string, pod: string) => Effect.sync(() => {
      calls.push(`evict:${pod}`)
    })
  }
}

describe("drainAndRemove", () => {
  it.effect("cordons, evicts every pod, then deletes the node", () =>
    Effect.gen(function*() {
      const pods: ReadonlyArray<K8sManifest> = [
        { apiVersion: "v1", kind: "Pod", metadata: { name: "a", namespace: "default" } },
        { apiVersion: "v1", kind: "Pod", metadata: { name: "b", namespace: "default" } }
      ]
      const client = _fakeClient(pods)
      yield* drainAndRemove({ client, node: { name: "worker-1", role: "worker" } })
    }))

  it.effect("maps a k8s failure to BootstrapFailed", () =>
    Effect.gen(function*() {
      const client: K8sClient["Service"] = {
        get: () => Effect.die("unused"),
        list: () => Effect.die("unused"),
        apply: () => Effect.fail(new ResourceConflict({ kind: "Node", ref: "worker-1" })),
        delete: () => Effect.die("unused"),
        evict: () => Effect.die("unused")
      }
      const result = yield* drainAndRemove({ client, node: { name: "worker-1", role: "worker" } }).pipe(Effect.flip)
      expect(result._tag).toBe("BootstrapFailed")
    }))
})
