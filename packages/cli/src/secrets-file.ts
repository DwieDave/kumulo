import { resolve } from "node:path"
import { ConfigProvider } from "effect"
import { sopsConfigProvider } from "@kumulo/secrets-sops"
import type { ChildProcessSpawner as ChildProcessSpawnerNS } from "effect/unstable/process"

type ChildProcessSpawnerService = (typeof ChildProcessSpawnerNS.ChildProcessSpawner)["Service"]

const _nonBlank = (value: string | undefined): string | undefined =>
  value !== undefined && value.trim().length > 0 ? value : undefined

export const resolveSecretsFile = (
  { flag, env }: {
    readonly flag: string | undefined
    readonly env: Readonly<Record<string, string | undefined>>
  }
): string | undefined => _nonBlank(flag) ?? _nonBlank(env.KUMULO_SECRETS_FILE)

// env vars win over sops file; a var in both never spawns sops
export const secretsConfigProvider = (
  { file, spawner }: { readonly file: string; readonly spawner: ChildProcessSpawnerService }
): ConfigProvider.ConfigProvider =>
  ConfigProvider.orElse(ConfigProvider.fromEnv(), sopsConfigProvider({ file: resolve(file), spawner }))
