import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { UrlParams } from "effect/unstable/http"
import { makeK8sClient } from "../../src/k8s/client.ts"
import { fakeHttpClient } from "./fake-http-client.ts"

const server = "https://10.0.0.1:6443"
const nodeRef = { path: "/api/v1/nodes/n1", kind: "Node" }

describe("K8sClient", () => {
  it.effect("get decodes a 200 body into a K8sManifest", () =>
    Effect.gen(function*() {
      const fake = fakeHttpClient(() =>
        new Response(JSON.stringify({ apiVersion: "v1", kind: "Node", metadata: { name: "n1" } }), { status: 200 })
      )
      const client = makeK8sClient({ client: fake.client, server })
      const manifest = yield* client.get(nodeRef)
      expect(manifest["kind"]).toBe("Node")
    }))

  it.effect("get fails with ResourceNotFound on 404", () =>
    Effect.gen(function*() {
      const fake = fakeHttpClient(() => new Response("nope", { status: 404 }))
      const client = makeK8sClient({ client: fake.client, server })
      const error = yield* Effect.flip(client.get(nodeRef))
      expect(error._tag).toBe("ResourceNotFound")
    }))

  it.effect("get fails with HttpTransportError when the 200 body isn't a manifest (missing apiVersion/kind)", () =>
    Effect.gen(function*() {
      const fake = fakeHttpClient(() => new Response(JSON.stringify({ metadata: { name: "n1" } }), { status: 200 }))
      const client = makeK8sClient({ client: fake.client, server })
      const error = yield* Effect.flip(client.get(nodeRef))
      expect(error._tag).toBe("HttpTransportError")
    }))

  it.effect("list drops malformed items instead of failing (lenient decode)", () =>
    Effect.gen(function*() {
      const fake = fakeHttpClient(() =>
        new Response(
          JSON.stringify({
            items: [
              { apiVersion: "v1", kind: "Node", metadata: { name: "n1" } },
              { metadata: { name: "not-a-manifest" } }
            ]
          }),
          { status: 200 }
        )
      )
      const client = makeK8sClient({ client: fake.client, server })
      const items = yield* client.list(nodeRef)
      expect(items.length).toBe(1)
    }))

  it.effect("list unwraps the items array", () =>
    Effect.gen(function*() {
      const fake = fakeHttpClient(() =>
        new Response(JSON.stringify({ items: [{ apiVersion: "v1", kind: "Node", metadata: { name: "n1" } }] }), {
          status: 200
        })
      )
      const client = makeK8sClient({ client: fake.client, server })
      const items = yield* client.list(nodeRef)
      expect(items.length).toBe(1)
    }))

  it.effect("apply sends application/apply-patch+yaml with fieldManager=kumulo&force=true", () =>
    Effect.gen(function*() {
      const fake = fakeHttpClient(() =>
        new Response(JSON.stringify({ apiVersion: "v1", kind: "Node", metadata: { name: "n1" } }), { status: 200 })
      )
      const client = makeK8sClient({ client: fake.client, server })
      yield* client.apply(nodeRef, { apiVersion: "v1", kind: "Node", metadata: { name: "n1" } })
      const [request] = fake.requests()
      const query = request === undefined ? "" : UrlParams.toString(request.urlParams)
      expect(request?.method).toBe("PATCH")
      expect(query).toContain("fieldManager=kumulo")
      expect(query).toContain("force=true")
      expect(request?.headers["content-type"]).toBe("application/apply-patch+yaml")
    }))

  it.effect("apply fails with ResourceConflict on 409", () =>
    Effect.gen(function*() {
      const fake = fakeHttpClient(() => new Response("conflict", { status: 409 }))
      const client = makeK8sClient({ client: fake.client, server })
      const error = yield* Effect.flip(client.apply(nodeRef, { apiVersion: "v1", kind: "Node" }))
      expect(error._tag).toBe("ResourceConflict")
    }))

  it.effect("delete no-ops on 404", () =>
    Effect.gen(function*() {
      const fake = fakeHttpClient(() => new Response(null, { status: 404 }))
      const client = makeK8sClient({ client: fake.client, server })
      yield* client.delete(nodeRef)
    }))

  it.effect("evict posts an Eviction body to the pod's eviction subresource", () =>
    Effect.gen(function*() {
      const fake = fakeHttpClient(() => new Response(null, { status: 201 }))
      const client = makeK8sClient({ client: fake.client, server })
      yield* client.evict("default", "pod-1")
      const [request] = fake.requests()
      expect(request?.url).toContain("/api/v1/namespaces/default/pods/pod-1/eviction")
      expect(request?.method).toBe("POST")
    }))

  it.effect("evict fails with ResourceConflict on 409 (eviction blocked by PDB)", () =>
    Effect.gen(function*() {
      const fake = fakeHttpClient(() => new Response(null, { status: 409 }))
      const client = makeK8sClient({ client: fake.client, server })
      const error = yield* Effect.flip(client.evict("default", "pod-1"))
      expect(error._tag).toBe("ResourceConflict")
    }))
})
