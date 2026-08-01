import { ResponseDecodeError } from "@kumulo/core"
import { Effect } from "effect"
import * as Schema from "effect/Schema"

// kumulo: codegen closes free-form additionalProperties, so generated ServerShowResponse has addresses: {} — decode the raw response instead or
// IPs are dropped.
const ServerAddresses = Schema.Struct({
  server: Schema.optionalKey(Schema.Struct({
    addresses: Schema.optionalKey(
      Schema.Record(Schema.String, Schema.Array(Schema.Struct({ addr: Schema.optionalKey(Schema.String) })))
    )
  }))
})

export const decodeServerIp = (body: unknown): Effect.Effect<string, ResponseDecodeError> =>
  Schema.decodeUnknownEffect(ServerAddresses)(body).pipe(
    Effect.mapError((error) => new ResponseDecodeError({ endpoint: "v2.1/servers", issue: error.issue })),
    Effect.map((decoded) => {
      const networks = Object.values(decoded.server?.addresses ?? {})[0]
      return networks?.find((candidate) => candidate.addr !== undefined)?.addr ?? ""
    })
  )
