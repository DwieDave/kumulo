import { Effect } from "effect"
import type * as HttpClient from "effect/http/HttpClient"
import type * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import type { Schema } from "effect"
import { HttpTransportError } from "@kumulo/core"
import { mapBunnyStatus, parseBunnyErrorBody, toBunnyError } from "../errors.ts"
import type { BunnyError, BunnyErrorBody } from "../errors.ts"

export interface BunnyRequestTarget {
  readonly kind: string
  readonly ref: string
}

export interface BunnyRequester {
  readonly send: (
    input: { readonly request: HttpClientRequest.HttpClientRequest } & BunnyRequestTarget
  ) => Effect.Effect<HttpClientResponse.HttpClientResponse, BunnyError>
  readonly json: <S extends Schema.Constraint & { readonly DecodingServices: never }>(
    input: { readonly request: HttpClientRequest.HttpClientRequest; readonly schema: S } & BunnyRequestTarget
  ) => Effect.Effect<S["Type"], BunnyError>
  readonly empty: (
    input: { readonly request: HttpClientRequest.HttpClientRequest } & BunnyRequestTarget
  ) => Effect.Effect<void, BunnyError>
}

const _isOk = ({ rejectAccepted, status }: { readonly status: number; readonly rejectAccepted: boolean }): boolean =>
  status >= 200 && status < 300 && !(rejectAccepted && status === 202)

export const bunnyRequester = (
  { httpClient, parseBody, rejectAccepted }: {
    readonly httpClient: HttpClient.HttpClient
    readonly parseBody?: (text: string) => BunnyErrorBody | undefined
    readonly rejectAccepted?: boolean
  }
): BunnyRequester => {
  const parse = parseBody ?? parseBunnyErrorBody

  const send: BunnyRequester["send"] = ({ kind, ref, request }) =>
    httpClient.execute(request).pipe(
      Effect.mapError((cause) => toBunnyError({ cause, kind, ref })),
      Effect.flatMap((response) =>
        _isOk({ status: response.status, rejectAccepted: rejectAccepted ?? false })
          ? Effect.succeed(response)
          : response.text.pipe(
            Effect.map((text) =>
              mapBunnyStatus({
                status: response.status,
                body: parse(text),
                kind,
                ref,
                retryAfter: response.headers["retry-after"]
              })
            ),
            Effect.catch((cause) => Effect.succeed<BunnyError>(new HttpTransportError({ cause }))),
            Effect.flatMap(Effect.fail)
          )
      )
    )

  const json: BunnyRequester["json"] = ({ kind, ref, request, schema }) =>
    send({ kind, ref, request }).pipe(
      Effect.flatMap((response) =>
        HttpClientResponse.schemaBodyJson(schema)(response).pipe(Effect.mapError((cause) => toBunnyError({ cause, kind, ref })))
      )
    )

  const empty: BunnyRequester["empty"] = (input) => Effect.asVoid(send(input))

  return { send, json, empty }
}
