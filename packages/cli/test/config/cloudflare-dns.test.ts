import { describe, expect, it } from "@effect/vitest"
import { Effect, Result } from "effect"
import { decodeConfig } from "../../src/cluster-config.ts"
import { validConfig, validMksConfig, validUpcloudUksConfig } from "./fixtures.ts"

const bases = [
  ["k3s", validConfig],
  ["ovh-mks", validMksConfig],
  ["upcloud-uks", validUpcloudUksConfig]
] as const

const _dns = (ttl: number, records: ReadonlyArray<{ name: string; target: string }> = [{ name: "api", target: "api_server" }]) => ({
  module: "cloudflare" as const,
  zone: "example.com",
  ttl,
  records
})

const _decode = (base: (typeof bases)[number][1], dns: ReturnType<typeof _dns>) =>
  Effect.runSync(Effect.result(decodeConfig({ ...base, dns })))

describe("cloudflare dns config", () => {
  for (const [distro, base] of bases) {
    describe(distro, () => {
      it("accepts ttl 1 (automatic), 60, 300 and 86400", () => {
        for (const ttl of [1, 60, 300, 86400]) expect(Result.isSuccess(_decode(base, _dns(ttl)))).toBe(true)
      })

      it("rejects ttl 30 and 86401", () => {
        for (const ttl of [30, 86401]) {
          const result = _decode(base, _dns(ttl))
          expect(Result.isFailure(result)).toBe(true)
          expect(JSON.stringify(result)).toContain("Cloudflare requires dns.ttl to be 1 (automatic) or between 60 and 86400")
        }
      })

      it("accepts wildcard names and an apex hostname target", () => {
        const records = [{ name: "*.c1", target: "203.0.113.10" }, { name: "@", target: "lb.example.net" }]
        expect(Result.isSuccess(_decode(base, _dns(300, records)))).toBe(true)
      })
    })
  }
})
