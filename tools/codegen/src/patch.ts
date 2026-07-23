import type { Effect } from "effect"
import * as OpenApiPatch from "@effect/openapi-generator/OpenApiPatch"

export type { JsonPatchDocument, JsonPatchAggregateError, JsonPatchApplicationError } from "@effect/openapi-generator/OpenApiPatch"

export interface NamedPatch {
  readonly source: string
  readonly patch: OpenApiPatch.JsonPatchDocument
}

/**
 * Stage 2: apply RFC 6902 patches in order. Delegates to
 * `@effect/openapi-generator`'s `applyPatches`, which already fails loudly
 * with every unapplicable operation (path/reason) aggregated together.
 *
 * `document` is typed `unknown` rather than the library's `Schema.Json`:
 * `OpenAPISpec` (and other spec-shaped inputs) is a plain-data interface
 * without an index signature, so it isn't structurally a `Json` — round-trip
 * through JSON to get a genuine JSON value instead of asserting the type.
 */
export const applyPatches = (args: {
  readonly patches: ReadonlyArray<NamedPatch>
  readonly document: unknown
}): Effect.Effect<unknown, OpenApiPatch.JsonPatchAggregateError> => {
  const jsonDocument = JSON.parse(JSON.stringify(args.document))
  return OpenApiPatch.applyPatches(args.patches, jsonDocument)
}
