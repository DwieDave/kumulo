import { Context, Effect, Layer } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import type { AuthenticationFailed } from "@kumulo/core"
import type { UksClients } from "@kumulo/distro-upcloud-uks"
import type { ObjectStorageClient, StorageClient, ZoneClient } from "@kumulo/upcloud"
import {
  makeNetworkClient,
  makeNodeGroupsClient,
  makeObjectStorageClient,
  makeRouterClient,
  makeStorageClient,
  makeUksClient,
  makeZoneClient,
  UpcloudHttpLive
} from "@kumulo/upcloud"
import { requiredRedactedEnv } from "../env.ts"

export interface UpcloudEnvShape {
  readonly clients: UksClients
  readonly zones: ZoneClient
  readonly storage: StorageClient
  readonly objectStorage: ObjectStorageClient
}

export class UpcloudEnv extends Context.Service<UpcloudEnv, UpcloudEnvShape>()("@kumulo/cli/UpcloudEnv") {}

export const UpcloudEnvLive: Layer.Layer<UpcloudEnv, AuthenticationFailed, HttpClient.HttpClient> = Layer.effect(
  UpcloudEnv,
  Effect.gen(function*() {
    const token = yield* requiredRedactedEnv("UPCLOUD_API_TOKEN")
    const httpClient = yield* Effect.provide(HttpClient.HttpClient, UpcloudHttpLive({ token }))
    return {
      clients: {
        uks: makeUksClient(httpClient),
        nodeGroups: makeNodeGroupsClient(httpClient),
        network: makeNetworkClient(httpClient),
        router: makeRouterClient(httpClient)
      },
      zones: makeZoneClient(httpClient),
      storage: makeStorageClient(httpClient),
      objectStorage: makeObjectStorageClient(httpClient)
    }
  })
)
