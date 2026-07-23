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

/**
 * Synthetic spec with `components.schemas` including both operation-reachable
 * schemas (`Widget`, transitively `WidgetOwner`) and an unreachable one
 * (`Gadget`) — proves `filterAllowlist` prunes schemas along with paths.
 */
export const syntheticSpecWithSchemas: OpenAPISpec = {
  openapi: "3.1.0",
  info: { title: "Synthetic", version: "1.0.0" },
  components: {
    schemas: {
      Widget: {
        type: "object",
        properties: { owner: { $ref: "#/components/schemas/WidgetOwner" } }
      },
      WidgetOwner: { type: "object", properties: { name: { type: "string" } } },
      Gadget: { type: "object", properties: { id: { type: "string" } } }
    },
    securitySchemes: {}
  },
  security: [],
  tags: [],
  paths: {
    "/widgets/{id}": {
      get: {
        operationId: "getWidget",
        parameters: [],
        responses: {
          "200": {
            description: "ok",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Widget" } } }
          }
        },
        tags: ["widgets"],
        security: []
      }
    },
    "/gadgets/{id}": {
      get: {
        operationId: "getGadget",
        parameters: [],
        responses: {
          "200": {
            description: "ok",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Gadget" } } }
          }
        },
        tags: ["gadgets"],
        security: []
      }
    }
  }
}

/**
 * Synthetic spec whose response schema mixes a typed optional property with a
 * free-form string `additionalProperties` — the shape that breaks TS codegen
 * (see `generate.test.ts`'s "closes free-form additionalProperties" case).
 */
export const syntheticSpecWithFreeformAdditionalProperties: OpenAPISpec = {
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
        responses: {
          "200": {
            description: "ok",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { id: { type: "string" } },
                  additionalProperties: { type: "string" }
                }
              }
            }
          }
        },
        tags: ["widgets"],
        security: []
      }
    }
  }
}
