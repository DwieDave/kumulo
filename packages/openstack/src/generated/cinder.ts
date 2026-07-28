import * as Schema from "effect/Schema"
import { Multipart } from "effect/unstable/http"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSchema, HttpApiSecurity, OpenApi } from "effect/unstable/httpapi"
// non-recursive definitions
export type TypesListResponse = { readonly "volume_types"?: ReadonlyArray<{ readonly "description"?: string, readonly "extra_specs"?: { readonly [x: string]: string | null }, readonly "id"?: string, readonly "is_public"?: boolean, readonly "name"?: string, readonly "os-volume-type-access:is_public"?: boolean, readonly "qos_specs_id"?: string }> }
export const TypesListResponse = Schema.Struct({ "volume_types": Schema.optionalKey(Schema.Array(Schema.Struct({ "description": Schema.optionalKey(Schema.String), "extra_specs": Schema.optionalKey(Schema.Record(Schema.String.check(Schema.isPattern(new RegExp("^[a-zA-Z0-9-_:.]{1,255}$")).annotate({ "expected": "a string matching the RegExp ^[a-zA-Z0-9-_:.]{1,255}$" })), Schema.Union([Schema.String.check(Schema.isMinLength(0).annotate({ "expected": "a value with a length of at least 0" })).check(Schema.isMaxLength(255).annotate({ "expected": "a value with a length of at most 255" })), Schema.Null]))), "id": Schema.optionalKey(Schema.String.annotate({ "format": "uuid" })), "is_public": Schema.optionalKey(Schema.Boolean), "name": Schema.optionalKey(Schema.String), "os-volume-type-access:is_public": Schema.optionalKey(Schema.Boolean), "qos_specs_id": Schema.optionalKey(Schema.String.annotate({ "format": "uuid" })) }))) }).annotate({ "identifier": "TypesListResponse" })
export type __HttpApiMultipartSingleFile = Multipart.PersistedFile
export const __HttpApiMultipartSingleFile = Multipart.SingleFileSchema
export type __HttpApiMultipartFiles = ReadonlyArray<Multipart.PersistedFile>
export const __HttpApiMultipartFiles = Multipart.FilesSchema
// schemas
export type TypesGet200 = TypesListResponse
export const TypesGet200 = TypesListResponse

export const ApiKeyAuthSecurity = HttpApiSecurity.apiKey({ key: "X-Auth-Token", in: "header" })

export class ApiKeyAuthSecurityMiddleware extends HttpApiMiddleware.Service<ApiKeyAuthSecurityMiddleware>()("ApiKeyAuth security", { security: { "ApiKeyAuth": ApiKeyAuthSecurity } }) {}

class TypesGroup extends HttpApiGroup.make("types")
  .add(HttpApiEndpoint.get("typesGet", "/v3/types", { success: TypesGet200, error: HttpApiSchema.Empty(404) })
      .middleware(ApiKeyAuthSecurityMiddleware)
      .annotate(OpenApi.Identifier, "types:get")) {}

export class Cinder extends HttpApi.make("Cinder")
  .annotate(OpenApi.Title, "OpenStack Block Storage API")
  .annotate(OpenApi.Version, "3.70")
  .add(TypesGroup) {}