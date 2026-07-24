import { Effect, Schema } from "effect"
import type { OpenAPISpec } from "effect/unstable/httpapi/OpenApi"
import { filterAllowlist } from "./allowlist.ts"
import { applyPatches, type NamedPatch } from "./patch.ts"
import { generateSource, type GenerateOptions, type GenerateResult } from "./generate.ts"
import type { AllowlistOperationNotFound } from "./errors.ts"
import type { JsonPatchAggregateError } from "@effect/openapi-generator/OpenApiPatch"

export interface PipelineInput {
  readonly spec: OpenAPISpec
  readonly allowlist: ReadonlyArray<string>
  readonly patches: ReadonlyArray<NamedPatch>
  readonly generate: GenerateOptions
}

// kumulo: WHY not a full schema — applyPatches returns `unknown` (see patch.ts), but a
// patched spec is still an OpenAPISpec at runtime by construction (patches only
// add/replace/remove fields within it). Only the two fields the pipeline actually branches
// on are checked; every other field (paths' contents, components, ...) passes through
// untouched (handled leniently downstream), so this intentionally isn't a full OpenAPISpec
// schema.
const OpenApiSpecShape = Schema.Struct({
  openapi: Schema.Unknown,
  paths: Schema.Unknown
})

// A real runtime type guard (no `as` cast) built from the schema above.
const _matchesOpenApiSpecShape = Schema.is(OpenApiSpecShape)
const _isOpenApiSpec = (value: unknown): value is OpenAPISpec => _matchesOpenApiSpecShape(value)

/** Runs allowlist filter -> patch apply -> generator invocation, in that order. */
export const runPipeline = (
  input: PipelineInput
): Effect.Effect<GenerateResult, AllowlistOperationNotFound | JsonPatchAggregateError> =>
  filterAllowlist({ spec: input.spec, allowlist: input.allowlist }).pipe(
    Effect.flatMap((filtered) => applyPatches({ patches: input.patches, document: filtered })),
    Effect.flatMap((patched) =>
      _isOpenApiSpec(patched)
        ? generateSource({ spec: patched, options: input.generate })
        : Effect.die(new Error("patched document no longer has an OpenAPISpec shape"))
    )
  )
