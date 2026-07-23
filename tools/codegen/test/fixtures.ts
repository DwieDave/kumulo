import type { OpenAPISpec } from "effect/unstable/httpapi/OpenApi"

/** Tiny synthetic OpenAPI spec, not a real service — proves the pipeline is service-agnostic. */
export const syntheticSpec: OpenAPISpec = {
  openapi: "3.1.0",
  info: { title: "Synthetic", version: "1.0.0" },
  components: { schemas: {}, securitySchemes: {} },
  security: [],
  tags: [],
  paths: {
    "/widgets": {
      get: {
        operationId: "listWidgets",
        parameters: [],
        responses: {},
        tags: ["widgets"],
        security: []
      },
      post: {
        operationId: "createWidget",
        parameters: [],
        responses: {},
        tags: ["widgets"],
        security: []
      }
    },
    "/widgets/{id}": {
      delete: {
        operationId: "deleteWidget",
        parameters: [],
        responses: {},
        tags: ["widgets"],
        security: []
      }
    }
  }
}
