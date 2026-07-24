import { Effect, Schema } from "effect"

/** Fixture-replay helper: decodes a fixture through a generated schema, offline (no network). */
export const decodeFixture = <T, E>(args: { readonly schema: Schema.Codec<T, E>; readonly fixture: unknown }): T =>
  Effect.runSync(Schema.decodeUnknownEffect(args.schema)(args.fixture))

/** Asserts a fixture fails to decode (the schema's error-mapping guard: malformed data never silently passes). */
export const decodeFixtureFails = <T, E>(args: { readonly schema: Schema.Codec<T, E>; readonly fixture: unknown }): unknown =>
  Effect.runSync(Effect.flip(Schema.decodeUnknownEffect(args.schema)(args.fixture)))
