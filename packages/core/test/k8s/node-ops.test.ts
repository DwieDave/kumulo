import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { makeK8sClient } from "../../src/k8s/client.ts"
import { cordonNode, deleteNode, drainNode } from "../../src/k8s/node-ops.ts"
import { fakeHttpClient } from "./fake-http-client.ts"

const server = "https://10.0.0.1:6443"

describe("node-ops", () => {
  it.effect("cordonNode PATCHes spec.unschedulable=true", () =>
    Effect.gen(function*() {
      const fake = fakeHttpClient(() =>
        new Response(JSON.stringify({ apiVersion: "v1", kind: "Node" }), { status: 200 })
      )
      const client = makeK8sClient({ client: fake.client, server })
      yield* cordonNode({ client, name: "n1" })
      const [request] = fake.requests()
      expect(request?.method).toBe("PATCH")
      expect(request?.url).toContain("/api/v1/nodes/n1")
    }))

  it.effect("drainNode lists pods on the node and evicts each", () =>
    Effect.gen(function*() {
      const fake = fakeHttpClient((request) =>
        request.method === "GET"
          ? new Response(
            JSON.stringify({
              items: [
                { apiVersion: "v1", kind: "Pod", metadata: { name: "p1", namespace: "default" } },
                { apiVersion: "v1", kind: "Pod", metadata: { name: "p2", namespace: "default" } }
              ]
            }),
            { status: 200 }
          )
          : new Response(null, { status: 201 })
      )
      const client = makeK8sClient({ client: fake.client, server })
      yield* drainNode({ client, podsRef: { path: "/api/v1/pods?fieldSelector=spec.nodeName=n1", kind: "Pod" } })
      const evictions = fake.requests().filter((r) => r.url.includes("eviction"))
      expect(evictions.length).toBe(2)
    }))

  it.effect("drainNode skips a pod missing metadata.name/namespace instead of failing", () =>
    Effect.gen(function*() {
      const fake = fakeHttpClient((request) =>
        request.method === "GET"
          ? new Response(
            JSON.stringify({
              items: [
                { apiVersion: "v1", kind: "Pod", metadata: { name: "p1", namespace: "default" } },
                { apiVersion: "v1", kind: "Pod", metadata: { name: "p2" } }
              ]
            }),
            { status: 200 }
          )
          : new Response(null, { status: 201 })
      )
      const client = makeK8sClient({ client: fake.client, server })
      yield* drainNode({ client, podsRef: { path: "/api/v1/pods?fieldSelector=spec.nodeName=n1", kind: "Pod" } })
      const evictions = fake.requests().filter((r) => r.url.includes("eviction"))
      expect(evictions.length).toBe(1)
    }))

  it.effect("deleteNode DELETEs the node resource", () =>
    Effect.gen(function*() {
      const fake = fakeHttpClient(() => new Response(null, { status: 200 }))
      const client = makeK8sClient({ client: fake.client, server })
      yield* deleteNode({ client, name: "n1" })
      const [request] = fake.requests()
      expect(request?.method).toBe("DELETE")
    }))
})
