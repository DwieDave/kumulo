import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { k8sClientFromKubeconfig } from "../../src/k8s/client.ts"
import { fakeHttpClient } from "./fake-http-client.ts"

const _kubeconfig = (user: string) => ({
  content: `
clusters:
  - cluster:
      server: https://10.0.0.1:6443
users:
  - user:
${user}
`
})

const _node = (): Response =>
  new Response(JSON.stringify({ apiVersion: "v1", kind: "Node", metadata: { name: "n1" } }), { status: 200 })

describe("k8sClientFromKubeconfig", () => {
  it.effect("targets the kubeconfig server and adds the bearer token", () =>
    Effect.gen(function*() {
      const fake = fakeHttpClient(_node)

      const client = yield* k8sClientFromKubeconfig({
        kubeconfig: _kubeconfig("      token: tok-123"),
        httpClientFor: () => Effect.succeed(fake.client)
      })

      yield* client.get({ path: "/api/v1/nodes/n1", kind: "Node" })
      const request = fake.requests()[0]
      expect(request?.headers["authorization"]).toBe("Bearer tok-123")
      expect(request?.url).toContain("10.0.0.1")
    }))

  it.effect("fails with ConfigInvalid for an unusable kubeconfig", () =>
    Effect.gen(function*() {
      const fake = fakeHttpClient(_node)

      const error = yield* Effect.flip(
        k8sClientFromKubeconfig({ kubeconfig: { content: "clusters: []" }, httpClientFor: () => Effect.succeed(fake.client) })
      )

      expect(error._tag).toBe("ConfigInvalid")
    }))
})
