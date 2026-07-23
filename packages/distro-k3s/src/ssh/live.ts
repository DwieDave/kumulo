import { Effect, Layer } from "effect"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { Client } from "ssh2"
import { SshCommandError } from "./errors.ts"
import { Ssh } from "./port.ts"
import type { SshHost } from "./port.ts"

// kumulo: WHY root@key-only — matches hetzner-k3s's Util::SSH defaults
// (user "root", BatchMode/PubkeyAuthentication only, no password fallback).
const SSH_USER = "root"
const PRIVATE_KEY_PATH = process.env["KUMULO_SSH_PRIVATE_KEY_PATH"] ?? `${homedir()}/.ssh/id_ed25519`

// One-shot connect-exec-disconnect per call — no pooling.
// ponytail: fine for bootstrap's low call volume (readiness gates + a
// handful of install commands per node); add a connection cache if a
// future task fans this out to many commands per node.
const _withSession = <A>(
  host: SshHost,
  command: string,
  onReady: (client: Client, resolve: (value: A) => void, reject: (error: SshCommandError) => void) => void
): Effect.Effect<A, SshCommandError> =>
  Effect.callback<A, SshCommandError>((resume) => {
    const client = new Client()
    client
      .on("ready", () => onReady(client, (value) => resume(Effect.succeed(value)), (error) => resume(Effect.fail(error))))
      .on("error", (cause) => resume(Effect.fail(new SshCommandError({ host: host.ip, command, cause }))))
      .connect({ host: host.ip, port: host.port, username: SSH_USER, privateKey: readFileSync(PRIVATE_KEY_PATH) })
    return Effect.sync(() => client.end())
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
  readFile: (host, path) => _exec(host, `cat -- '${path}'`),
  waitReady: (host) => _exec(host, "true").pipe(Effect.asVoid)
})
