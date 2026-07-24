import { Effect } from "effect"
import { writeFileSync } from "node:fs"
import { BootstrapFailed } from "@kumulo/core"

export interface WriteKubeconfigFileArgs {
  readonly path: string
  readonly content: string
}

// Persisted kubeconfig must be 0600 (contains a client cert/token).
export const writeKubeconfigFile = (args: WriteKubeconfigFileArgs): Effect.Effect<void, BootstrapFailed> =>
  Effect.try({
    try: () => writeFileSync(args.path, args.content, { mode: 0o600 }),
    catch: (cause) => new BootstrapFailed({ node: args.path, phase: "writeKubeconfig", log: String(cause) })
  })
