import { describe, expect, it } from "@effect/vitest"
import { Effect, Predicate, Schema } from "effect"
import { decodeConfig, encodeConfig } from "../../src/cluster-config.ts"
import { validConfig } from "./fixtures.ts"

const _int = (minimum: number, maximum: number) => Schema.Int.check(Schema.isBetween({ minimum, maximum }))
const halfCount = _int(0, 20)
const octet = _int(0, 255)

const cidrParts = Schema.Tuple([octet, octet, octet, octet, _int(0, 32)])

const _cidrOf = ([a, b, c, d, prefix]: readonly [number, number, number, number, number]) =>
  `${a}.${b}.${c}.${d}/${prefix}`

describe("ClusterConfig", () => {
  it.effect("decode → encode → decode round-trips for the design-doc sample", () =>
    Effect.gen(function* () {
      const decoded = yield* decodeConfig(validConfig)
      const encoded = yield* encodeConfig(decoded)
      const roundTripped = yield* decodeConfig(encoded)
      expect(roundTripped).toEqual(decoded)
    }))

  it.prop(
    "decode → encode → decode round-trips for any valid masters.count and network.cidr",
    [halfCount, cidrParts],
    ([half, parts]) =>
      Effect.runSync(
        Effect.gen(function* () {
          const count = half * 2 + 1

          const candidate = {
            ...validConfig,
            masters: { ...validConfig.masters, count },
            network: { ...validConfig.network, cidr: _cidrOf(parts) }
          }

          const decoded = yield* decodeConfig(candidate)
          const encoded = yield* encodeConfig(decoded)
          const roundTripped = yield* decodeConfig(encoded)

          return JSON.stringify(roundTripped) === JSON.stringify(decoded)
        })
      )
  )

  it.prop(
    "rejects any even masters.count with a pathed issue",
    [halfCount],
    ([half]) =>
      Effect.runSync(
        Effect.gen(function* () {
          const count = half * 2
          const candidate = { ...validConfig, masters: { ...validConfig.masters, count } }
          const failure = yield* Effect.flip(decodeConfig(candidate))

          return (
            Predicate.isTagged(failure, "ConfigInvalid") &&
            failure.issues.some((issue) => issue.path.join(".") === "masters.count")
          )
        })
      )
  )

  const nearMissCidr = Schema.Literals([
    "999.0.0.0/99",
    "10.0.0.0/33",
    "256.1.1.1/16",
    "10.0.0/16",
    "10.0.0.0.0/16",
    "10.0.0.0/",
    "10.0.0.0"
  ])

  const wellFormedCidr = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/

  const malformedCidr = Schema.Union([
    nearMissCidr,
    Schema.String.check(Schema.makeFilter((s: string) => !wellFormedCidr.test(s)))
  ])

  it.prop(
    "rejects malformed network.cidr strings with a pathed issue",
    [malformedCidr],
    ([badCidr]) =>
      Effect.runSync(
        Effect.gen(function* () {
          const candidate = { ...validConfig, network: { ...validConfig.network, cidr: badCidr } }
          const failure = yield* Effect.flip(decodeConfig(candidate))

          return (
            Predicate.isTagged(failure, "ConfigInvalid") &&
            failure.issues.some((issue) => issue.path.join(".") === "network.cidr")
          )
        })
      )
  )

  it("accepts the autoscaling block on a worker pool (schema-level only)", () =>
    Effect.runPromise(decodeConfig(validConfig)).then((decoded) => {
      expect(decoded.worker_pools[1]?.autoscaling).toEqual({ enabled: false, min: 2, max: 6 })
    }))
})
