import { Context, Effect, Layer } from "effect"
import { FileSystem } from "effect/FileSystem"
import * as HttpClient from "effect/unstable/http/HttpClient"
import { ChildProcessSpawner as ChildProcessSpawnerNS } from "effect/unstable/process"
import { ConfigInvalid } from "@kumulo/core"
import type { AuthenticationFailed, CredentialsSink, ObjectStorageProvider } from "@kumulo/core"
import type { ClusterConfig } from "../cluster-config.ts"
import { makeStorageClient, ovhObjectStorageProviderLive, type Storage } from "@kumulo/storage-ovh"
import { sopsCredentialsSinkLive } from "@kumulo/secrets-sops"
import { MksEnv, ovhHttpClientFromEnv } from "../mks/env.ts"

const ChildProcessSpawner = ChildProcessSpawnerNS.ChildProcessSpawner

export interface StorageEnvShape {
  readonly storage: Storage
  readonly serviceName: string
}

export class StorageEnv extends Context.Service<StorageEnv, StorageEnvShape>()("@kumulo/cli/StorageEnv") {}

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
      new ConfigInvalid({ issues: [{ path: ["secrets", "sops"], message: "sops config is required when object_storage.module is ovh" }] })
    )
    : Effect.succeed({ dir: config.secrets.dir, ageRecipient: config.secrets.sops.age_recipient })

// _sopsConfig's failure path only fires on a config that bypassed schema decode.
export const storageLayers = (
  config: ClusterConfig
): Effect.Effect<
  Layer.Layer<ObjectStorageProvider | CredentialsSink>,
  ConfigInvalid,
  StorageEnv | FileSystem | ChildProcessSpawnerNS.ChildProcessSpawner
> =>
  Effect.gen(function*() {
    const { storage, serviceName } = yield* StorageEnv
    const fs = yield* FileSystem
    const spawner = yield* ChildProcessSpawner
    const sops = yield* _sopsConfig(config)
    const providerLayer = ovhObjectStorageProviderLive({ storage, serviceName })
    const sinkLayer = sopsCredentialsSinkLive({ dir: sops.dir, ageRecipient: sops.ageRecipient, spawner, fs })
    return Layer.merge(providerLayer, sinkLayer)
  })
