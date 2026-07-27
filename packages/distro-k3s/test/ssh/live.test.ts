import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit } from "effect"
import { BootstrapFailed } from "@kumulo/core"
import { SshLive } from "../../src/ssh/live.ts"
import { Ssh } from "../../src/ssh/port.ts"
import { shellQuote } from "../../src/ssh/shell.ts"

const host = { ip: "10.0.0.1", port: 22 }
const missingKey = "/nonexistent/kumulo-test/id_ed25519"

const _withMissingKey = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = process.env["KUMULO_SSH_PRIVATE_KEY_PATH"]
      process.env["KUMULO_SSH_PRIVATE_KEY_PATH"] = missingKey
      return previous
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        if (previous === undefined) delete process.env["KUMULO_SSH_PRIVATE_KEY_PATH"]
        else process.env["KUMULO_SSH_PRIVATE_KEY_PATH"] = previous
      })
  )

describe("SshLive with a missing private key", () => {
  it.effect("fails with a typed SshCommandError naming the path — not a defect", () =>
    _withMissingKey(
      Effect.gen(function*() {
        const ssh = yield* Ssh
        const exit = yield* Effect.exit(ssh.exec(host, "true"))
        expect(Exit.isFailure(exit)).toBe(true)
        const error = yield* Effect.flip(ssh.exec(host, "true"))
        expect(error._tag).toBe("SshCommandError")
        expect(String(error.cause)).toContain(missingKey)
      }).pipe(Effect.provide(SshLive))
    ))

  it.effect("that failure is renderable as a CLI error via BootstrapFailed", () =>
    _withMissingKey(
      Effect.gen(function*() {
        const ssh = yield* Ssh
        const error = yield* ssh.exec(host, "true").pipe(
          Effect.mapError((cause) => new BootstrapFailed({ node: host.ip, phase: "install", log: String(cause.cause) })),
          Effect.flip
        )
        expect(error._tag).toBe("BootstrapFailed")
        expect(error.log).toContain("ssh key not found at")
      }).pipe(Effect.provide(SshLive))
    ))
})

describe("shellQuote", () => {
  it("neutralises embedded quotes and metacharacters", () => {
    expect(shellQuote("/etc/x; rm -rf /")).toBe("'/etc/x; rm -rf /'")
    expect(shellQuote("it's")).toBe("'it'\\''s'")
  })
})
