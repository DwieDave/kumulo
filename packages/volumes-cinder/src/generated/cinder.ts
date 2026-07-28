import * as Schema from "effect/Schema"
import { Multipart } from "effect/unstable/http"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSchema, HttpApiSecurity, OpenApi } from "effect/unstable/httpapi"
// non-recursive definitions
export type VolumesDetailResponse = { readonly "volumes": ReadonlyArray<{ readonly "id": string, readonly "name"?: string, readonly "metadata"?: { readonly "kumulo_cluster"?: string } }>, readonly "volumes_links"?: ReadonlyArray<{ readonly "rel": string, readonly "href": string }> }
export const VolumesDetailResponse = Schema.Struct({ "volumes": Schema.Array(Schema.Struct({ "id": Schema.String.check(Schema.isMinLength(1).annotate({ "expected": "a value with a length of at least 1" })), "name": Schema.optionalKey(Schema.String), "metadata": Schema.optionalKey(Schema.Struct({ "kumulo_cluster": Schema.optionalKey(Schema.String) })) })), "volumes_links": Schema.optionalKey(Schema.Array(Schema.Struct({ "rel": Schema.String, "href": Schema.String }))) }).annotate({ "identifier": "VolumesDetailResponse" })
export type VolumesCreateRequest = { readonly "volume": { readonly "name"?: string, readonly "size": number, readonly "volume_type"?: string, readonly "metadata"?: { readonly [x: string]: string } } }
export const VolumesCreateRequest = Schema.Struct({ "volume": Schema.Struct({ "name": Schema.optionalKey(Schema.String), "size": Schema.Number.check(Schema.isInt().annotate({ "expected": "an integer" })), "volume_type": Schema.optionalKey(Schema.String), "metadata": Schema.optionalKey(Schema.Record(Schema.String, Schema.String)) }) }).annotate({ "identifier": "VolumesCreateRequest" })
export type VolumesCreateResponse = { readonly "volume": { readonly "id": string, readonly "name"?: string, readonly "metadata"?: { readonly "kumulo_cluster"?: string } } }
export const VolumesCreateResponse = Schema.Struct({ "volume": Schema.Struct({ "id": Schema.String.check(Schema.isMinLength(1).annotate({ "expected": "a value with a length of at least 1" })), "name": Schema.optionalKey(Schema.String), "metadata": Schema.optionalKey(Schema.Struct({ "kumulo_cluster": Schema.optionalKey(Schema.String) })) }) }).annotate({ "identifier": "VolumesCreateResponse" })
export type VolumeRecord = { readonly "id": string, readonly "name"?: string, readonly "metadata"?: { readonly "kumulo_cluster"?: string } }
export const VolumeRecord = Schema.Struct({ "id": Schema.String.check(Schema.isMinLength(1).annotate({ "expected": "a value with a length of at least 1" })), "name": Schema.optionalKey(Schema.String), "metadata": Schema.optionalKey(Schema.Struct({ "kumulo_cluster": Schema.optionalKey(Schema.String) })) }).annotate({ "identifier": "VolumeRecord" })
export type __HttpApiMultipartSingleFile = Multipart.PersistedFile
export const __HttpApiMultipartSingleFile = Multipart.SingleFileSchema
export type __HttpApiMultipartFiles = ReadonlyArray<Multipart.PersistedFile>
export const __HttpApiMultipartFiles = Multipart.FilesSchema
// schemas
export type VolumesDetailGetParams = { readonly "limit"?: number, readonly "marker"?: string }
export const VolumesDetailGetParams = Schema.Struct({ "limit": Schema.optionalKey(Schema.Number.check(Schema.isInt().annotate({ "expected": "an integer" }))), "marker": Schema.optionalKey(Schema.String.annotate({ "format": "uuid" })) })
export type VolumesDetailGetQuery = { readonly "limit"?: number, readonly "marker"?: string }
export const VolumesDetailGetQuery = Schema.Struct({ "limit": Schema.optionalKey(Schema.Number.check(Schema.isInt().annotate({ "expected": "an integer" }))), "marker": Schema.optionalKey(Schema.String.annotate({ "format": "uuid" })) })
export type VolumesDetailGet200 = VolumesDetailResponse
export const VolumesDetailGet200 = VolumesDetailResponse
export type VolumesPostRequestJson = VolumesCreateRequest
export const VolumesPostRequestJson = VolumesCreateRequest
export type VolumesPost200 = VolumesCreateResponse
export const VolumesPost200 = VolumesCreateResponse
export type VolumesPost202 = VolumesCreateResponse
export const VolumesPost202 = VolumesCreateResponse
export type VolumesIdDeletePathParams = { readonly "id": string }
export const VolumesIdDeletePathParams = Schema.Struct({ "id": Schema.String })

export const ApiKeyAuthSecurity = HttpApiSecurity.apiKey({ key: "X-Auth-Token", in: "header" })

export class ApiKeyAuthSecurityMiddleware extends HttpApiMiddleware.Service<ApiKeyAuthSecurityMiddleware>()("ApiKeyAuth security", { security: { "ApiKeyAuth": ApiKeyAuthSecurity } }) {}

class VolumesGroup extends HttpApiGroup.make("volumes")
  .add(HttpApiEndpoint.get("volumesDetailGet", "/volumes/detail", { query: VolumesDetailGetQuery, success: VolumesDetailGet200 })
      .middleware(ApiKeyAuthSecurityMiddleware)
      .annotate(OpenApi.Identifier, "volumes/detail:get"), 
    HttpApiEndpoint.post("volumesPost", "/volumes", { payload: VolumesPostRequestJson, success: [VolumesPost200, VolumesPost202.pipe(HttpApiSchema.status(202))] })
      .middleware(ApiKeyAuthSecurityMiddleware)
      .annotate(OpenApi.Identifier, "volumes:post"), 
    HttpApiEndpoint.delete("volumesIdDelete", "/volumes/:id", { params: VolumesIdDeletePathParams, success: [HttpApiSchema.Empty(202), HttpApiSchema.Empty(204)] })
      .middleware(ApiKeyAuthSecurityMiddleware)
      .annotate(OpenApi.Identifier, "volumes/id:delete")) {}

export class Cinder extends HttpApi.make("Cinder")
  .annotate(OpenApi.Title, "OpenStack Block Storage API")
  .annotate(OpenApi.Version, "3.70")
  .add(VolumesGroup) {}