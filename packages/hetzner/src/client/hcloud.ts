/**
 * Thin, friendlier re-export of the generated hcloud client.
 *
 * `src/generated/hcloud.ts` is an `HttpApi` *declaration* (the shape this
 * package's codegen pipeline emits); `HttpApiClient.make` turns it into the
 * request-building, schema-decoding client the provider code calls. The base
 * URL is baked in here so no caller has to know it.
 *
 * Like `packages/dns-ovh/src/client/dns.ts`, this deliberately does NOT wire
 * `hcloudHttpClientLive` (Bearer token + 429/5xx retry) itself — composition
 * happens at the CLI wiring layer, so the client only ever asks for a plain
 * `HttpClient`.
 */
import type { Effect } from "effect"
import { HttpApiClient } from "effect/unstable/httpapi"
import { HCLOUD_API_BASE_URL } from "../auth/client.ts"
import { Hcloud } from "../generated/hcloud.ts"

export const makeHcloudClient = HttpApiClient.make(Hcloud, { baseUrl: HCLOUD_API_BASE_URL })

export type HcloudClient = Effect.Success<typeof makeHcloudClient>
