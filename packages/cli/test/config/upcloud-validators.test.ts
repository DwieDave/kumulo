import { describe, expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { decodeConfig } from "../../src/cluster-config.ts"
import { validUpcloudUksConfig } from "./fixtures.ts"

const _int = (minimum: number, maximum: number) => Schema.Int.check(Schema.isBetween({ minimum, maximum }))
const octet = _int(0, 255)
const okPrefix = _int(8, 29)

// exclusion check is masked-range overlap, not leading-octet inspection
const _EXCLUDED: ReadonlyArray<readonly [string, number]> = [
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["224.0.0.0", 4],
  ["169.254.0.0", 16],
  ["172.31.240.0", 24],
  ["10.128.0.0", 12],
  ["192.168.0.0", 16],
  ["10.33.128.0", 22],
  ["10.4.0.0", 16]
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

const _cidrOf = ([a, b, c, d, prefix]: readonly [number, number, number, number, number]) =>
  `${a}.${b}.${c}.${d}/${prefix}`

const okCidr = Schema.Tuple([octet, octet, octet, octet, okPrefix]).check(
  Schema.makeFilter(([a, b, c, d, prefix]) => !_overlapsExcluded(`${a}.${b}.${c}.${d}`, prefix))
)

const badPrefixCidr = Schema.Tuple([octet, octet, octet, octet, Schema.Union([_int(0, 7), _int(30, 32)])])

const excludedRangeCidr = Schema.Literals(["100.64.0.0/16", "127.0.0.0/16", "224.0.0.0/16", "169.254.0.0/16"])

const _decodesOk = (candidate: Schema.Json): boolean =>
  Effect.runSync(Effect.match(decodeConfig(candidate), { onFailure: () => false, onSuccess: () => true }))

describe("UpCloud network.cidr validator", () => {
  it.prop("accepts /8-/29 cidrs outside the excluded ranges", [okCidr], ([parts]) =>
    _decodesOk({ ...validUpcloudUksConfig, network: { cidr: _cidrOf(parts) } }))

  it.prop("rejects prefixes outside /8-/29", [badPrefixCidr], ([parts]) =>
    !_decodesOk({ ...validUpcloudUksConfig, network: { cidr: _cidrOf(parts) } }))

  it.prop("rejects cidrs inside UpCloud's excluded ranges", [excludedRangeCidr], ([cidr]) =>
    !_decodesOk({ ...validUpcloudUksConfig, network: { cidr } }))
})

const validNameChar = Schema.Literals([..."abcdefghijklmnopqrstuvwxyz0123456789"])

const okPoolName = Schema.Array(validNameChar).check(Schema.isBetweenLength(1, 54))

const _workerPoolsWith = (name: string) => [{ name, flavor: "2xCPU-4GB", count: 1 }]

describe("UpCloud pool-name validator", () => {
  it.prop("accepts lowercase/digit/hyphen names up to 54 chars, no leading/trailing hyphen", [okPoolName], ([chars]) =>
    _decodesOk({ ...validUpcloudUksConfig, worker_pools: _workerPoolsWith(chars.join("")) }))

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

const _failureMessage = (candidate: Schema.Json): string =>
  Effect.runSync(
    Effect.match(decodeConfig(candidate), { onFailure: (error) => error.issues.map((issue) => issue.message).join("; "), onSuccess: () => "" })
  )

describe("UKS reserved ranges", () => {
  it("rejects a cidr inside the pod range and names it", () => {
    const message = _failureMessage({ ...validUpcloudUksConfig, network: { cidr: "192.168.0.0/24" } })

    expect(message).toContain("POD CIDR 192.168.0.0/16")
  })

  it("rejects a cidr that covers the service range", () => {
    const message = _failureMessage({ ...validUpcloudUksConfig, network: { cidr: "10.0.0.0/8" } })

    expect(message).toContain("10.128.0.0/12")
  })

  it("accepts a private cidr clear of every reserved range", () => {
    expect(_decodesOk({ ...validUpcloudUksConfig, network: { cidr: "172.16.0.0/24" } })).toBe(true)
  })

  it("rejects the zone utility range only for that zone", () => {
    const network = { cidr: "10.4.1.0/24" }

    expect(_decodesOk({ ...validUpcloudUksConfig, zone: "de-fra1", network })).toBe(false)
    expect(_decodesOk({ ...validUpcloudUksConfig, zone: "fi-hel1", network })).toBe(true)
  })

  it("skips the utility check for an unknown zone", () => {
    expect(_decodesOk({ ...validUpcloudUksConfig, zone: "xx-new1", network: { cidr: "10.4.1.0/24" } })).toBe(true)
  })
})

describe("UKS cluster name and version", () => {
  it("rejects uppercase, underscores and short names", () => {
    expect(_decodesOk({ ...validUpcloudUksConfig, name: "Prod_EU" })).toBe(false)
    expect(_decodesOk({ ...validUpcloudUksConfig, name: "ab" })).toBe(false)
  })

  it("accepts a lowercase hyphenated name", () => {
    expect(_decodesOk({ ...validUpcloudUksConfig, name: "prod-eu" })).toBe(true)
  })

  it("rejects a v-prefixed version", () => {
    expect(_decodesOk({ ...validUpcloudUksConfig, version: "v1.31" })).toBe(false)
  })
})
