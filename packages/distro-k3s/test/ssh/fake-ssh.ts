import { Effect, Layer } from "effect"
import { SshCommandError } from "../../src/ssh/errors.ts"
import { Ssh } from "../../src/ssh/port.ts"
import type { SshHost } from "../../src/ssh/port.ts"

// Scriptable in-memory `Ssh` fake — each hook is a plain function so a test
// can close over its own mutable state (e.g. a call counter) to simulate
// "not ready yet, then ready" sequences without a shared queue abstraction.
// Reused across readiness-gate and bootstrap-exec tests.
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
  // kumulo: WHY Effect.suspend — the returned Effect is re-run once per
  // repeat/retry iteration (that's the whole point of testing a retry
  // schedule); without `suspend` deferring the JS closure to run-time, the
  // call counter would only tick once, at description-construction time.
  return (host, command) =>
    Effect.suspend(() => {
      calls += 1
      if (calls <= failures) return Effect.fail(new SshCommandError({ host: host.ip, command, cause: "not ready" }))
      return Effect.succeed("ok")
    })
}
