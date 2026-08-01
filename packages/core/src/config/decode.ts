import { Effect, Schema, SchemaIssue } from "effect"
import type { SchemaError } from "effect/Schema"
import { ConfigInvalid } from "../errors/tagged.ts"

const formatIssue = SchemaIssue.makeFormatterStandardSchemaV1()

const _toPropertyKey = (segment: PropertyKey | { readonly key: PropertyKey }): PropertyKey =>
  typeof segment === "object" ? segment.key : segment

const _toConfigInvalid = (error: SchemaError): ConfigInvalid =>
  new ConfigInvalid({
    issues: formatIssue(error.issue).issues.map((issue) => ({
      path: (issue.path ?? []).map(_toPropertyKey),
      message: issue.message
    }))
  })

// kumulo: the ClusterConfig union is assembled in @kumulo/cli (core cannot
// depend on the distro packages that own the variants) — so the codec is
// parameterized by the schema instead of closing over a union defined here.
export const decodeConfigWith = <S extends Schema.Top>(schema: S) => (input: unknown): Effect.Effect<S["Type"], ConfigInvalid, S["DecodingServices"]> =>
  Schema.decodeUnknownEffect(schema)(input, { errors: "all" }).pipe(
    Effect.mapError(_toConfigInvalid)
  )

export const encodeConfigWith = <S extends Schema.Top>(schema: S) => (config: S["Type"]): Effect.Effect<unknown, ConfigInvalid, S["EncodingServices"]> =>
  Schema.encodeEffect(schema)(config).pipe(
    Effect.mapError(_toConfigInvalid)
  )
