import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import type { SchemaError } from "effect/Schema"
import * as Schema from "effect/Schema"
import type * as HttpClient from "effect/http/HttpClient"
import * as HttpClientError from "effect/http/HttpClientError"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
// non-recursive definitions
export type Domain_zone_RecordTypeEnum = "A" | "AAAA" | "CAA" | "CNAME" | "DKIM" | "DMARC" | "DNAME" | "HTTPS" | "LOC" | "MX" | "NAPTR" | "NS" | "PTR" | "RP" | "SPF" | "SRV" | "SSHFP" | "SVCB" | "TLSA" | "TXT"
export const Domain_zone_RecordTypeEnum = Schema.Literals(["A", "AAAA", "CAA", "CNAME", "DKIM", "DMARC", "DNAME", "HTTPS", "LOC", "MX", "NAPTR", "NS", "PTR", "RP", "SPF", "SRV", "SSHFP", "SVCB", "TLSA", "TXT"]).annotate({ "identifier": "domain.zone.RecordTypeEnum" })
export type Domain_zone_RecordUpdate = { readonly "subDomain"?: string | null, readonly "target"?: string, readonly "ttl"?: number | null }
export const Domain_zone_RecordUpdate = Schema.Struct({ "subDomain": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null])), "target": Schema.optionalKey(Schema.String), "ttl": Schema.optionalKey(Schema.Union([Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt().annotate({ "expected": "an integer" })), Schema.Null])) }).annotate({ "identifier": "domain.zone.RecordUpdate" })
export type Domain_zone_RecordCreate = { readonly "fieldType": Domain_zone_RecordTypeEnum, readonly "id"?: number, readonly "subDomain"?: string | null, readonly "target": string, readonly "ttl"?: number, readonly "zone"?: string }
export const Domain_zone_RecordCreate = Schema.Struct({ "fieldType": Domain_zone_RecordTypeEnum, "id": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt().annotate({ "expected": "an integer" }))), "subDomain": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null])), "target": Schema.String, "ttl": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt().annotate({ "expected": "an integer" }))), "zone": Schema.optionalKey(Schema.String) }).annotate({ "identifier": "domain.zone.RecordCreate" })
export type Domain_zone_Record = { readonly "fieldType"?: Domain_zone_RecordTypeEnum, readonly "id"?: number, readonly "subDomain"?: string | null, readonly "target"?: string, readonly "ttl"?: number | null, readonly "zone"?: string }
export const Domain_zone_Record = Schema.Struct({ "fieldType": Schema.optionalKey(Domain_zone_RecordTypeEnum), "id": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt().annotate({ "expected": "an integer" }))), "subDomain": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null])), "target": Schema.optionalKey(Schema.String), "ttl": Schema.optionalKey(Schema.Union([Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt().annotate({ "expected": "an integer" })), Schema.Null])), "zone": Schema.optionalKey(Schema.String) }).annotate({ "identifier": "domain.zone.Record" })
// schemas
export type GetRecordsParams = { readonly "fieldType"?: Domain_zone_RecordTypeEnum, readonly "subDomain"?: string }
export const GetRecordsParams = Schema.Struct({ "fieldType": Schema.optionalKey(Domain_zone_RecordTypeEnum), "subDomain": Schema.optionalKey(Schema.String) })
export type GetRecords200 = ReadonlyArray<number>
export const GetRecords200 = Schema.Array(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt().annotate({ "expected": "an integer" })))
export type CreateRecordRequestJson = Domain_zone_RecordCreate
export const CreateRecordRequestJson = Domain_zone_RecordCreate
export type CreateRecord200 = Domain_zone_Record
export const CreateRecord200 = Domain_zone_Record
export type GetRecord200 = Domain_zone_Record
export const GetRecord200 = Domain_zone_Record
export type EditRecordRequestJson = Domain_zone_RecordUpdate
export const EditRecordRequestJson = Domain_zone_RecordUpdate

export interface OperationConfig {
  /**
   * Whether or not the response should be included in the value returned from
   * an operation.
   *
   * If set to `true`, a tuple of `[A, HttpClientResponse]` will be returned,
   * where `A` is the success type of the operation.
   *
   * If set to `false`, only the success type of the operation will be returned.
   */
  readonly includeResponse?: boolean | undefined
}

/**
 * A utility type which optionally includes the response in the return result
 * of an operation based upon the value of the `includeResponse` configuration
 * option.
 */
export type WithOptionalResponse<A, Config extends OperationConfig | undefined> = Config extends {
  readonly includeResponse: true
} ? [A, HttpClientResponse.HttpClientResponse]
  : Config extends { readonly includeResponse?: false | undefined } | undefined ? A
  : A | [A, HttpClientResponse.HttpClientResponse]

