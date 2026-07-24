import { Effect } from "effect"
import type { OpenAPISpec } from "effect/unstable/httpapi/OpenApi"
import * as OpenApiGenerator from "@effect/openapi-generator/OpenApiGenerator"

export type { OpenApiGeneratorFormat, OpenApiGeneratorWarning } from "@effect/openapi-generator/OpenApiGenerator"

export interface GenerateOptions {
  readonly name: string
  readonly format: OpenApiGenerator.OpenApiGeneratorFormat
}

export interface GenerateResult {
  readonly source: string
  readonly warnings: ReadonlyArray<OpenApiGenerator.OpenApiGeneratorWarning>
}

// kumulo: WHY close free-form additionalProperties — OpenStack vendor-extension
// `additionalProperties: { type: ... }` (Glance image extra-properties, Nova
// scheduler_hints, ...) combined with typed optional sibling keys produces TypeScript that
// fails to compile (TS2411: optional key vs. plain index signature). Unknown/extra fields
// are handled leniently at the transport layer, so the generated schema doesn't need to
// type them structurally — close every free-form `additionalProperties` (any value except
// literal `false`) before generating.
const _closeFreeformAdditionalProperties = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(_closeFreeformAdditionalProperties)
  if (typeof value !== "object" || value === null) return value
  const out: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value)) {
    out[key] = key === "additionalProperties" && nested !== false
      ? false
      : _closeFreeformAdditionalProperties(nested)
  }
  return out
}

/** Stage 3: invoke `@effect/openapi-generator` against the filtered+patched spec. */
export const generateSource = (args: {
  readonly spec: OpenAPISpec
  readonly options: GenerateOptions
}): Effect.Effect<GenerateResult> =>
  Effect.gen(function* () {
    const generator = yield* OpenApiGenerator.OpenApiGenerator
    const warnings: Array<OpenApiGenerator.OpenApiGeneratorWarning> = []
    // kumulo: WHY JSON.parse(JSON.stringify(...)) — `_closeFreeformAdditionalProperties`
    // returns `unknown` by construction (see its own comment); this gives a genuine `any`,
    // assignable to `OpenAPISpec` without a type assertion (same pattern as patch.ts's
    // `applyPatches`).
    const spec: OpenAPISpec = JSON.parse(JSON.stringify(_closeFreeformAdditionalProperties(args.spec)))
    const source = yield* generator.generate(spec, {
      ...args.options,
      onWarning: (warning) => warnings.push(warning)
    })
    return { source, warnings }
  }).pipe(Effect.provide(OpenApiGenerator.layerTransformerSchema))
