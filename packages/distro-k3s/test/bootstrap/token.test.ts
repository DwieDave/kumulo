import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { SshCommandError } from "../../src/ssh/errors.ts"
import type { SshHost } from "../../src/ssh/port.ts"
import { resolveToken } from "../../src/bootstrap/token.ts"
import { FakeSshLive } from "../ssh/fake-ssh.ts"

const m1: SshHost = { ip: "10.0.0.1", port: 22 }
const m2: SshHost = { ip: "10.0.0.2", port: 22 }
const m3: SshHost = { ip: "10.0.0.3", port: 22 }

const _fail = (host: SshHost, command: string) =>
  Effect.fail(new SshCommandError({ host: host.ip, command, cause: "no token file" }))

describe("resolveToken", () => {
  it.live("falls back to a fresh random token and masters[0] when no master has a token file", () =>
    Effect.gen(function*() {
      const resolved = yield* resolveToken([m1, m2])
      expect(resolved.token).toMatch(/^[0-9a-f]{64}$/)
      expect(resolved.firstMaster).toEqual(m1)
    }).pipe(Effect.provide(FakeSshLive({ readFile: _fail }))))

  it.live("quorum-reads the most common token across masters", () =>
    Effect.gen(function*() {
      const resolved = yield* resolveToken([m1, m2, m3])
      expect(resolved.token).toBe("majority-token")
    }).pipe(Effect.provide(FakeSshLive({
      readFile: (host) =>
        host.ip === m3.ip ? Effect.succeed("stale-token") : Effect.succeed("majority-token")
    }))))

  it.live("picks the oldest token-file bearer as the stable first master", () =>
    Effect.gen(function*() {
      const resolved = yield* resolveToken([m1, m2])
      expect(resolved.firstMaster).toEqual(m2)
    }).pipe(Effect.provide(FakeSshLive({
      readFile: () => Effect.succeed("shared-token"),
      exec: (host) => Effect.succeed(host.ip === m2.ip ? "1000" : "2000")
    }))))
})