export const make = <E, R>(
  httpClient: HttpClient.HttpClient.With<E, R>,
  options: {
    readonly transformClient?: ((client: HttpClient.HttpClient.With<E, R>) => Effect.Effect<HttpClient.HttpClient.With<E, R>>) | undefined
  } = {}
): Dns<E, R> => {
  const unexpectedStatus = (response: HttpClientResponse.HttpClientResponse) =>
    Effect.flatMap(
      Effect.orElseSucceed(response.json, () => "Unexpected status code"),
      (description) =>
        Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.StatusCodeError({
              request: response.request,
              response,
              description: typeof description === "string" ? description : JSON.stringify(description),
            }),
          }),
        ),
    )
  const withResponse = <Config extends OperationConfig>(config: Config | undefined) => (
    f: (response: HttpClientResponse.HttpClientResponse) => Effect.Effect<any, any>,
  ): (request: HttpClientRequest.HttpClientRequest) => Effect.Effect<any, any, R> => {
    const withOptionalResponse = (
      config?.includeResponse
        ? (response: HttpClientResponse.HttpClientResponse) => Effect.map(f(response), (a) => [a, response])
        : (response: HttpClientResponse.HttpClientResponse) => f(response)
    ) as any
    return options?.transformClient
      ? (request) =>
          Effect.flatMap(
            Effect.flatMap(options.transformClient!(httpClient), (client) => client.execute(request)),
            withOptionalResponse
          )
      : (request) => Effect.flatMap(httpClient.execute(request), withOptionalResponse)
  }
  const __encodePathParam = encodeURIComponent
  const __makePathRequest = (
    method: (url: string) => HttpClientRequest.HttpClientRequest,
    parameters: ReadonlyArray<string>,
    getPath: () => string,
  ) => Effect.suspend(() => {
    const fail = (description: string, cause?: unknown) => Effect.fail(
      new HttpClientError.HttpClientError({
        reason: new HttpClientError.InvalidUrlError({
          request: method(""),
          cause,
          description,
        }),
      }),
    )
    if (parameters.some((value) => value === "" || /^(?:\.|%2e){1,2}$/i.test(value))) {
      return fail("Path parameters must be non-empty and cannot be dot segments")
    }
    let path: string
    try {
      path = getPath()
    } catch (cause) {
      return fail("Failed to encode path parameter", cause)
    }
    if (path.split("/").some((segment) => /^(?:\.|%2e){1,2}$/i.test(segment))) {
      return fail("Request paths cannot contain dot segments")
    }
    return Effect.succeed(method(path))
  })
  const decodeSuccess =
    <Schema extends Schema.Constraint>(schema: Schema) =>
    (response: HttpClientResponse.HttpClientResponse) =>
      HttpClientResponse.schemaBodyJson(schema)(response)
  return {
    httpClient,
    "getRecords": (zoneName, options: Parameters<Dns["getRecords"]>[1]) => __makePathRequest(HttpClientRequest.get, [zoneName], () => "/domain/zone/" + __encodePathParam(zoneName) + "/record").pipe(
    Effect.flatMap((request) => request.pipe(
      HttpClientRequest.setUrlParams({ "fieldType": options?.params?.["fieldType"] as any, "subDomain": options?.params?.["subDomain"] as any }),
      withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(GetRecords200),
      orElse: unexpectedStatus
    }))
    ))
  ),
    "createRecord": (zoneName, options: Parameters<Dns["createRecord"]>[1]) => __makePathRequest(HttpClientRequest.post, [zoneName], () => "/domain/zone/" + __encodePathParam(zoneName) + "/record").pipe(
    Effect.flatMap((request) => request.pipe(
      HttpClientRequest.bodyJsonUnsafe(options.payload),
      withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(CreateRecord200),
      orElse: unexpectedStatus
    }))
    ))
  ),
    "getRecord": (zoneName, id, options: Parameters<Dns["getRecord"]>[2]) => __makePathRequest(HttpClientRequest.get, [zoneName, id], () => "/domain/zone/" + __encodePathParam(zoneName) + "/record/" + __encodePathParam(id) + "").pipe(
    Effect.flatMap((request) => request.pipe(
      withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(GetRecord200),
      orElse: unexpectedStatus
    }))
    ))
  ),
    "editRecord": (zoneName, id, options: Parameters<Dns["editRecord"]>[2]) => __makePathRequest(HttpClientRequest.put, [zoneName, id], () => "/domain/zone/" + __encodePathParam(zoneName) + "/record/" + __encodePathParam(id) + "").pipe(
    Effect.flatMap((request) => request.pipe(
      HttpClientRequest.bodyJsonUnsafe(options.payload),
      withResponse(options.config)(HttpClientResponse.matchStatus({
      "200": () => Effect.void,
      "204": () => Effect.void,
      orElse: unexpectedStatus
    }))
    ))
  ),
    "deleteRecord": (zoneName, id, options: Parameters<Dns["deleteRecord"]>[2]) => __makePathRequest(HttpClientRequest.delete, [zoneName, id], () => "/domain/zone/" + __encodePathParam(zoneName) + "/record/" + __encodePathParam(id) + "").pipe(
    Effect.flatMap((request) => request.pipe(
      withResponse(options?.config)(HttpClientResponse.matchStatus({
      "200": () => Effect.void,
      "204": () => Effect.void,
      orElse: unexpectedStatus
    }))
    ))
  ),
    "refreshZone": (zoneName, options: Parameters<Dns["refreshZone"]>[1]) => __makePathRequest(HttpClientRequest.post, [zoneName], () => "/domain/zone/" + __encodePathParam(zoneName) + "/refresh").pipe(
    Effect.flatMap((request) => request.pipe(
      withResponse(options?.config)(HttpClientResponse.matchStatus({
      "200": () => Effect.void,
      "204": () => Effect.void,
      orElse: unexpectedStatus
    }))
    ))
  )
  }
}

