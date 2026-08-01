// kumulo: plaintext is piped only through sops's stdin, never written to disk — only the ciphertext sops prints to stdout is.
import { Effect, Layer, Stream } from "effect"
import type { FileSystem } from "effect/FileSystem"
import type { PlatformError } from "effect/PlatformError"
import type { ChildProcessSpawner as ChildProcessSpawnerNS } from "effect/unstable/process";
import { ChildProcess } from "effect/unstable/process"
import { stringify } from "yaml"
import { CredentialsSink, SinkUnavailable } from "@kumulo/core"
import type { CredentialEntry } from "@kumulo/core"
import { buildCredentialsPayload } from "./entries.ts"

type ChildProcessSpawnerService = (typeof ChildProcessSpawnerNS.ChildProcessSpawner)["Service"]

export const credentialsPath = ({ dir, cluster }: { readonly dir: string; readonly cluster: string }): string =>
  `${dir.endsWith("/") ? dir.slice(0, -1) : dir}/${cluster}.credentials.yaml`

const _clusterOf = (payload: Record<string, unknown>): string | undefined =>
  typeof payload.cluster === "string" && payload.cluster.trim().length > 0 ? payload.cluster : undefined

const _encryptWithSops = (
  { ageRecipient, plaintext, spawner }: {
    readonly ageRecipient: string
    readonly plaintext: string
    readonly spawner: ChildProcessSpawnerService
  }
): Effect.Effect<string, SinkUnavailable | PlatformError> =>
  Effect.scoped(Effect.gen(function*() {
    const command = ChildProcess.make(
      "sops",
      ["--encrypt", "--input-type", "yaml", "--output-type", "yaml", "--age", ageRecipient, "/dev/stdin"],
      { stdin: Stream.encodeText(Stream.make(plaintext)) }
    )
    const handle = yield* spawner.spawn(command)
    const [stdout, stderr, exitCode] = yield* Effect.all(
      [Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr)), handle.exitCode],
      { concurrency: "unbounded" }
    )
    if (exitCode !== 0) return yield* Effect.fail(new SinkUnavailable({ hint: `sops exited with code ${exitCode}: ${stderr.trim()}` }))
    return stdout
  }))

const _write = (
  { dir, ageRecipient, entries, spawner, fs }: {
    readonly dir: string
    readonly ageRecipient: string
    readonly entries: ReadonlyArray<CredentialEntry>
    readonly spawner: ChildProcessSpawnerService
    readonly fs: FileSystem
  }
): Effect.Effect<void, SinkUnavailable> =>
  Effect.gen(function*() {
    if (ageRecipient.trim().length === 0) {
      return yield* Effect.fail(new SinkUnavailable({ hint: "no age recipient configured for the sops credentials sink" }))
    }
    const payload = buildCredentialsPayload(entries)
    const cluster = _clusterOf(payload)
    if (cluster === undefined) {
      return yield* Effect.fail(new SinkUnavailable({ hint: 'credential entries must include a non-empty "cluster" key' }))
    }
    const ciphertext = yield* _encryptWithSops({ ageRecipient, plaintext: stringify(payload), spawner })
    yield* fs.writeFileString(credentialsPath({ dir, cluster }), ciphertext)
  }).pipe(Effect.catchTag("PlatformError", (cause) => Effect.fail(new SinkUnavailable({ hint: cause.message }))))

export const sopsCredentialsSinkLive = (
  { dir, ageRecipient, spawner, fs }: {
    readonly dir: string
    readonly ageRecipient: string
    readonly spawner: ChildProcessSpawnerService
    readonly fs: FileSystem
  }
): Layer.Layer<CredentialsSink> =>
  Layer.succeed(CredentialsSink, CredentialsSink.of({
    write: (entries) => _write({ dir, ageRecipient, entries, spawner, fs })
  }))
