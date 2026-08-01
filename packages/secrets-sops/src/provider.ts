// Plaintext is read from the child process's stdout only and never written to disk.
import type { Exit} from "effect";
import { ConfigProvider, Effect, Schema, Semaphore, Stream } from "effect"
import type { ChildProcessSpawner as ChildProcessSpawnerNS } from "effect/unstable/process";
import { ChildProcess } from "effect/unstable/process"

type ChildProcessSpawnerService = (typeof ChildProcessSpawnerNS.ChildProcessSpawner)["Service"]

export const SopsSecrets = Schema.Record(Schema.String, Schema.String)

export type SopsSecrets = typeof SopsSecrets["Type"]

const _sourceError = (
  { file, detail, cause }: { readonly file: string; readonly detail: string; readonly cause?: unknown }
): ConfigProvider.SourceError =>
  new ConfigProvider.SourceError({ message: `failed to read sops secrets file ${file}: ${detail}`, cause })

const _parseFlatRecord = (
  { file, stdout }: { readonly file: string; readonly stdout: string }
): Effect.Effect<SopsSecrets, ConfigProvider.SourceError> =>
  Effect.gen(function*() {
    const document: unknown = yield* Effect.try({
      try: () => JSON.parse(stdout),
      catch: (cause) => _sourceError({ file, detail: "sops output is not valid JSON", cause })
    })
    return yield* Schema.decodeUnknownEffect(SopsSecrets)(document).pipe(
      Effect.mapError((cause) =>
        _sourceError({ file, detail: `expected a mapping of env-var names to string values — ${cause.message}`, cause })
      )
    )
  })

export const decryptSopsFile = (
  { file, spawner }: { readonly file: string; readonly spawner: ChildProcessSpawnerService }
): Effect.Effect<SopsSecrets, ConfigProvider.SourceError> =>
  Effect.scoped(Effect.gen(function*() {
    const command = ChildProcess.make("sops", ["--decrypt", "--output-type", "json", file])
    const handle = yield* spawner.spawn(command)
    const [stdout, stderr, exitCode] = yield* Effect.all(
      [Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr)), handle.exitCode],
      { concurrency: "unbounded" }
    )
    if (exitCode !== 0) {
      return yield* Effect.fail(_sourceError({ file, detail: `sops exited with code ${exitCode}: ${stderr.trim()}` }))
    }
    return yield* _parseFlatRecord({ file, stdout })
  })).pipe(
    Effect.catchTag("PlatformError", (cause) => Effect.fail(_sourceError({ file, detail: cause.message, cause })))
  )

// Memoizes the Exit (success or failure) so concurrent callers share one spawn instead of racing.
const _once = <A, E>(self: Effect.Effect<A, E>): Effect.Effect<A, E> => {
  const gate = Semaphore.makeUnsafe(1)
  let memo: Exit.Exit<A, E> | undefined
  const compute = Effect.flatten(Effect.tap(Effect.exit(self), (exit) => Effect.sync(() => { memo = exit })))
  const guarded = gate.withPermits(1)(Effect.suspend(() => memo ?? compute))
  return Effect.suspend(() => memo ?? guarded)
}

export const sopsConfigProvider = (
  { file, spawner }: { readonly file: string; readonly spawner: ChildProcessSpawnerService }
): ConfigProvider.ConfigProvider => {
  const secrets = _once(decryptSopsFile({ file, spawner }))
  return ConfigProvider.make(([key, ...rest]) =>
    typeof key !== "string" || rest.length > 0
      ? Effect.succeed(undefined)
      : Effect.map(secrets, (values) => {
        const value = values[key]
        return value === undefined ? undefined : ConfigProvider.makeValue(value)
      })
  )
}
