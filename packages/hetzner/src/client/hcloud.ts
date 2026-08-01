// deliberately doesn't wire hcloudHttpClientLive (auth + retry); composition happens at the CLI wiring layer
import type { Effect } from "effect"
import { HttpApiClient } from "effect/unstable/httpapi"
import { HCLOUD_API_BASE_URL } from "../auth/client.ts"
import { Hcloud } from "../generated/hcloud.ts"

export const makeHcloudClient = HttpApiClient.make(Hcloud, { baseUrl: HCLOUD_API_BASE_URL })

export type HcloudClient = Effect.Success<typeof makeHcloudClient>
