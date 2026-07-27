/**
 * Thin, friendlier wrapper around the generated Keystone client.
 *
 * Deliberately does NOT take `KeystoneAuth`: this is the client that mints the
 * token everything else authenticates with, so it runs on the bare
 * `HttpClient` its layer is given.
 */
import type { Effect } from "effect"
import { HttpApiClient } from "effect/unstable/httpapi"
import { Keystone } from "../generated/keystone.ts"
import { failNon2xx } from "../transport/http-client.ts"

// `OS_AUTH_URL` conventionally already ends in `/v3` (or `/v3/`), while the
// generated paths are absolute (`/v3/auth/tokens`) — drop the duplicate.
export const keystoneBaseUrl = (authUrl: string): string => authUrl.replace(/\/*(v3\/*)?$/, "")

export const makeKeystoneClient = (authUrl: string) =>
  HttpApiClient.make(Keystone, { baseUrl: keystoneBaseUrl(authUrl), transformClient: failNon2xx })

export type KeystoneClient = Effect.Success<ReturnType<typeof makeKeystoneClient>>
