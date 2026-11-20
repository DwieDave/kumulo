import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { waitForDeploymentAvailable } from "../../src/k8s/readiness.ts"
import type { K8sManifest } from "../../src/domain/types.ts"
import type { ResourceRef } from "../../src/k8s/client.ts"

const ref: ResourceRef = { path: "/apis/apps/v1/namespaces/default/deployments/d1", kind: "Deployment" }

const _neverAvailable = (): Effect.Effect<K8sManifest, never> =>
  Effect.succeed({
    apiVersion: "apps/v1",
    kind: "Deployment",
    status: { conditions: [{ type: "Available", status: "False" }] }
  })

const _malformedStatus = (_ref: ResourceRef): Effect.Effect<K8sManifest, never> =>
  Effect.succeed({ apiVersion: "apps/v1", kind: "Deployment", status: "not-an-object" })

describe("readiness waits", () => {
  it.live("waitForDeploymentAvailable resolves once the Available condition flips to True", () =>
    Effect.gen(function*() {
      let calls = 0

      const get = (_ref: ResourceRef): Effect.Effect<K8sManifest, never> =>
        Effect.sync(() => {
          calls += 1

          return {
            apiVersion: "apps/v1",
            kind: "Deployment",
            status: { conditions: [{ type: "Available", status: calls < 2 ? "False" : "True" }] }
          }
        })

      const manifest = yield* waitForDeploymentAvailable({ get, ref, interval: "1 millis", timeout: "1 second" })
      expect(manifest["status"]).toEqual({ conditions: [{ type: "Available", status: "True" }] })
      expect(calls).toBeGreaterThanOrEqual(2)
    }))

  it.live("waitForDeploymentAvailable times out when status/conditions is missing/malformed", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(waitForDeploymentAvailable({
        get: _malformedStatus,
        ref,
        interval: "1 millis",
        timeout: "10 millis"
      }))

      expect(error._tag).toBe("ProvisioningTimeout")
    }))

  it.live("waitForDeploymentAvailable times out with ProvisioningTimeout when Available never flips", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(waitForDeploymentAvailable({
        get: _neverAvailable,
        ref,
        interval: "1 millis",
        timeout: "10 millis"
      }))

      expect(error._tag).toBe("ProvisioningTimeout")
    }))
})
