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

/** Stage 3: invoke `@effect/openapi-generator` against the filtered+patched spec. */
export const generateSource = (args: {
  readonly spec: OpenAPISpec
  readonly options: GenerateOptions
}): Effect.Effect<GenerateResult> =>
  Effect.gen(function* () {
    const generator = yield* OpenApiGenerator.OpenApiGenerator
    const warnings: Array<OpenApiGenerator.OpenApiGeneratorWarning> = []
    const source = yield* generator.generate(args.spec, {
      ...args.options,
      onWarning: (warning) => warnings.push(warning)
    })
    return { source, warnings }
  }).pipe(Effect.provide(OpenApiGenerator.layerTransformerSchema))
