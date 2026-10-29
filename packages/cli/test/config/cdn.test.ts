import { describe, expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { decodeConfig } from "../../src/cluster-config.ts"
import { validConfig, validMksConfig, validMksNetwork, validUpcloudUksConfig } from "./fixtures.ts"

type Json = typeof Schema.Json.Type

const age = "age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqql4pcnf"

const _cdn = (overrides: Record<string, Json> = {}) => ({
  module: "bunny",
  name: "stagingeu",
  origin: { url: "https://203.0.113.10" },
  hostnames: ["app.example.com"],
  ...overrides
})

const _decodes = (input: Json) => decodeConfig(input).pipe(Effect.as(true), Effect.orElseSucceed(() => false))

const _shield = (extra: Record<string, Json>) => ({
  plan: "basic",
  waf: { enabled: true, mode: "log" },
  ddos: { sensitivity: "medium" },
  bot_detection: { mode: "log", sensitivity: "low" },
  rate_limits: [],
  access_lists: [],
  ...extra
})

const _limit = (name: string) => ({ name, path_prefix: "/x", requests: 20, window: 60, block_for: 300, key: "ip" })
const _list = (name: string) => ({ name, type: "cidr", action: "allow", entries: ["198.51.100.0/24"] })

describe("cdn block", () => {
  it.effect("applies D11 defaults", () =>
    Effect.gen(function* () {
      const decoded = yield* decodeConfig({ ...validConfig, cdn: _cdn() })
      expect(decoded.cdn).toMatchObject({
        tier: "standard",
        verify_origin_tls: false,
        websockets: true,
        cache: "smart",
        force_ssl: true
      })
    }))

  it.effect("accepts module none and an absent block on every distro", () =>
    Effect.gen(function* () {
      expect(yield* _decodes({ ...validConfig, cdn: { module: "none" } })).toBe(true)
      expect(yield* _decodes(validMksConfig)).toBe(true)
      expect(yield* _decodes({ ...validUpcloudUksConfig, cdn: _cdn() })).toBe(true)
    }))

  it.effect("rejects invalid names, tiers, caches and hostname counts", () =>
    Effect.gen(function* () {
      const bad = [
        _cdn({ name: "has-dash" }),
        _cdn({ tier: "premium" }),
        _cdn({ cache: "all" }),
        _cdn({ hostnames: [] }),
        _cdn({ hostnames: ["a.example.com", "a.example.com"] }),
        _cdn({ hostnames: Array.from({ length: 11 }, (_, i) => `h${i}.example.com`) })
      ]

      for (const cdn of bad) expect(yield* _decodes({ ...validConfig, cdn })).toBe(false)
    }))

  it.effect("accepts exactly ten hostnames", () =>
    Effect.gen(function* () {
      const hostnames = Array.from({ length: 10 }, (_, i) => `h${i}.example.com`)
      expect(yield* _decodes({ ...validConfig, cdn: _cdn({ hostnames }) })).toBe(true)
    }))

  it.effect("origin ingress is rejected on k3s and upcloud-uks", () =>
    Effect.gen(function* () {
      expect(yield* _decodes({ ...validConfig, cdn: _cdn({ origin: "ingress" }) })).toBe(false)
      expect(yield* _decodes({ ...validUpcloudUksConfig, cdn: _cdn({ origin: "ingress" }) })).toBe(false)
    }))

  it.effect("origin ingress on ovh-mks needs an ingress block", () =>
    Effect.gen(function* () {
      const cdn = _cdn({ origin: "ingress" })
      expect(yield* _decodes({ ...validMksConfig, cdn })).toBe(false)
      expect(yield* _decodes({ ...validMksConfig, network: validMksNetwork, ingress: {}, cdn })).toBe(true)
    }))

  it.effect("shield names must be unique", () =>
    Effect.gen(function* () {
      const ok = _shield({ rate_limits: [_limit("a"), _limit("b")], access_lists: [_list("a"), _list("b")] })
      expect(yield* _decodes({ ...validConfig, cdn: _cdn({ shield: ok }) })).toBe(true)
      const dupLimits = _shield({ rate_limits: [_limit("a"), _limit("a")] })
      expect(yield* _decodes({ ...validConfig, cdn: _cdn({ shield: dupLimits }) })).toBe(false)
      const dupLists = _shield({ access_lists: [_list("a"), _list("a")] })
      expect(yield* _decodes({ ...validConfig, cdn: _cdn({ shield: dupLists }) })).toBe(false)
    }))

  it.effect("apex hostname requires dns module bunny", () =>
    Effect.gen(function* () {
      const cdn = _cdn({ hostnames: ["example.com"] })
      expect(yield* _decodes({ ...validConfig, cdn })).toBe(false)
      const bunnyDns = { module: "bunny", zone: "example.com", ttl: 300, records: [] }
      expect(yield* _decodes({ ...validConfig, dns: bunnyDns, cdn })).toBe(true)
      expect(yield* _decodes({ ...validConfig, dns: { module: "none" }, cdn: _cdn() })).toBe(true)
    }))

  it.effect("secrets sops still required for bunny storage", () =>
    Effect.gen(function* () {
      const storage = { module: "bunny", buckets: [{ name: "my-bucket", region: "DE", retain: true }] }
      expect(yield* _decodes({ ...validConfig, object_storage: storage, secrets: { sink: "none" } })).toBe(false)
      const secrets = { sink: "sops", dir: ".", sops: { age_recipient: age } }

      for (const base of [validConfig, validUpcloudUksConfig])
        expect(yield* _decodes({ ...base, object_storage: storage, secrets })).toBe(true)
    }))

  it.effect("bunny bucket name and region are validated", () =>
    Effect.gen(function* () {
      const secrets = { sink: "sops", dir: ".", sops: { age_recipient: age } }

      const withBucket = (bucket: Record<string, Json>) => ({
        ...validConfig,
        secrets,
        object_storage: { module: "bunny", buckets: [{ retain: false, ...bucket }] }
      })

      expect(yield* _decodes(withBucket({ name: "abc", region: "DE" }))).toBe(false)
      expect(yield* _decodes(withBucket({ name: "ab_cd", region: "DE" }))).toBe(false)
      expect(yield* _decodes(withBucket({ name: "abcd", region: "XX" }))).toBe(false)
      expect(yield* _decodes(withBucket({ name: "abcd", region: "DE", tier: "cold" }))).toBe(false)

      for (const region of ["DE", "NY", "SG", "UK", "SE", "LA", "JH", "SYD"])

        for (const tier of ["standard", "edge"])
          expect(yield* _decodes(withBucket({ name: "ab-1", region, tier }))).toBe(true)
    }))

  it.effect("dns module bunny decodes", () =>
    Effect.gen(function* () {
      const dns = { module: "bunny", zone: "example.com", ttl: 300, records: [] }
      expect(yield* _decodes({ ...validConfig, dns })).toBe(true)
      expect(Schema.is(Schema.Literal("bunny"))("bunny")).toBe(true)
    }))
})
