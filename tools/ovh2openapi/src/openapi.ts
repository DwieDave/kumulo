/** Minimal OpenAPI 3.1 document shapes — only the fields this converter emits. */

export type OpenApiSchema =
  | { readonly $ref: string }
  | { readonly type: "string" | "boolean" | "integer" | "number"; readonly format?: string; readonly enum?: readonly string[] }
  | { readonly type: "array"; readonly items: OpenApiSchema }
  | { readonly type: "object"; readonly properties: Record<string, OpenApiSchema>; readonly required?: readonly string[] }
  | { readonly type: "object"; readonly additionalProperties: OpenApiSchema }

export interface OpenApiParameter {
  readonly name: string
  readonly in: "path" | "query"
  readonly required: boolean
  readonly schema: OpenApiSchema
}

export interface OpenApiRequestBody {
  readonly required: boolean
  readonly content: { readonly "application/json": { readonly schema: OpenApiSchema } }
}

export interface OpenApiResponse {
  readonly description: string
  readonly content?: { readonly "application/json": { readonly schema: OpenApiSchema } }
}

export interface OpenApiOperation {
  readonly operationId: string
  readonly description?: string
  readonly parameters?: readonly OpenApiParameter[]
  readonly requestBody?: OpenApiRequestBody
  readonly responses: Record<string, OpenApiResponse>
}

export type OpenApiPathItem = Record<string, OpenApiOperation>

export interface OpenApiDocument {
  readonly openapi: "3.1.0"
  readonly info: { readonly title: string; readonly version: string }
  readonly paths: Record<string, OpenApiPathItem>
  readonly components: { readonly schemas: Record<string, OpenApiSchema> }
}
