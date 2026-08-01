/**
 * Shapes shared across the UKS, node-group and network/router clients
 * (D14 — labels are `[{key, value}]`, not a map, everywhere UpCloud uses
 * them).
 */
import type { SchemaError } from "effect/Schema"
import * as Schema from "effect/Schema"
import * as SchemaGetter from "effect/SchemaGetter"
import * as HttpClientError from "effect/unstable/http/HttpClientError"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { Effect } from "effect"

export const UpcloudLabel = Schema.Struct({ key: Schema.String, value: Schema.String })
export type UpcloudLabel = typeof UpcloudLabel.Type

// kumulo: UpCloud's legacy endpoints encode booleans as "yes"/"no" strings
// (the Go SDK has `upcloud.Boolean` for exactly this; live probe 2026-08-01:
// `encrypted: "no"`). Newer endpoints use real booleans — accept both.
export const UpcloudBoolean = Schema.Union([Schema.Boolean, Schema.Literals(["yes", "no"])]).pipe(
  Schema.decodeTo(Schema.Boolean, {
    decode: SchemaGetter.transform((value) => value === true || value === "yes"),
    encode: SchemaGetter.transform((value: boolean) => value)
  })
)

export type UpcloudRawError = HttpClientError.HttpClientError | SchemaError

// kumulo: plain status-range check instead of `HttpClientResponse.matchStatus`
// — mirrors dns-hetzner's client (its `Unify`-based inference collapses this
// file's precise per-schema error unions down to `unknown`).
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

/** Decodes a 2xx body against `schema`; any other status becomes a decodable `HttpClientError` (R4). */
export const decodeOn2xx = <A, I>(schema: Schema.Codec<A, I>) =>
  (response: HttpClientResponse.HttpClientResponse): Effect.Effect<A, UpcloudRawError> =>
    isOk(response) ? HttpClientResponse.schemaBodyJson(schema)(response) : _unexpectedStatus(response)

/** A 2xx with no body worth decoding (deletes). */
export const decodeVoid = (response: HttpClientResponse.HttpClientResponse): Effect.Effect<void, UpcloudRawError> =>
  isOk(response) ? Effect.void : _unexpectedStatus(response)
