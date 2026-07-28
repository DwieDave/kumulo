/**
 * Shared test fixture: an `UpcloudEnv` backed by a failing `HttpClient`
 * (mirrors `main.ts`'s own fallback wiring). The distro service set is
 * shared across distros (`distro/types.ts`'s `DistroServices`), so every
 * `ovh-mks`/`k3s` test that exercises the full command pipeline now carries
 * `UpcloudEnv` in its requirements too, even though it must never reach it.
 */
import { Effect, Layer } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import { HttpClientError, TransportError } from "effect/unstable/http/HttpClientError"
import { makeNetworkClient, makeNodeGroupsClient, makeRouterClient, makeUksClient, makeZoneClient } from "@kumulo/upcloud"
import { UpcloudEnv } from "../src/upcloud/env.ts"

const _unavailableUpcloudHttpClient = HttpClient.make((request) =>
  Effect.fail(
    new HttpClientError({ reason: new TransportError({ request, description: "UpCloud is not used by this test" }) })
  )
)

export const unavailableUpcloudEnvLayer: Layer.Layer<UpcloudEnv> = Layer.succeed(UpcloudEnv, {
  clients: {
    uks: makeUksClient(_unavailableUpcloudHttpClient),
    nodeGroups: makeNodeGroupsClient(_unavailableUpcloudHttpClient),
    network: makeNetworkClient(_unavailableUpcloudHttpClient),
    router: makeRouterClient(_unavailableUpcloudHttpClient)
  },
  zones: makeZoneClient(_unavailableUpcloudHttpClient)
})
