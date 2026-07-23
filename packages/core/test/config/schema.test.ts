import { describe, expect, it } from "@effect/vitest"
import { FastCheck as fc } from "effect/testing"
import { Effect } from "effect"
import { decodeConfig, encodeConfig } from "../../src/config/decode.ts"
import { validConfig } from "./fixtures.ts"

const oddMasterCount = fc.integer({ min: 0, max: 20 }).map((n) => n * 2 + 1)
const octet = fc.integer({ min: 0, max: 255 })
const cidr = fc
  .tuple(octet, octet, octet, octet, fc.integer({ min: 0, max: 32 }))
  .map(([a, b, c, d, prefix]) => `${a}.${b}.${c}.${d}/${prefix}`)

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
    [oddMasterCount, cidr],
    ([count, networkCidr]) =>
      Effect.runSync(
        Effect.gen(function* () {
          const candidate = {
            ...validConfig,
            masters: { ...validConfig.masters, count },
            network: { ...validConfig.network, cidr: networkCidr }
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
    [fc.integer({ min: 0, max: 20 }).map((n) => n * 2)],
    ([count]) =>
      Effect.runSync(
        Effect.gen(function* () {
          const candidate = { ...validConfig, masters: { ...validConfig.masters, count } }
          const failure = yield* Effect.flip(decodeConfig(candidate))
          return (
            failure._tag === "ConfigInvalid" &&
            failure.issues.some((issue) => issue.path.join(".") === "masters.count")
          )
        })
      )
  )

  it.prop(
    "rejects malformed network.cidr strings with a pathed issue",
    [fc.string().filter((s) => !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/.test(s))],
    ([badCidr]) =>
      Effect.runSync(
        Effect.gen(function* () {
          const candidate = { ...validConfig, network: { ...validConfig.network, cidr: badCidr } }
          const failure = yield* Effect.flip(decodeConfig(candidate))
          return (
            failure._tag === "ConfigInvalid" &&
            failure.issues.some((issue) => issue.path.join(".") === "network.cidr")
          )
        })
      )
  )

  it("accepts the autoscaling block on a worker pool (schema-level only, per FR-1.3)", () =>
    Effect.runPromise(decodeConfig(validConfig)).then((decoded) => {
      expect(decoded.worker_pools[1]?.autoscaling).toEqual({ enabled: false, min: 2, max: 6 })
    }))
})
