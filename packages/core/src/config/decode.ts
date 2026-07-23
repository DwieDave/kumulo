import { Effect, Schema, SchemaIssue } from "effect"
import type { SchemaError } from "effect/Schema"
import { ConfigInvalid } from "../errors/tagged.ts"
import { ClusterConfig, type ClusterConfig as ClusterConfigType } from "./schema.ts"

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

export const decodeConfig = (input: unknown): Effect.Effect<ClusterConfigType, ConfigInvalid> =>
  Schema.decodeUnknownEffect(ClusterConfig)(input, { errors: "all" }).pipe(
    Effect.mapError(_toConfigInvalid)
  )

export const encodeConfig = (config: ClusterConfigType): Effect.Effect<unknown, ConfigInvalid> =>
  Schema.encodeEffect(ClusterConfig)(config).pipe(
    Effect.mapError(_toConfigInvalid)
  )
