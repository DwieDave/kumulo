import { Effect, FileSystem } from "effect"
import { BootstrapFailed } from "@kumulo/core"

export interface WriteKubeconfigFileArgs {
  readonly path: string
  readonly content: string
}

// kumulo: kubeconfig holds a client cert/token; chmod again as the write mode is not applied to existing files.
export const writeKubeconfigFile = (
  { content, path }: WriteKubeconfigFileArgs
): Effect.Effect<void, BootstrapFailed, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const tmp = `${path}.${crypto.randomUUID()}.tmp`

    yield* fs.writeFileString(tmp, content, { mode: 0o600 })
    yield* fs.chmod(tmp, 0o600)
    yield* fs.rename(tmp, path).pipe(Effect.tapError(() => Effect.ignore(fs.remove(tmp))))
  }).pipe(
    Effect.mapError((cause) => new BootstrapFailed({ node: path, phase: "writeKubeconfig", log: String(cause) }))
  )
