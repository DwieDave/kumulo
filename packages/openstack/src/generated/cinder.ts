import * as Schema from "effect/Schema"
import { Multipart } from "effect/unstable/http"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSchema, HttpApiSecurity, OpenApi } from "effect/unstable/httpapi"
// non-recursive definitions
export type TypesListResponse = { readonly "volume_types"?: ReadonlyArray<{ readonly "description"?: string, readonly "extra_specs"?: { readonly [x: string]: string }, readonly "id"?: string, readonly "is_public"?: boolean, readonly "name"?: string, readonly "os-volume-type-access:is_public"?: boolean, readonly "qos_specs_id"?: string }> }
export const TypesListResponse = Schema.Struct({ "volume_types": Schema.optionalKey(Schema.Array(Schema.Struct({ "description": Schema.optionalKey(Schema.String.annotate({ "description": "The volume type description." })), "extra_specs": Schema.optionalKey(Schema.Record(Schema.String.check(Schema.isPattern(new RegExp("^[a-zA-Z0-9-_:.]{1,255}$"))), Schema.Union([Schema.String.check(Schema.isMinLength(0)).check(Schema.isMaxLength(255))])).annotate({ "description": "A key and value pair that contains additional\nspecifications that are associated with the volume type. Examples\ninclude capabilities, capacity, compression, and so on, depending\non the storage driver in use." })), "id": Schema.optionalKey(Schema.String.annotate({ "description": "The UUID of the volume type.", "format": "uuid" })), "is_public": Schema.optionalKey(Schema.Boolean.annotate({ "description": "Whether the volume type is publicly visible." })), "name": Schema.optionalKey(Schema.String.annotate({ "description": "The name of the volume type." })), "os-volume-type-access:is_public": Schema.optionalKey(Schema.Boolean.annotate({ "description": "Whether the volume type is publicly visible." })), "qos_specs_id": Schema.optionalKey(Schema.String.annotate({ "description": "The QoS specifications ID.", "format": "uuid" })) }).annotate({ "description": "A `volume_type` object." })).annotate({ "description": "The list of volume types. In an environment with\nmultiple-storage back ends, the scheduler determines where to send\nthe volume based on the volume type. For information about how to\nuse volume types to create multiple- storage back ends, see\n[Configure multiple-storage back ends](https://docs.openstack.org/cinder/latest/admin/blockstorage-multi-backend.html)." })) })
export type __HttpApiMultipartSingleFile = Multipart.PersistedFile
export const __HttpApiMultipartSingleFile = Multipart.SingleFileSchema
// schemas
export type TypesGet200 = TypesListResponse
export const TypesGet200 = TypesListResponse

export const ApiKeyAuthSecurity = HttpApiSecurity.apiKey({ key: "X-Auth-Token", in: "header" })

export class ApiKeyAuthSecurityMiddleware extends HttpApiMiddleware.Service<ApiKeyAuthSecurityMiddleware>()("ApiKeyAuth security", { security: { "ApiKeyAuth": ApiKeyAuthSecurity } }) {}

class TypesGroup extends HttpApiGroup.make("types")
  .add(HttpApiEndpoint.get("typesGet", "/v3/types", { success: TypesGet200, error: HttpApiSchema.Empty(404) })
      .middleware(ApiKeyAuthSecurityMiddleware)
      .annotate(OpenApi.Identifier, "types:get")
      .annotate(OpenApi.Description, "Returns the list of volume types."))
  .annotate(OpenApi.Description, "To create an environment with multiple-storage back ends, you must specify a volume type. The API spawns Block Storage volume back ends as children to cinder-volume, and keys them from a unique queue. The API names the back ends cinder-volume.HOST.BACKEND. For example, cinder-volume.ubuntu.lvmdriver. When you create a volume, the scheduler chooses an appropriate back end for the volume type to handle the request.") {}

export class Cinder extends HttpApi.make("Cinder")
  .annotate(OpenApi.Title, "OpenStack Block Storage API")
  .annotate(OpenApi.Version, "3.70")
  .annotate(OpenApi.Description, "Note")
  .add(TypesGroup) {}