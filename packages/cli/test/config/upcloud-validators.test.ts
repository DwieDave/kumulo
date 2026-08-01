import { describe, expect, it } from "@effect/vitest"
import { FastCheck as fc } from "effect/testing"
import { Effect } from "effect"
import { decodeConfig } from "../../src/cluster-config.ts"
import { validUpcloudUksConfig } from "./fixtures.ts"

const octet = fc.integer({ min: 0, max: 255 })
const okPrefix = fc.integer({ min: 8, max: 29 })
// exclusion check is masked-range overlap, not leading-octet inspection
const _EXCLUDED: ReadonlyArray<readonly [string, number]> = [
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["224.0.0.0", 4],
  ["169.254.0.0", 16]
]
const _rangeOf = (ip: string, bits: number): readonly [number, number] => {
  const size = 2 ** (32 - bits)
  const first = Math.floor(ip.split(".").reduce((acc, part) => acc * 256 + Number(part), 0) / size) * size
  return [first, first + size - 1]
}
const _overlapsExcluded = (ip: string, bits: number): boolean => {
  const [first, last] = _rangeOf(ip, bits)
  return _EXCLUDED.some(([rangeIp, rangeBits]) => {
    const [rangeFirst, rangeLast] = _rangeOf(rangeIp, rangeBits)
    return first <= rangeLast && last >= rangeFirst
  })
}

const okCidr = fc
  .tuple(octet, octet, octet, octet, okPrefix)
  .filter(([a, b, c, d, prefix]) => !_overlapsExcluded(`${a}.${b}.${c}.${d}`, prefix))
  .map(([a, b, c, d, prefix]) => `${a}.${b}.${c}.${d}/${prefix}`)

const badPrefixCidr = fc
  .tuple(octet, octet, octet, octet, fc.oneof(fc.integer({ min: 0, max: 7 }), fc.integer({ min: 30, max: 32 })))
  .map(([a, b, c, d, prefix]) => `${a}.${b}.${c}.${d}/${prefix}`)

const excludedRangeCidr = fc.constantFrom(
  "100.64.0.0/16",
  "127.0.0.0/16",
  "224.0.0.0/16",
  "169.254.0.0/16"
)

const _decodesOk = (candidate: unknown): boolean =>
  Effect.runSync(Effect.match(decodeConfig(candidate), { onFailure: () => false, onSuccess: () => true }))

describe("UpCloud network.cidr validator", () => {
  it.prop("accepts /8-/29 cidrs outside the excluded ranges", [okCidr], ([cidr]) =>
    _decodesOk({ ...validUpcloudUksConfig, network: { cidr } }))

  it.prop("rejects prefixes outside /8-/29", [badPrefixCidr], ([cidr]) =>
    !_decodesOk({ ...validUpcloudUksConfig, network: { cidr } }))

  it.prop("rejects cidrs inside UpCloud's excluded ranges", [excludedRangeCidr], ([cidr]) =>
    !_decodesOk({ ...validUpcloudUksConfig, network: { cidr } }))
})

const validNameChar = fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789")
const okPoolName = fc
  .array(validNameChar, { minLength: 1, maxLength: 54 })
  .map((chars) => chars.join(""))
  .filter((name) => !name.startsWith("-") && !name.endsWith("-"))

const _workerPoolsWith = (name: string) => [{ name, flavor: "2xCPU-4GB", count: 1 }]

describe("UpCloud pool-name validator", () => {
  it.prop("accepts lowercase/digit/hyphen names up to 54 chars, no leading/trailing hyphen", [okPoolName], ([name]) =>
    _decodesOk({ ...validUpcloudUksConfig, worker_pools: _workerPoolsWith(name) }))

  it.effect("rejects a name over 54 characters", () =>
    Effect.gen(function*() {
      const name = "a".repeat(55)
      const failure = yield* Effect.flip(
        decodeConfig({ ...validUpcloudUksConfig, worker_pools: _workerPoolsWith(name) })
      )
      expect(failure._tag).toBe("ConfigInvalid")
    }))

  it.effect("rejects uppercase characters", () =>
    Effect.gen(function*() {
      const failure = yield* Effect.flip(
        decodeConfig({ ...validUpcloudUksConfig, worker_pools: _workerPoolsWith("General") })
      )
      expect(failure._tag).toBe("ConfigInvalid")
    }))

  it.effect("rejects a leading hyphen", () =>
    Effect.gen(function*() {
      const failure = yield* Effect.flip(
        decodeConfig({ ...validUpcloudUksConfig, worker_pools: _workerPoolsWith("-general") })
      )
      expect(failure._tag).toBe("ConfigInvalid")
    }))

  it.effect("rejects a trailing hyphen", () =>
    Effect.gen(function*() {
      const failure = yield* Effect.flip(
        decodeConfig({ ...validUpcloudUksConfig, worker_pools: _workerPoolsWith("general-") })
      )
      expect(failure._tag).toBe("ConfigInvalid")
    }))
})
