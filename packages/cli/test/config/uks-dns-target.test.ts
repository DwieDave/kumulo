import { describe, expect, it } from "@effect/vitest"
import { Effect, Result, Schema } from "effect"
import { decodeConfig } from "../../src/cluster-config.ts"
import { validConfig, validMksConfig, validUpcloudUksConfig } from "./fixtures.ts"

const dnsModules = ["ovh", "hetzner", "bunny", "godaddy"] as const

const literalTargets = ["203.0.113.7", "2001:db8::1", "lb-1234.upcloudlb.com", "api_server"] as const

const recordName = Schema.Literals(["*", "*.c1", "www", "api.staging-eu"])

const _uks = (module: (typeof dnsModules)[number], records: ReadonlyArray<{ name: string; target: string }>) => ({
  ...validUpcloudUksConfig,
  dns: { module, zone: "example.com", ttl: 600, records }
})

const _decode = (candidate: Schema.Json) => Effect.runSync(Effect.result(decodeConfig(candidate)))

describe("upcloud-uks dns record targets", () => {
  it.prop(
    "rejects target ingress at any position, naming the field",
    [Schema.Literals(dnsModules), recordName, Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 2 }))],
    ([module, name, before]) => {
      const records = [
        ...Array.from({ length: before }, (_, i) => ({ name: `host${i}`, target: "203.0.113.7" })),
        { name, target: "ingress" }
      ]

      const result = _decode(_uks(module, records))

      return Result.isFailure(result) && JSON.stringify(result).includes(`dns.records[${before}].target`)
    }
  )

  it.prop(
    "accepts literal IP and hostname targets on wildcard and plain names",
    [Schema.Literals(dnsModules), recordName, Schema.Literals(literalTargets)],
    ([module, name, target]) => Result.isSuccess(_decode(_uks(module, [{ name, target }])))
  )

  it("explains that upcloud-uks has no ingress load balancer", () => {
    const result = _decode(_uks("godaddy", [{ name: "*", target: "ingress" }]))

    expect(JSON.stringify(result)).toContain("upcloud-uks")
    expect(JSON.stringify(result)).toContain("literal IP or hostname")
  })

  it("keeps target ingress valid on k3s and ovh-mks", () => {
    const dns = { module: "ovh" as const, zone: "example.com", ttl: 600, records: [{ name: "*", target: "ingress" }] }

    expect(Result.isSuccess(_decode({ ...validConfig, dns }))).toBe(true)
    expect(Result.isSuccess(_decode({ ...validMksConfig, dns }))).toBe(true)
  })
})
