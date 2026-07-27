import { Config, Effect, Layer } from "effect"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { Client } from "ssh2"
import { SshCommandError } from "./errors.ts"
import { Ssh } from "./port.ts"
import type { SshHost } from "./port.ts"
import { shellQuote } from "./shell.ts"

// kumulo: WHY root@key-only — user "root", pubkey-auth only, no password
// fallback.
const SSH_USER = "root"
// `withDefault` only leaves the (never-reachable, `Schema.String` accepts any
// string) validation-error branch of `ConfigError` — `orDie` documents that.
const _privateKeyPath: Effect.Effect<string> = Config.string("KUMULO_SSH_PRIVATE_KEY_PATH").pipe(
  Config.withDefault(`${homedir()}/.ssh/id_ed25519`),
  Effect.orDie
)

// One-shot connect-exec-disconnect per call — no pooling.
// ponytail: fine for bootstrap's low call volume (readiness gates + a
// handful of install commands per node); add a connection cache if a
// future task fans this out to many commands per node.
const _withSession = <A>(
  host: SshHost,
  command: string,
  onReady: (client: Client, resolve: (value: A) => void, reject: (error: SshCommandError) => void) => void
): Effect.Effect<A, SshCommandError> =>
  Effect.gen(function*() {
    const privateKeyPath = yield* _privateKeyPath
    // Read the key *outside* the callback: a throw inside `Effect.callback`
    // is a defect that bypasses the CLI's error rendering, so a missing key
    // has to surface as a typed failure like every other SSH failure.
    const privateKey = yield* Effect.try({
      try: () => readFileSync(privateKeyPath),
      catch: (cause) =>
        new SshCommandError({
          host: host.ip,
          command,
          cause: `ssh key not found at ${privateKeyPath} (set KUMULO_SSH_PRIVATE_KEY_PATH): ${String(cause)}`
        })
    })
    return yield* Effect.callback<A, SshCommandError>((resume) => {
      const client = new Client()
      client
        .on("ready", () => onReady(client, (value) => resume(Effect.succeed(value)), (error) => resume(Effect.fail(error))))
        .on("error", (cause) => resume(Effect.fail(new SshCommandError({ host: host.ip, command, cause }))))
        .connect({
          host: host.ip,
          port: host.port,
          username: SSH_USER,
          privateKey,
          // ponytail: trust-on-first-use — nodes are created seconds earlier by
          // this same run and no known_hosts store exists yet, so there is
          // nothing to verify against. Made explicit rather than relying on
          // ssh2's silent accept-all default. Upgrade path: pin the host key
          // reported by the provider's console output / cloud-init and compare.
          hostVerifier: () => true
        })
      return Effect.sync(() => client.end())
    })
  })

const _exec = (host: SshHost, command: string): Effect.Effect<string, SshCommandError> =>
  _withSession(host, command, (client, resolve, reject) => {
    client.exec(command, (err, stream) => {
      if (err) {
        reject(new SshCommandError({ host: host.ip, command, cause: err }))
        return
      }
      let out = ""
      let errOut = ""
      stream
        .on("data", (chunk: Buffer) => (out += chunk.toString()))
        .on("close", (code: number) => {
          client.end()
          if (code !== 0) reject(new SshCommandError({ host: host.ip, command, cause: `exit ${code}: ${errOut}` }))
          else resolve(out.trim())
        })
      stream.stderr.on("data", (chunk: Buffer) => (errOut += chunk.toString()))
    })
  })

export const SshLive: Layer.Layer<Ssh> = Layer.succeed(Ssh, {
  exec: _exec,
  readFile: (host, path) => _exec(host, `cat -- ${shellQuote(path)}`),
  waitReady: (host) => _exec(host, "true").pipe(Effect.asVoid)
})
