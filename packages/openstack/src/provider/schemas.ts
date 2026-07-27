import { ResponseDecodeError } from "@kumulo/core"
import { Effect } from "effect"
import * as Schema from "effect/Schema"

// kumulo: the ONE response shape the generated clients cannot supply. Nova's
// spec types `server.addresses` as a free-form `additionalProperties` map, and
// the codegen pipeline closes every such map (see `tools/codegen`'s
// `_closeFreeformAdditionalProperties`), so the generated `ServerShowResponse`
// carries `addresses: {}` — the IPs would be dropped on decode. Read them off
// the raw response instead, until codegen keeps typed additionalProperties.
const ServerAddresses = Schema.Struct({
  server: Schema.optionalKey(Schema.Struct({
    addresses: Schema.optionalKey(
      Schema.Record(Schema.String, Schema.Array(Schema.Struct({ addr: Schema.optionalKey(Schema.String) })))
    )
  }))
})

/** First address Nova reports for a server, or `""` when it has none yet. */
export const decodeServerIp = (body: unknown): Effect.Effect<string, ResponseDecodeError> =>
  Schema.decodeUnknownEffect(ServerAddresses)(body).pipe(
    Effect.mapError((error) => new ResponseDecodeError({ endpoint: "v2.1/servers", issue: error.issue })),
    Effect.map((decoded) => {
      const networks = Object.values(decoded.server?.addresses ?? {})[0]
      return networks?.find((candidate) => candidate.addr !== undefined)?.addr ?? ""
    })
  )
