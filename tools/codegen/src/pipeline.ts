import { Effect } from "effect"
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

// kumulo: applyPatches returns `unknown` (see patch.ts) — a patched spec is still an
// OpenAPISpec at runtime by construction (patches only add/replace/remove fields within
// it); narrow it back with a proper runtime type guard rather than a type assertion.
const _isOpenApiSpec = (value: unknown): value is OpenAPISpec =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  "openapi" in value &&
  "paths" in value

/** Runs allowlist filter -> patch apply -> generator invocation, in that order (design §4.2/§4.3). */
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
