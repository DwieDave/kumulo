import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { fetchKubeconfig } from "../../src/kubeconfig/fetch.ts"
import { FakeSshLive } from "../ssh/fake-ssh.ts"

const RAW = `server: https://127.0.0.1:6443
name: default
`

describe("fetchKubeconfig", () => {
  it.effect("reads k3s.yaml from master 1 and rewrites it", () =>
    Effect.gen(function*() {
      const result = yield* fetchKubeconfig({
        master1: { ip: "10.0.0.1", port: 22 },
        clusterName: "prod",
        serverUrl: "https://10.0.0.100:6443"
      }).pipe(
        Effect.provide(FakeSshLive({ readFile: () => Effect.succeed(RAW) }))
      )
      expect(result.content).toContain("server: https://10.0.0.100:6443")
      expect(result.content).toContain("name: prod")
    }))

  it.effect("maps an SSH failure to BootstrapFailed", () =>
    Effect.gen(function*() {
      const result = yield* fetchKubeconfig({
        master1: { ip: "10.0.0.1", port: 22 },
        clusterName: "prod",
        serverUrl: "https://10.0.0.100:6443"
      }).pipe(Effect.provide(FakeSshLive({})), Effect.flip)
      expect(result._tag).toBe("BootstrapFailed")
    }))
})
