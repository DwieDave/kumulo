import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { SshCommandError } from "../../src/ssh/errors.ts"
import { Ssh } from "../../src/ssh/port.ts"
import type { SshHost } from "../../src/ssh/port.ts"
import { _testClusterInfoReady, _testPollReady } from "../../src/ssh/readiness.ts"
import { FakeSshLive, flakyThenOk } from "./fake-ssh.ts"

const host: SshHost = { ip: "10.0.0.1", port: 22 }

// kumulo: it.live + millisecond durations, matching packages/core's own
// pollUntil tests — it.effect's virtual TestClock never advances on its
// own, so real-timing paths run under the real clock instead (small enough
// to still be fast).
describe("readiness gates", () => {
  it.live("_pollReady resolves once the check reports ready", () =>
    Effect.gen(function*() {
      const ssh = yield* Ssh
      yield* _testPollReady({
        host,
        check: ssh.exec(host, "test -f marker").pipe(Effect.match({ onFailure: () => false, onSuccess: () => true })),
        interval: "1 millis",
        timeout: "1 second",
        kind: "cloud-init",
        phase: "cloud-init"
      })
    }).pipe(Effect.provide(FakeSshLive({ exec: flakyThenOk(2) }))))

  it.live("_pollReady fails with BootstrapFailed carrying the phase once the deadline passes", () =>
    Effect.gen(function*() {
      const ssh = yield* Ssh
      const error = yield* _testPollReady({
        host,
        check: ssh.exec(host, "test -f marker").pipe(Effect.match({ onFailure: () => false, onSuccess: () => true })),
        interval: "1 millis",
        timeout: "10 millis",
        kind: "cloud-init",
        phase: "cloud-init"
      }).pipe(Effect.flip)
      expect(error._tag).toBe("BootstrapFailed")
      expect(error.node).toBe(host.ip)
      expect(error.phase).toBe("cloud-init")
    }).pipe(Effect.provide(FakeSshLive({ exec: () => Effect.fail(new SshCommandError({ host: host.ip, command: "test", cause: "down" })) }))))

  it.live("_testClusterInfoReady succeeds within the attempt budget", () =>
    Effect.gen(function*() {
      const ssh = yield* Ssh
      yield* _testClusterInfoReady(host, ssh, { attempts: 3, attemptTimeout: "50 millis" })
    }).pipe(Effect.provide(FakeSshLive({ exec: flakyThenOk(2) }))))

  it.live("_testClusterInfoReady fails with BootstrapFailed after exhausting attempts", () =>
    Effect.gen(function*() {
      const ssh = yield* Ssh
      const error = yield* _testClusterInfoReady(host, ssh, { attempts: 3, attemptTimeout: "10 millis" }).pipe(Effect.flip)
      expect(error._tag).toBe("BootstrapFailed")
      expect(error.phase).toBe("cluster-info")
    }).pipe(Effect.provide(FakeSshLive({ exec: flakyThenOk(10) }))))
})
