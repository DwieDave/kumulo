import { Effect, Layer } from "effect"
import { CdnProvider } from "../ports/cdn-provider.ts"
import { ResourceNotFound } from "../errors/tagged.ts"

export const cdnNoop = CdnProvider.of({
  ensureEdge: (spec) =>
    Effect.succeed({
      ref: { id: spec.name, name: spec.name },
      originUrl: spec.originUrl,
      verifyOriginTls: spec.verifyOriginTls,
      websockets: spec.websockets,
      cache: spec.cache,
      tier: spec.tier,
      forceSsl: spec.forceSsl,
      defaultHostname: "",
      hostnames: spec.hostnames,
      certificatesIssued: []
    }),
  ensureCertificates: () => Effect.void,
  ensureSecurity: () => Effect.void,
  describeEdge: (ref) => Effect.fail(new ResourceNotFound({ kind: "edge", ref: ref.name })),
  deleteEdge: () => Effect.void
})

export const cdnNoopLive = Layer.succeed(CdnProvider, cdnNoop)
