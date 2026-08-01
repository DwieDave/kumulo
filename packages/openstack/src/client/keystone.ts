import type { Effect } from "effect"
import { HttpApiClient } from "effect/unstable/httpapi"
import { Keystone } from "../generated/keystone.ts"
import { failNon2xx } from "../transport/http-client.ts"

// OS_AUTH_URL may already end in /v3; generated paths are absolute — drop the duplicate
export const keystoneBaseUrl = (authUrl: string): string => authUrl.replace(/\/*(v3\/*)?$/, "")

export const makeKeystoneClient = (authUrl: string) =>
  HttpApiClient.make(Keystone, { baseUrl: keystoneBaseUrl(authUrl), transformClient: failNon2xx })

export type KeystoneClient = Effect.Success<ReturnType<typeof makeKeystoneClient>>
