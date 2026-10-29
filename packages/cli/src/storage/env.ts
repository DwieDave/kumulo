import { Context, Effect, Layer } from "effect"
import { FileSystem } from "effect/FileSystem"
import * as HttpClient from "effect/http/HttpClient"
import { ChildProcessSpawner as ChildProcessSpawnerNS } from "effect/process"
import { ConfigInvalid } from "@kumulo/core"
import type { AuthenticationFailed, CredentialsSink, ObjectStorageProvider } from "@kumulo/core"
import type { ClusterConfig } from "../cluster-config.ts"
import { makeStorageClient, ovhObjectStorageProviderLive, type Storage } from "@kumulo/storage-ovh"
import { bunnyObjectStorageProviderLive, readOutputs as bunnyReadOutputs } from "@kumulo/storage-bunny"
import type { OutputsBucket as BunnyOutputsBucket, OutputsInvalid as BunnyOutputsInvalid } from "@kumulo/storage-bunny"
import { makeBunnyHttpClient, makeBunnyStorageClient } from "@kumulo/bunny"
import type { BunnyStorageClient } from "@kumulo/bunny"
import type { PlatformError } from "effect/PlatformError"
import { requiredRedactedEnv } from "../env.ts"
import { sopsCredentialsSinkLive } from "@kumulo/secrets-sops"
import { MksEnv, ovhHttpClientFromEnv } from "../mks/env.ts"

const ChildProcessSpawner = ChildProcessSpawnerNS.ChildProcessSpawner

export interface StorageEnvFields {
  readonly storage: Storage
  readonly serviceName: string
}

export class BunnyStorage extends Context.Service<BunnyStorage, { readonly storage: BunnyStorageClient }>()(
  "@kumulo/cli/BunnyStorage"
) {}

export class StorageEnv extends Context.Service<StorageEnv, StorageEnvFields>()("@kumulo/cli/StorageEnv") {}

export const StorageEnvLive: Layer.Layer<StorageEnv, AuthenticationFailed, MksEnv | HttpClient.HttpClient> = Layer.effect(
  StorageEnv,
  Effect.gen(function*() {
    const { serviceName } = yield* MksEnv
    const httpClient = yield* Effect.provide(HttpClient.HttpClient, ovhHttpClientFromEnv())

    return { storage: makeStorageClient(httpClient), serviceName }
  })
)

const _sopsConfig = (config: ClusterConfig): Effect.Effect<{ readonly dir: string; readonly ageRecipient: string }, ConfigInvalid> =>
  config.secrets.sink !== "sops"
    ? Effect.fail(
      new ConfigInvalid({
        issues: [{
          path: ["secrets", "sops"],
          message: `sops config is required when object_storage.module is ${config.object_storage.module}`
        }]
      })
    )
    : Effect.succeed({ dir: config.secrets.dir, ageRecipient: config.secrets.sops.age_recipient })

const _bunnyOwned = (
  { config, configDir }: { readonly config: ClusterConfig; readonly configDir: string }
): Effect.Effect<ReadonlyArray<BunnyOutputsBucket>, BunnyOutputsInvalid | PlatformError, FileSystem> =>
  Effect.map(
    bunnyReadOutputs({ dir: configDir, tag: config.name, format: config.outputs?.format }),
    (file) => file.buckets
  )

const _bunnyProviderLayer = (
  { config, configDir }: { readonly config: ClusterConfig; readonly configDir: string }
): Effect.Effect<
  Layer.Layer<ObjectStorageProvider | BunnyStorage>,
  AuthenticationFailed | BunnyOutputsInvalid | PlatformError,
  FileSystem | HttpClient.HttpClient
> =>
  Effect.gen(function*() {
    const apiKey = yield* requiredRedactedEnv("BUNNYNET_API_KEY")
    const base = yield* HttpClient.HttpClient
    const storage = makeBunnyStorageClient(makeBunnyHttpClient({ base, apiKey }))
    const owned = yield* _bunnyOwned({ config, configDir })

    return Layer.merge(bunnyObjectStorageProviderLive({ storage, owned }), Layer.succeed(BunnyStorage, { storage }))
  })

export const storageProviderLayer = (
  { config, configDir }: { readonly config: ClusterConfig; readonly configDir: string }
): Effect.Effect<
  Layer.Layer<ObjectStorageProvider>,
  AuthenticationFailed | BunnyOutputsInvalid | PlatformError,
  StorageEnv | FileSystem | HttpClient.HttpClient
> =>
  config.object_storage.module === "bunny"
    ? _bunnyProviderLayer({ config, configDir })
    : Effect.map(StorageEnv, (env) => ovhObjectStorageProviderLive(env))

// _sopsConfig's failure path only fires on a config that bypassed schema decode.
export const storageLayers = (
  { config, configDir }: { readonly config: ClusterConfig; readonly configDir: string }
): Effect.Effect<
  Layer.Layer<ObjectStorageProvider | CredentialsSink>,
  ConfigInvalid | AuthenticationFailed | BunnyOutputsInvalid | PlatformError,
  StorageEnv | FileSystem | HttpClient.HttpClient | ChildProcessSpawnerNS.ChildProcessSpawner
> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const spawner = yield* ChildProcessSpawner
    const sops = yield* _sopsConfig(config)
    const providerLayer = yield* storageProviderLayer({ config, configDir })
    const sinkLayer = sopsCredentialsSinkLive({ dir: sops.dir, ageRecipient: sops.ageRecipient, spawner, fs })

    return Layer.merge(providerLayer, sinkLayer)
  })
