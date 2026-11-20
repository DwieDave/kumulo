import { Config, Effect, Layer } from "effect"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { Client } from "ssh2"
import { SshCommandError, SshHostKeyMismatch, redactCommand } from "./errors.ts"
import { checkHostKey } from "./known-hosts.ts"
import { Ssh } from "./port.ts"
import type { SshHost } from "./port.ts"
import { shellQuote } from "./shell.ts"

const SSH_USER = "root"

const _privateKeyPath: Effect.Effect<string> = Config.String("KUMULO_SSH_PRIVATE_KEY_PATH").pipe(
  Config.withDefault(`${homedir()}/.ssh/id_ed25519`),
  Effect.orDie
)

// no connection pooling, add a cache if this fans out to many commands per node
const _withSession = <A>(
  knownHostsPath: string,
  host: SshHost,
  rawCommand: string,
  onReady: (client: Client, resolve: (value: A) => void, reject: (error: SshCommandError) => void) => void
): Effect.Effect<A, SshCommandError> =>
  Effect.gen(function*() {
    const command = redactCommand(rawCommand)
    const privateKeyPath = yield* _privateKeyPath

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
      let mismatch: SshHostKeyMismatch | undefined
      client
        .on("ready", () => onReady(client, (value) => resume(Effect.succeed(value)), (error) => resume(Effect.fail(error))))
        .on("error", (cause) => resume(Effect.fail(new SshCommandError({ host: host.ip, command, cause: mismatch ?? cause }))))
        .connect({
          host: host.ip,
          port: host.port,
          username: SSH_USER,
          privateKey,
          // trust-on-first-use: record on first connect, reject any later change
          hostVerifier: (key: Buffer) => {
            if (checkHostKey({ path: knownHostsPath, host, key }) !== "mismatch") return true
            mismatch = new SshHostKeyMismatch({ host: host.ip, knownHostsPath })

            return false
          }
        })

      return Effect.sync(() => client.end())
    })
  })

const _exec = (knownHostsPath: string) => (host: SshHost, rawCommand: string): Effect.Effect<string, SshCommandError> => {
  const command = redactCommand(rawCommand)

  return _withSession(knownHostsPath, host, rawCommand, (client, resolve, reject) => {
    client.exec(rawCommand, (err, stream) => {
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
}

export const makeSshLive = (args: { readonly knownHostsPath: string }): Layer.Layer<Ssh> => {
  const exec = _exec(args.knownHostsPath)

  return Layer.succeed(Ssh, {
    exec,
    readFile: (host, path) => exec(host, `cat -- ${shellQuote(path)}`),
    waitReady: (host) => exec(host, "true").pipe(Effect.asVoid)
  })
}

export const SshLive: Layer.Layer<Ssh> = makeSshLive({ knownHostsPath: `${homedir()}/.kumulo/known_hosts` })
