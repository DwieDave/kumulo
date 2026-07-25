/**
 * Sops-backed `ConfigProvider` (R1/R4/R6/R7): serves credentials from a
 * sops-encrypted YAML file whose top-level keys are the exact env-var names
 * (`OVH_CLIENT_SECRET: ...`, `HCLOUD_TOKEN: ...`).
 *
 * Plaintext is read from the child process's stdout only and never written to
 * disk (R7) — the mirror image of `sink.ts`'s stdin discipline. Decryption is
 * lazy and happens at most once per process (R4): `sops` is spawned on the
 * first `Config` read that reaches this provider, so a run whose env vars
 * already cover everything never spawns it at all.
 *
 * Canonical source: .docs/workflows/sops-provider-secrets/requirements.md.
 */
import { ConfigProvider, Effect, Exit, Schema, Semaphore, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner as ChildProcessSpawnerNS } from "effect/unstable/process"

// kumulo: same nested-tag caveat as `sink.ts` — only the `Service` shape is
// needed here, callers pass an already-resolved instance.
type ChildProcessSpawnerService = (typeof ChildProcessSpawnerNS.ChildProcessSpawner)["Service"]

/**
 * The secrets-file contract (R1): a flat mapping of env-var names to string
 * values. Non-string values are a decode error; unknown keys are fine, since
 * one file may hold vars for several clusters and tools.
 */
export const SopsSecrets = Schema.Record(Schema.String, Schema.String)

/** Flat env-var-name → value map decrypted out of a sops file. */
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

/** Decrypts a sops file to a flat string-valued record. `spawner` is resolved by the caller (N2). */
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

// Runs `self` at most once, replaying its `Exit` — success or failure — to
// every later caller. The semaphore closes the interleaving window so
// concurrent `Config` reads share one `sops` spawn, and memoizing the failure
// too keeps the spawn at most once per process even when several credential
// reads hit a broken file (R4).
const _once = <A, E>(self: Effect.Effect<A, E>): Effect.Effect<A, E> => {
  const gate = Semaphore.makeUnsafe(1)
  let memo: Exit.Exit<A, E> | undefined
  const compute = Effect.flatten(Effect.tap(Effect.exit(self), (exit) => Effect.sync(() => { memo = exit })))
  const guarded = gate.withPermits(1)(Effect.suspend(() => memo ?? compute))
  return Effect.suspend(() => memo ?? guarded)
}

/**
 * A `ConfigProvider` serving the top-level keys of a sops-encrypted file.
 * Only single-segment paths resolve — the file format is flat by contract (R1).
 */
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
