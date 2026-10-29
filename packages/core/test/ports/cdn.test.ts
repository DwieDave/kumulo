import { describe, expect, it } from "@effect/vitest"
import { Effect, Redacted } from "effect"
import { cdnNoopLive } from "../../src/cdn-noop/index.ts"
import { CdnProvider } from "../../src/ports/cdn-provider.ts"
import type { S3Credentials } from "../../src/domain/types.ts"

describe("cdnNoopLive", () => {
  it.effect("ensureEdge echoes the spec and writes nothing", () =>
    Effect.gen(function*() {
      const cdn = yield* CdnProvider

      const info = yield* cdn.ensureEdge({
        name: "stagingeu",
        tier: "standard",
        originUrl: "https://203.0.113.10",
        verifyOriginTls: false,
        websockets: true,
        cache: "smart",
        hostnames: ["app.example.com"],
        forceSsl: true
      })

      expect(info.hostnames).toEqual(["app.example.com"])
      yield* cdn.ensureCertificates({ ref: info.ref, hostnames: info.hostnames })
      yield* cdn.ensureSecurity({ ref: info.ref, policy: { plan: "basic", rateLimits: [], accessLists: [] } })
      yield* cdn.deleteEdge(info.ref)
    }).pipe(Effect.provide(cdnNoopLive)))

  it.effect("describeEdge fails with ResourceNotFound", () =>
    Effect.gen(function*() {
      const cdn = yield* CdnProvider
      const error = yield* Effect.flip(cdn.describeEdge({ id: "x", name: "x" }))
      expect(error._tag).toBe("ResourceNotFound")
    }).pipe(Effect.provide(cdnNoopLive)))
})

describe("S3Credentials", () => {
  it("accepts credentials without per-bucket entries", () => {
    const creds: S3Credentials = {
      user: "u",
      accessKey: Redacted.make("a"),
      secretKey: Redacted.make("s"),
      buckets: []
    }

    expect(creds.bucketCredentials).toBeUndefined()
  })

  it("carries per-bucket credentials", () => {
    const creds: S3Credentials = {
      user: "u",
      accessKey: Redacted.make("a"),
      secretKey: Redacted.make("s"),
      buckets: [],
      bucketCredentials: [{ name: "b", region: "de", endpoint: "e", accessKey: Redacted.make("b"), secretKey: Redacted.make("p") }]
    }

    expect(Redacted.value(creds.bucketCredentials?.[0]?.secretKey ?? Redacted.make(""))).toBe("p")
  })
})
