import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import type { SchemaError } from "effect/Schema"
import * as Schema from "effect/Schema"
import type * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientError from "effect/unstable/http/HttpClientError"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
// non-recursive definitions
export type Domain_zone_RecordTypeEnum = "A" | "AAAA" | "CAA" | "CNAME" | "DKIM" | "DMARC" | "DNAME" | "HTTPS" | "LOC" | "MX" | "NAPTR" | "NS" | "PTR" | "RP" | "SPF" | "SRV" | "SSHFP" | "SVCB" | "TLSA" | "TXT"
export const Domain_zone_RecordTypeEnum = Schema.Literals(["A", "AAAA", "CAA", "CNAME", "DKIM", "DMARC", "DNAME", "HTTPS", "LOC", "MX", "NAPTR", "NS", "PTR", "RP", "SPF", "SRV", "SSHFP", "SVCB", "TLSA", "TXT"])
export type Domain_zone_RecordUpdate = { readonly "subDomain"?: string | null, readonly "target"?: string, readonly "ttl"?: number | null }
export const Domain_zone_RecordUpdate = Schema.Struct({ "subDomain": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null])), "target": Schema.optionalKey(Schema.String), "ttl": Schema.optionalKey(Schema.Union([Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt()), Schema.Null])) })
export type Domain_zone_Record = { readonly "fieldType"?: Domain_zone_RecordTypeEnum, readonly "id"?: number, readonly "subDomain"?: string | null, readonly "target"?: string, readonly "ttl"?: number | null, readonly "zone"?: string }
export const Domain_zone_Record = Schema.Struct({ "fieldType": Schema.optionalKey(Domain_zone_RecordTypeEnum), "id": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt())), "subDomain": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null])), "target": Schema.optionalKey(Schema.String), "ttl": Schema.optionalKey(Schema.Union([Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt()), Schema.Null])), "zone": Schema.optionalKey(Schema.String) })
export type Domain_zone_RecordCreate = { readonly "fieldType": Domain_zone_RecordTypeEnum, readonly "id"?: number, readonly "subDomain"?: string | null, readonly "target": string, readonly "ttl"?: number, readonly "zone"?: string }
export const Domain_zone_RecordCreate = Schema.Struct({ "fieldType": Domain_zone_RecordTypeEnum, "id": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt())), "subDomain": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null])), "target": Schema.String, "ttl": Schema.optionalKey(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt())), "zone": Schema.optionalKey(Schema.String) })
// schemas
export type GetRecordsParams = { readonly "fieldType"?: Domain_zone_RecordTypeEnum, readonly "subDomain"?: string }
export const GetRecordsParams = Schema.Struct({ "fieldType": Schema.optionalKey(Domain_zone_RecordTypeEnum), "subDomain": Schema.optionalKey(Schema.String) })
export type GetRecords200 = ReadonlyArray<number>
export const GetRecords200 = Schema.Array(Schema.Number.annotate({ "format": "int64" }).check(Schema.isInt()))
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
export type WithOptionalResponse<A, Config extends OperationConfig> = Config extends {
  readonly includeResponse: true
} ? [A, HttpClientResponse.HttpClientResponse] : A

