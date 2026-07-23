import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { Ssh } from "../../src/ssh/port.ts"
import type { SshHost } from "../../src/ssh/port.ts"
import { FakeSshLive } from "./fake-ssh.ts"

const host: SshHost = { ip: "10.0.0.1", port: 22 }

describe("Ssh port (fake layer)", () => {
  it.effect("exec returns the scripted output for a matching host/command", () =>
    Effect.gen(function*() {
      const ssh = yield* Ssh
      const out = yield* ssh.exec(host, "hostname")
      expect(out).toBe("node-a")
    }).pipe(Effect.provide(FakeSshLive({ exec: () => Effect.succeed("node-a") }))))

  it.effect("readFile returns scripted file contents", () =>
    Effect.gen(function*() {
      const ssh = yield* Ssh
      const out = yield* ssh.readFile(host, "/etc/hostname")
      expect(out).toBe("node-a\n")
    }).pipe(Effect.provide(FakeSshLive({ readFile: () => Effect.succeed("node-a\n") }))))

  it.effect("an unscripted call fails with SshCommandError, not a hang or throw", () =>
    Effect.gen(function*() {
      const ssh = yield* Ssh
      const result = yield* ssh.exec(host, "whoami").pipe(Effect.flip)
      expect(result._tag).toBe("SshCommandError")
      expect(result.host).toBe(host.ip)
    }).pipe(Effect.provide(FakeSshLive({}))))
})
