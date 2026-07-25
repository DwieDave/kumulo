/**
 * Secrets-file path discovery (R2). A plain argv scan — not a `Command` option —
 * because the path must be known before the CLI is built, to decide whether the
 * sops `ConfigProvider` gets installed at all.
 */
import { resolve } from "node:path"
import { ConfigProvider } from "effect"
import { sopsConfigProvider } from "@kumulo/secrets-sops"
import type { ChildProcessSpawner as ChildProcessSpawnerNS } from "effect/unstable/process"

type ChildProcessSpawnerService = (typeof ChildProcessSpawnerNS.ChildProcessSpawner)["Service"]

const _flag = "--secrets-file"

const _nonBlank = (value: string | undefined): string | undefined =>
  value !== undefined && value.trim().length > 0 ? value : undefined

const _fromArgv = (argv: ReadonlyArray<string>): string | undefined => {
  const index = argv.indexOf(_flag)
  if (index >= 0) return _nonBlank(argv[index + 1]?.startsWith("--") ? undefined : argv[index + 1])
  const inline = argv.find((arg) => arg.startsWith(`${_flag}=`))
  return inline === undefined ? undefined : _nonBlank(inline.slice(_flag.length + 1))
}

/**
 * Removes `--secrets-file [<path>]` / `--secrets-file=<path>` tokens from argv.
 * The flag is consumed here, before the CLI parser ever sees it (R2) — it is not
 * declared on any `Command`, so leaving it in argv would be rejected by
 * `Command.run` as an unrecognized flag.
 */
export const stripSecretsFileFlag = (argv: ReadonlyArray<string>): Array<string> =>
  argv.filter((arg, index) => {
    if (arg === _flag || arg.startsWith(`${_flag}=`)) return false
    return !(argv[index - 1] === _flag && !arg.startsWith("--"))
  })

/** Resolves the secrets-file path from `--secrets-file <path>` / `--secrets-file=<path>`, else `KUMULO_SECRETS_FILE`, else `undefined`. Pure — no process globals. */
export const resolveSecretsFile = (
  { argv, env }: {
    readonly argv: ReadonlyArray<string>
    readonly env: Readonly<Record<string, string | undefined>>
  }
): string | undefined => _fromArgv(argv) ?? _nonBlank(env.KUMULO_SECRETS_FILE)

/**
 * Real env vars first, the sops file only as a fallback (R3) — a var present in
 * both resolves to the env value and `sops` is never spawned for it (R4).
 * Relative paths resolve against the cwd (R2) so failures name an absolute path.
 */
export const secretsConfigProvider = (
  { file, spawner }: { readonly file: string; readonly spawner: ChildProcessSpawnerService }
): ConfigProvider.ConfigProvider =>
  ConfigProvider.orElse(ConfigProvider.fromEnv(), sopsConfigProvider({ file: resolve(file), spawner }))
