/**
 * Secrets-file path resolution (R2): the parsed `--secrets-file` shared flag
 * first, else `KUMULO_SECRETS_FILE`. The flag is a real `Command` flag (visible
 * in `--help`); the resulting sops `ConfigProvider` is installed per-invocation
 * via `Command.provide` in `main.ts`, after parsing.
 */
import { resolve } from "node:path"
import { ConfigProvider } from "effect"
import { sopsConfigProvider } from "@kumulo/secrets-sops"
import type { ChildProcessSpawner as ChildProcessSpawnerNS } from "effect/unstable/process"

type ChildProcessSpawnerService = (typeof ChildProcessSpawnerNS.ChildProcessSpawner)["Service"]

const _nonBlank = (value: string | undefined): string | undefined =>
  value !== undefined && value.trim().length > 0 ? value : undefined

/** Resolves the secrets-file path from the parsed `--secrets-file` flag, else `KUMULO_SECRETS_FILE`, else `undefined`. Pure — no process globals. */
export const resolveSecretsFile = (
  { flag, env }: {
    readonly flag: string | undefined
    readonly env: Readonly<Record<string, string | undefined>>
  }
): string | undefined => _nonBlank(flag) ?? _nonBlank(env.KUMULO_SECRETS_FILE)

/**
 * Real env vars first, the sops file only as a fallback (R3) — a var present in
 * both resolves to the env value and `sops` is never spawned for it (R4).
 * Relative paths resolve against the cwd (R2) so failures name an absolute path.
 */
export const secretsConfigProvider = (
  { file, spawner }: { readonly file: string; readonly spawner: ChildProcessSpawnerService }
): ConfigProvider.ConfigProvider =>
  ConfigProvider.orElse(ConfigProvider.fromEnv(), sopsConfigProvider({ file: resolve(file), spawner }))
