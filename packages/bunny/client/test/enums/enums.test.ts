import { Effect, Exit, Schema } from "effect"
import { assert, describe, it } from "@effect/vitest"
import * as E from "../../src/enums.ts"

const _decode = <A, I>(codec: Schema.Codec<A, I>) => (input: I): A => Effect.runSync(Schema.decodeEffect(codec)(input))

const _encode = <A, I>(codec: Schema.Codec<A, I>) => (input: A): I => Effect.runSync(Schema.encodeEffect(codec)(input))

const _spec = [
  ["DnsRecordType", E.BunnyDnsRecordType, [[0, "A"], [1, "AAAA"], [2, "CNAME"], [3, "TXT"], [7, "PullZone"], [15, "TLSA"]]],
  ["StorageZoneTier", E.BunnyStorageZoneTier, [[0, "Standard"], [1, "Edge"]]],
  ["StorageZoneType", E.BunnyStorageZoneType, [[0, "NotSupported"], [1, "Supported"]]],
  ["PullZoneType", E.BunnyPullZoneType, [[0, "Premium"], [1, "Volume"]]],
  ["PullZoneOriginType", E.BunnyPullZoneOriginType, [[0, "OriginUrl"], [2, "StorageZone"], [6, "PushZone"]]],
  ["OriginType", E.BunnyOriginType, [[0, "Standard"], [3, "MagicContainer"]]],
  ["ShieldDDosProtectionType", E.BunnyShieldDDosProtectionType, [[0, "DetectOnly"], [2, "ActiveAggressive"]]],
  ["ShieldPlan", E.BunnyShieldPlan, [[0, "Basic"], [1, "Advanced"], [3, "Enterprise"]]],
  ["WafMode", E.BunnyWafMode, [[0, "Log"], [1, "Block"]]],
  ["DDoSExecutionMode", E.BunnyDDoSExecutionMode, [[0, "Log"], [1, "Block"]]],
  ["DDoSSensitivity", E.BunnyDDoSSensitivity, [[0, "Off"], [4, "Challenge"], [5, "ChallengeInteractive"]]],
  ["RateLimitTimeframe", E.BunnyRateLimitTimeframe, [[1, "PerSecond"], [60, "PerOneMinute"], [3600, "PerOneHour"]]],
  ["RateLimitBlockTime", E.BunnyRateLimitBlockTime, [[30, "ForThirtySeconds"], [1800, "ForThirtyMinutes"], [3600, "ForOneHour"]]],
  ["RateLimitCounterKey", E.BunnyRateLimitCounterKey, [[0, "IP"], [4, "ASN"], [7, "IP_JA4"]]],
  ["AccessListType", E.BunnyAccessListType, [[0, "IP"], [1, "CIDR"], [5, "JA4"]]],
  ["AccessListAction", E.BunnyAccessListAction, [[0, "None"], [2, "Block"], [5, "Bypass"]]],
  ["BotDetectionExecutionMode", E.BunnyBotDetectionExecutionMode, [[0, "LogOnly"], [1, "Challenge"]]],
  ["BotDetectionSensitivity", E.BunnyBotDetectionSensitivity, [[0, "Off"], [3, "High"]]]
] as const

describe("enum codecs", () => {
  for (const [label, codec, pairs] of _spec) {
    it(`${label} decodes the spec integers to names and encodes back`, () => {
      for (const [int, name] of pairs) {
        assert.strictEqual(_decode(codec)(int), name)
        assert.strictEqual(_encode(codec)(name), int)
      }
    })

    it(`${label} rejects unknown integers and non-numbers`, () => {
      assert.isTrue(Exit.isFailure(Effect.runSyncExit(Schema.decodeUnknownEffect(codec)(9999))))
      assert.isTrue(Exit.isFailure(Effect.runSyncExit(Schema.decodeUnknownEffect(codec)("A"))))
    })

    it.prop(`${label} round-trips every name`, [Schema.Literals(pairs.map(([, name]) => name))], ([name]) =>
      Effect.runSync(
        Effect.gen(function*() {
          const int = yield* Schema.encodeUnknownEffect(codec)(name)
          const back = yield* Schema.decodeUnknownEffect(codec)(int)

          return back === name
        })
      ))
  }

  it("encodes every DnsRecordType to its distinct integer 0..15", () => {
    const names: ReadonlyArray<E.BunnyDnsRecordType> = ["A", "AAAA", "CNAME", "TXT", "MX", "Redirect", "Flatten", "PullZone", "SRV", "CAA", "PTR", "Script", "NS", "SVCB", "HTTPS", "TLSA"]
    assert.deepStrictEqual(names.map((n) => _encode(E.BunnyDnsRecordType)(n)), names.map((_, i) => i))
  })

  it.prop("RateLimitTimeframe integers round-trip", [Schema.Literals([1, 10, 60, 300, 900, 3600])], ([int]) =>
    _encode(E.BunnyRateLimitTimeframe)(_decode(E.BunnyRateLimitTimeframe)(int)) === int)
})
