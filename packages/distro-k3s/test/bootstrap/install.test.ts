import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { runBootstrap } from "../../src/bootstrap/install.ts"
import type { NonEmptyMasters } from "../../src/bootstrap/token.ts"
import { SshCommandError } from "../../src/ssh/errors.ts"
import type { SshHost } from "../../src/ssh/port.ts"
import { FakeSshLive } from "../ssh/fake-ssh.ts"

const masters: NonEmptyMasters = [
  { ip: "10.0.0.1", port: 22 },
  { ip: "10.0.0.2", port: 22 },
  { ip: "10.0.0.3", port: 22 }
]
const workers: ReadonlyArray<SshHost> = [{ ip: "10.0.0.4", port: 22 }]

describe("runBootstrap", () => {
  it.effect("executes the rendered install script on every node over Ssh, gated by readiness", () =>
    Effect.gen(function*() {
      const executed: Array<{ host: string; command: string }> = []
      const clusterInfoCalls: Array<string> = []

      const sshLayer = FakeSshLive({
        readFile: () => Effect.fail(new SshCommandError({ host: "", command: "", cause: "no token" })),
        exec: (host, command) => {
          if (command === "kubectl cluster-info") {
            clusterInfoCalls.push(host.ip)
            return Effect.succeed("ok")
          }
          if (command.startsWith(`test -f`)) return Effect.succeed("")
          executed.push({ host: host.ip, command })
          return Effect.succeed("ok")
        },
        waitReady: () => Effect.void
      })

      const result = yield* runBootstrap({
        masters,
        workers,
        k3sVersion: "v1.31.2+k3s1",
        tlsSans: [...masters.map((m) => m.ip), "10.0.0.100"],
        cloudControllerManager: false,
        cni: "flannel",
        extraServerArgs: [],
        extraAgentArgs: []
      }).pipe(Effect.provide(sshLayer))

      expect(result.firstMaster).toEqual(masters[0])
      expect(result.token).toMatch(/^[0-9a-f]{64}$/)

      // Every node's rendered script was actually executed via Ssh.exec, not
      // merely rendered.
      expect(executed).toHaveLength(4)
      const byHost = new Map(executed.map((e) => [e.host, e.command]))
      expect(byHost.get("10.0.0.1")).toContain("--cluster-init")
      expect(byHost.get("10.0.0.2")).toContain(`--server https://${masters[0].ip}:6443`)
      expect(byHost.get("10.0.0.4")).toContain("agent")
      expect(byHost.get("10.0.0.4")).toContain(`K3S_TOKEN="${result.token}"`)

      // controlPlaneReady only gates master 1.
      expect(clusterInfoCalls).toEqual(["10.0.0.1"])
    }))
})
