export const packageName = "ovh2openapi"

export { convert, convertModels, modelToSchema, operationToOpenApi, typeToSchema } from "./convert.ts"
export type { OvhApi, OvhEnumModel, OvhModel, OvhObjectModel, OvhOperation, OvhParameter, OvhSchema } from "./domain.ts"
export { ConversionUnsupported } from "./errors.ts"
export type { OpenApiDocument, OpenApiOperation, OpenApiParameter, OpenApiSchema } from "./openapi.ts"
