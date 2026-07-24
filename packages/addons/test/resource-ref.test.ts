import { assert, it } from "@effect/vitest"
import type { K8sManifest } from "@kumulo/core"
import { refFor } from "../src/resource-ref.ts"

it("refFor builds a namespaced path from a well-formed manifest", () => {
  const manifest: K8sManifest = {
    apiVersion: "v1",
    kind: "Secret",
    metadata: { name: "kumulo-token", namespace: "kube-system" }
  }
  assert.deepStrictEqual(refFor(manifest), { path: "/api/v1/namespaces/kube-system/secrets/kumulo-token", kind: "Secret" })
})

it("refFor falls back to an empty name and no namespace when metadata fails to decode", () => {
  const manifest: K8sManifest = { apiVersion: "v1", kind: "Namespace", metadata: "not-an-object" }
  assert.deepStrictEqual(refFor(manifest), { path: "/api/v1/namespaces/", kind: "Namespace" })
})
