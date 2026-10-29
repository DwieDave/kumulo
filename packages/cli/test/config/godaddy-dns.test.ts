import { describe, expect, it } from "@effect/vitest"
import { Effect, Result } from "effect"
import { decodeConfig } from "../../src/cluster-config.ts"
import { validConfig, validMksConfig, validUpcloudUksConfig } from "./fixtures.ts"

const bases = [
  ["k3s", validConfig],
  ["ovh-mks", validMksConfig],
  ["upcloud-uks", validUpcloudUksConfig]
] as const

const _dns = (ttl: number, records: ReadonlyArray<{ name: string; target: string }>) => ({
  module: "godaddy" as const,
  zone: "example.com",
  ttl,
  records
})

const _decode = (base: (typeof bases)[number][1], dns: ReturnType<typeof _dns>) =>
  Effect.runSync(Effect.result(decodeConfig({ ...base, dns })))

describe("godaddy dns config", () => {
  for (const [distro, base] of bases) {
    describe(distro, () => {
      it("accepts ttl 600 with a service target", () => {
        expect(Result.isSuccess(_decode(base, _dns(600, [{ name: "api", target: "api_server" }])))).toBe(true)
      })

      it("rejects ttl below 600", () => {
        const result = _decode(base, _dns(300, [{ name: "api", target: "api_server" }]))
        expect(Result.isFailure(result)).toBe(true)

        expect(JSON.stringify(result)).toContain("GoDaddy requires dns.ttl >= 600")
      })

      it("accepts apex records targeting IPs or service targets", () => {
        const records = [
          { name: "@", target: "203.0.113.7" },
          { name: "example.com", target: "2001:db8::1" },
          { name: "@", target: "ingress" }
        ]

        expect(Result.isSuccess(_decode(base, _dns(600, records)))).toBe(true)
      })

      it("rejects an apex record with a hostname target", () => {
        for (const name of ["@", "example.com"]) {
          const result = _decode(base, _dns(600, [{ name, target: "lb.example.net" }]))
          expect(Result.isFailure(result)).toBe(true)

          expect(JSON.stringify(result)).toContain("apex CNAME")
        }
      })

      it("accepts a non-apex hostname target", () => {
        expect(Result.isSuccess(_decode(base, _dns(600, [{ name: "www", target: "lb.example.net" }])))).toBe(true)
      })

      it("does not apply the ttl rule to other modules", () => {
        const result = Effect.runSync(
          Effect.result(decodeConfig({ ...base, dns: { ..._dns(300, []), module: "hetzner" } }))
        )

        expect(Result.isSuccess(result)).toBe(true)
      })
    })
  }
})