export interface Dns<E = HttpClientError.HttpClientError, R = never> {
  readonly httpClient: HttpClient.HttpClient.With<E, R>
  readonly "getRecords": {
    <Config extends OperationConfig | undefined = undefined>(zoneName: string, options: { readonly params?: typeof GetRecordsParams.Encoded | undefined; readonly config: Config }): Effect.Effect<WithOptionalResponse<GetRecords200, Config>, E | HttpClientError.HttpClientError | SchemaError, R>;
    <Config extends OperationConfig | undefined = undefined>(zoneName: string, options: { readonly params?: typeof GetRecordsParams.Encoded | undefined; readonly config?: Config | undefined } | undefined): Effect.Effect<WithOptionalResponse<GetRecords200, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError, R>;
  }
  readonly "createRecord": {
    <Config extends OperationConfig | undefined = undefined>(zoneName: string, options: { readonly payload: typeof CreateRecordRequestJson.Encoded; readonly config: Config }): Effect.Effect<WithOptionalResponse<CreateRecord200, Config>, E | HttpClientError.HttpClientError | SchemaError, R>;
    <Config extends OperationConfig | undefined = undefined>(zoneName: string, options: { readonly payload: typeof CreateRecordRequestJson.Encoded; readonly config?: Config | undefined }): Effect.Effect<WithOptionalResponse<CreateRecord200, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError, R>;
  }
  readonly "getRecord": {
    <Config extends OperationConfig | undefined = undefined>(zoneName: string, id: string, options: { readonly config: Config }): Effect.Effect<WithOptionalResponse<GetRecord200, Config>, E | HttpClientError.HttpClientError | SchemaError, R>;
    <Config extends OperationConfig | undefined = undefined>(zoneName: string, id: string, options: { readonly config?: Config | undefined } | undefined): Effect.Effect<WithOptionalResponse<GetRecord200, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError, R>;
  }
  readonly "editRecord": {
    <Config extends OperationConfig | undefined = undefined>(zoneName: string, id: string, options: { readonly payload: typeof EditRecordRequestJson.Encoded; readonly config: Config }): Effect.Effect<WithOptionalResponse<void, Config>, E | HttpClientError.HttpClientError | SchemaError, R>;
    <Config extends OperationConfig | undefined = undefined>(zoneName: string, id: string, options: { readonly payload: typeof EditRecordRequestJson.Encoded; readonly config?: Config | undefined }): Effect.Effect<WithOptionalResponse<void, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError, R>;
  }
  readonly "deleteRecord": {
    <Config extends OperationConfig | undefined = undefined>(zoneName: string, id: string, options: { readonly config: Config }): Effect.Effect<WithOptionalResponse<void, Config>, E | HttpClientError.HttpClientError | SchemaError, R>;
    <Config extends OperationConfig | undefined = undefined>(zoneName: string, id: string, options: { readonly config?: Config | undefined } | undefined): Effect.Effect<WithOptionalResponse<void, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError, R>;
  }
  readonly "refreshZone": {
    <Config extends OperationConfig | undefined = undefined>(zoneName: string, options: { readonly config: Config }): Effect.Effect<WithOptionalResponse<void, Config>, E | HttpClientError.HttpClientError | SchemaError, R>;
    <Config extends OperationConfig | undefined = undefined>(zoneName: string, options: { readonly config?: Config | undefined } | undefined): Effect.Effect<WithOptionalResponse<void, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError, R>;
  }
}

export interface DnsError<Tag extends string, E> {
  readonly _tag: Tag
  readonly request: HttpClientRequest.HttpClientRequest
  readonly response: HttpClientResponse.HttpClientResponse
  readonly cause: E
}

class DnsErrorImpl extends Data.Error<{
  _tag: string
  cause: any
  request: HttpClientRequest.HttpClientRequest
  response: HttpClientResponse.HttpClientResponse
}> {}

export const DnsError = <Tag extends string, E>(
  tag: Tag,
  cause: E,
  response: HttpClientResponse.HttpClientResponse,
): DnsError<Tag, E> =>
  new DnsErrorImpl({
    _tag: tag,
    cause,
    response,
    request: response.request,
  }) as any