export const make = (
  httpClient: HttpClient.HttpClient,
  options: {
    readonly transformClient?: ((client: HttpClient.HttpClient) => Effect.Effect<HttpClient.HttpClient>) | undefined
  } = {}
): Dns => {
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
  ): (request: HttpClientRequest.HttpClientRequest) => Effect.Effect<any, any> => {
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
  const decodeSuccess =
    <Schema extends Schema.Constraint>(schema: Schema) =>
    (response: HttpClientResponse.HttpClientResponse) =>
      HttpClientResponse.schemaBodyJson(schema)(response)
  const decodeError =
    <const Tag extends string, Schema extends Schema.Constraint>(tag: Tag, schema: Schema) =>
    (response: HttpClientResponse.HttpClientResponse) =>
      Effect.flatMap(
        HttpClientResponse.schemaBodyJson(schema)(response),
        (cause) => Effect.fail(DnsError(tag, cause, response)),
      )
  return {
    httpClient,
    "getRecords": (zoneName, options) => HttpClientRequest.get(`/domain/zone/${zoneName}/record`).pipe(
    HttpClientRequest.setUrlParams({ "fieldType": options?.params?.["fieldType"] as any, "subDomain": options?.params?.["subDomain"] as any }),
    withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(GetRecords200),
      orElse: unexpectedStatus
    }))
  ),
    "createRecord": (zoneName, options) => HttpClientRequest.post(`/domain/zone/${zoneName}/record`).pipe(
    HttpClientRequest.bodyJsonUnsafe(options.payload),
    withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(CreateRecord200),
      orElse: unexpectedStatus
    }))
  ),
    "getRecord": (zoneName, id, options) => HttpClientRequest.get(`/domain/zone/${zoneName}/record/${id}`).pipe(
    withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(GetRecord200),
      orElse: unexpectedStatus
    }))
  ),
    "editRecord": (zoneName, id, options) => HttpClientRequest.put(`/domain/zone/${zoneName}/record/${id}`).pipe(
    HttpClientRequest.bodyJsonUnsafe(options.payload),
    withResponse(options.config)(HttpClientResponse.matchStatus({
      "200": () => Effect.void,
      orElse: unexpectedStatus
    }))
  ),
    "deleteRecord": (zoneName, id, options) => HttpClientRequest.delete(`/domain/zone/${zoneName}/record/${id}`).pipe(
    withResponse(options?.config)(HttpClientResponse.matchStatus({
      "200": () => Effect.void,
      orElse: unexpectedStatus
    }))
  ),
    "refreshZone": (zoneName, options) => HttpClientRequest.post(`/domain/zone/${zoneName}/refresh`).pipe(
    withResponse(options?.config)(HttpClientResponse.matchStatus({
      "200": () => Effect.void,
      orElse: unexpectedStatus
    }))
  )
  }
}

export interface Dns {
  readonly httpClient: HttpClient.HttpClient
  /**
* List record
*/
readonly "getRecords": <Config extends OperationConfig>(zoneName: string, options: { readonly params?: typeof GetRecordsParams.Encoded | undefined; readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<typeof GetRecords200.Type, Config>, HttpClientError.HttpClientError | SchemaError>
  /**
* Create a new record (Don't forget to refresh the zone)
*/
readonly "createRecord": <Config extends OperationConfig>(zoneName: string, options: { readonly payload: typeof CreateRecordRequestJson.Encoded; readonly config?: Config | undefined }) => Effect.Effect<WithOptionalResponse<typeof CreateRecord200.Type, Config>, HttpClientError.HttpClientError | SchemaError>
  /**
* Get record object properties
*/
readonly "getRecord": <Config extends OperationConfig>(zoneName: string, id: string, options: { readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<typeof GetRecord200.Type, Config>, HttpClientError.HttpClientError | SchemaError>
  /**
* Alter record object properties (Don't forget to refresh the zone)
*/
readonly "editRecord": <Config extends OperationConfig>(zoneName: string, id: string, options: { readonly payload: typeof EditRecordRequestJson.Encoded; readonly config?: Config | undefined }) => Effect.Effect<WithOptionalResponse<void, Config>, HttpClientError.HttpClientError | SchemaError>
  /**
* Delete record object (Don't forget to refresh the zone)
*/
readonly "deleteRecord": <Config extends OperationConfig>(zoneName: string, id: string, options: { readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<void, Config>, HttpClientError.HttpClientError | SchemaError>
  /**
* Refresh a DNS zone
*/
readonly "refreshZone": <Config extends OperationConfig>(zoneName: string, options: { readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<void, Config>, HttpClientError.HttpClientError | SchemaError>
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