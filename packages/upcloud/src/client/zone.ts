import { Effect } from "effect"
import * as Schema from "effect/Schema"
import type * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import { decodeOn2xx } from "./common.ts"
import type { UpcloudRawError } from "./common.ts"

export const Zone = Schema.Struct({
  id: Schema.String,
  description: Schema.optionalKey(Schema.String),
  public: Schema.optionalKey(Schema.String)
})
export type Zone = typeof Zone.Type

const _ZonesResponse = Schema.Struct({ zones: Schema.Struct({ zone: Schema.Array(Zone) }) })
const _decodeZones = decodeOn2xx(_ZonesResponse)

export interface ZoneClient {
  readonly list: () => Effect.Effect<ReadonlyArray<Zone>, UpcloudRawError>
}

export const makeZoneClient = (httpClient: HttpClient.HttpClient): ZoneClient => ({
  list: () =>
    httpClient.execute(HttpClientRequest.get("/1.3/zone")).pipe(
      Effect.flatMap(_decodeZones),
      Effect.map((response) => response.zones.zone)
    )
})
