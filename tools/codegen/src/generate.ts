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

// kumulo: WHY close free-form additionalProperties — only where it breaks compilation.
// A schema with BOTH declared `properties` AND a free-form `additionalProperties`
// (OpenStack vendor extensions: Glance image extra-properties, Nova scheduler_hints, ...)
// generates `{ readonly "a"?: number, readonly [x: string]: string }`, which fails to
// compile (TS2411: optional key vs. index signature). Those get closed; unknown/extra
// fields are handled leniently at the transport layer anyway.
// A PURE free-form map (`additionalProperties` with no declared sibling properties —
// hcloud `labels`, Nova `metadata`, MKS `labels`/`annotations`, OVH storage `tags`) has no
// conflict and MUST stay open, so it generates a real `Schema.Record`. Closing it produced
// `Schema.Struct({})`, which only round-tripped by accident (unknown-key preservation) and
// silently dropped labels — orphaning billable resources and breaking drift detection.
const _hasDeclaredProperties = (entries: ReadonlyArray<readonly [string, unknown]>): boolean =>
  entries.some(([key, nested]) =>
    key === "properties" && typeof nested === "object" && nested !== null && Object.keys(nested).length > 0
  )

// kumulo: descriptions are pure prose — Schema annotations for them cost bytes and buy no
// validation, so they're stripped; `format`/`pattern`/bounds/`enum`/`title` are kept.
// `nameMap` guards the one place `description` is a KEY rather than an annotation: a
// `properties`/`patternProperties` map may legitimately declare a field called
// "description" (OVH storage credentials do).
const _nameMapKeys = new Set(["properties", "patternProperties"])

// kumulo: OpenStack writes "an IPv4 or IPv6 string" as `type: string` + `oneOf: [{format:
// ipv4}, {format: ipv6}]` — branches that carry NO type, only an unvalidated `format`. The
// generator turns that into a oneOf union of two identical `Schema.String`s, which can
// never match exactly one branch, so every real address fails to decode. The branches add
// no constraint, so drop the `oneOf` and keep the parent `type: string`.
const _isFormatOnlyBranch = (branch: unknown): boolean =>
  typeof branch === "object" && branch !== null && !Array.isArray(branch) &&
  Object.keys(branch).every((key) => key === "format" || key === "description")

const _isUnvalidatedFormatUnion = (key: string, nested: unknown): boolean =>
  key === "oneOf" && Array.isArray(nested) && nested.length > 0 && nested.every(_isFormatOnlyBranch)

// kumulo: effect's isPattern reviver rejects any pattern where `new RegExp(p).source !== p`
// (JS canonicalizes, e.g. unescaped `/` becomes `\/`); OpenStack specs write unescaped
// slashes in `pattern` values AND `patternProperties` keys, which crashed generation.
// Canonicalize through RegExp before handing the spec to the generator.
const _canonicalPattern = (pattern: string): string => {
  try {
    return new RegExp(pattern).source
  } catch {
    return pattern
  }
}

const _rewrite = (value: unknown, nameMap: boolean): unknown => {
  if (Array.isArray(value)) return value.map((item) => _rewrite(item, false))
  if (typeof value !== "object" || value === null) return value
  const entries = Object.entries(value)
  const close = !nameMap && _hasDeclaredProperties(entries)
  const out: Record<string, unknown> = {}
  for (const [key, nested] of entries) {
    if (!nameMap && key === "description") continue
    if (!nameMap && _isUnvalidatedFormatUnion(key, nested)) continue
    if (!nameMap && key === "pattern" && typeof nested === "string") {
      out[key] = _canonicalPattern(nested)
      continue
    }
    const rewritten = _rewrite(nested, !nameMap && _nameMapKeys.has(key))
    out[key] = key === "additionalProperties" && nested !== false && close ? false : rewritten
    if (!nameMap && key === "patternProperties" && typeof rewritten === "object" && rewritten !== null) {
      out[key] = Object.fromEntries(
        Object.entries(rewritten).map(([pattern, schema]) => [_canonicalPattern(pattern), schema])
      )
    }
  }
  return out
}

const _closeConflictingAdditionalProperties = (value: unknown): unknown => _rewrite(value, false)

/** Stage 3: invoke `@effect/openapi-generator` against the filtered+patched spec. */
export const generateSource = (args: {
  readonly spec: OpenAPISpec
  readonly options: GenerateOptions
}): Effect.Effect<GenerateResult> =>
  Effect.gen(function* () {
    const generator = yield* OpenApiGenerator.OpenApiGenerator
    const warnings: Array<OpenApiGenerator.OpenApiGeneratorWarning> = []
    // kumulo: WHY JSON.parse(JSON.stringify(...)) — `_closeConflictingAdditionalProperties`
    // returns `unknown` by construction (see its own comment); this gives a genuine `any`,
    // assignable to `OpenAPISpec` without a type assertion (same pattern as patch.ts's
    // `applyPatches`).
    const spec: OpenAPISpec = JSON.parse(JSON.stringify(_closeConflictingAdditionalProperties(args.spec)))
    const source = yield* generator.generate(spec, {
      ...args.options,
      onWarning: (warning) => warnings.push(warning)
    })
    return { source, warnings }
  }).pipe(Effect.provide(OpenApiGenerator.layerTransformerSchema))
