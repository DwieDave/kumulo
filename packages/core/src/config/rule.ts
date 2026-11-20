import { Schema, type SchemaAST } from "effect"

// One cross-field rule, defined once: the decode-time filter and its JSON Schema
// rendering (draft 2020-12 fragments for the document's top-level allOf) live together.
// Rules that JSON Schema cannot express pass an empty `jsonSchema`.
export interface CrossFieldRule<Config> {
  readonly filter: SchemaAST.Filter<Config>
  readonly jsonSchema: ReadonlyArray<Schema.JsonObject>
}

export const crossFieldRule = <Config>(options: {
  readonly check: (config: Config) => string | undefined
  readonly jsonSchema: ReadonlyArray<Schema.JsonObject>
}): CrossFieldRule<Config> => ({
  filter: Schema.makeFilter(options.check),
  jsonSchema: options.jsonSchema
})
