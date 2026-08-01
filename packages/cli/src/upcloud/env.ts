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
  /** Not part of `UksClients`: only the zone doctor check reads it (`doctor/upcloud/zone.ts`). */
  readonly zones: ZoneClient
  /** `/1.3/storage` — the `volumes.module: "upcloud"` path (`upcloud/volumes.ts`) and its doctor check. */
  readonly storage: StorageClient
  /** `/object-storage-2` — the `object_storage.module: "upcloud"` path (`upcloud/storage.ts`) and its doctor check. */
  readonly objectStorage: ObjectStorageClient
}

/** Holds the four composed UpCloud API clients (`UksClients`, T5.1) the `upcloud-uks` distro talks to. */
export class UpcloudEnv extends Context.Service<UpcloudEnv, UpcloudEnvShape>()("@kumulo/cli/UpcloudEnv") {}

/** Live wiring for the upcloud-uks path: a static bearer token (D1) wrapping every generated client. */
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
