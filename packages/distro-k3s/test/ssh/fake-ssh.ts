import { Effect, Layer } from "effect"
import { SshCommandError } from "../../src/ssh/errors.ts"
import { Ssh } from "../../src/ssh/port.ts"
import type { SshHost } from "../../src/ssh/port.ts"

export interface SshScript {
  readonly exec?: (host: SshHost, command: string) => Effect.Effect<string, SshCommandError>
  readonly readFile?: (host: SshHost, path: string) => Effect.Effect<string, SshCommandError>
  readonly waitReady?: (host: SshHost) => Effect.Effect<void, SshCommandError>
}

const _unscripted = (host: SshHost, command: string) =>
  Effect.fail(new SshCommandError({ host: host.ip, command, cause: "no fake response scripted" }))

export const FakeSshLive = (script: SshScript): Layer.Layer<Ssh> =>
  Layer.succeed(Ssh, {
    exec: (host, command) => (script.exec ? script.exec(host, command) : _unscripted(host, command)),
    readFile: (host, path) => (script.readFile ? script.readFile(host, path) : _unscripted(host, `cat ${path}`)),
    waitReady: (host) => (script.waitReady ? script.waitReady(host) : _unscripted(host, "connect").pipe(Effect.asVoid))
  })

/** Fails the first `failures` calls, then succeeds — for readiness-gate retry tests. */
export const flakyThenOk = (
  failures: number
): (host: SshHost, command: string) => Effect.Effect<string, SshCommandError> => {
  let calls = 0
  // kumulo: Effect.suspend is required — without it the call counter ticks once at construction, not per retry.
  return (host, command) =>
    Effect.suspend(() => {
      calls += 1
      if (calls <= failures) return Effect.fail(new SshCommandError({ host: host.ip, command, cause: "not ready" }))
      return Effect.succeed("ok")
    })
}
