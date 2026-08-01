import type { SchemaError } from "effect/Schema"
import * as Schema from "effect/Schema"
import * as SchemaGetter from "effect/SchemaGetter"
import * as HttpClientError from "effect/unstable/http/HttpClientError"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { Effect } from "effect"

export const UpcloudLabel = Schema.Struct({ key: Schema.String, value: Schema.String })
export type UpcloudLabel = typeof UpcloudLabel.Type

// classic /1.3 endpoints encode booleans as "yes"/"no" strings; newer endpoints use real booleans — accept both
export const UpcloudBoolean = Schema.Union([Schema.Boolean, Schema.Literals(["yes", "no"])]).pipe(
  Schema.decodeTo(Schema.Boolean, {
    decode: SchemaGetter.transform((value) => value === true || value === "yes"),
    encode: SchemaGetter.transform((value: boolean) => value)
  })
)

export type UpcloudRawError = HttpClientError.HttpClientError | SchemaError

export const isOk = (response: HttpClientResponse.HttpClientResponse): boolean => response.status >= 200 && response.status < 300

const _unexpectedStatus = (
  response: HttpClientResponse.HttpClientResponse
): Effect.Effect<never, HttpClientError.HttpClientError> =>
  Effect.flatMap(
    Effect.orElseSucceed(response.text, () => "unexpected UpCloud API response status"),
    (description) =>
      Effect.fail(
        new HttpClientError.HttpClientError({
          reason: new HttpClientError.StatusCodeError({ request: response.request, response, description })
        })
      )
  )

export const decodeOn2xx = <A, I>(schema: Schema.Codec<A, I>) =>
  (response: HttpClientResponse.HttpClientResponse): Effect.Effect<A, UpcloudRawError> =>
    isOk(response) ? HttpClientResponse.schemaBodyJson(schema)(response) : _unexpectedStatus(response)

export const decodeVoid = (response: HttpClientResponse.HttpClientResponse): Effect.Effect<void, UpcloudRawError> =>
  isOk(response) ? Effect.void : _unexpectedStatus(response)
