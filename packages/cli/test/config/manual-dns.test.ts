import { describe, it } from "@effect/vitest"
import { Effect, Result, Schema } from "effect"
import { decodeConfig } from "../../src/cluster-config.ts"
import { validConfig, validUpcloudUksConfig } from "./fixtures.ts"

const distros = ["k3s", "ovh-mks", "upcloud-uks"] as const

const _forDistro = (distro: (typeof distros)[number]) => {
  const { network: _k3sOnly, ...withoutNetwork } = validConfig

  if (distro === "upcloud-uks") return validUpcloudUksConfig

  return distro === "k3s"
    ? { ...validConfig, distro, version: "v1.31.4+k3s1" }
    : { ...withoutNetwork, distro, version: "v1.31.4" }
}

const _decode = (candidate: Schema.Json) => Effect.runSync(Effect.result(decodeConfig(candidate)))

describe("dns.module: none", () => {
  it.prop("accepts an optional zone on every distro", [Schema.Literals(distros)], ([distro]) => {
    const result = _decode({ ..._forDistro(distro), dns: { module: "none", zone: "example.com" } })

    return Result.isSuccess(result) && JSON.stringify(result.success.dns) === JSON.stringify({ module: "none", zone: "example.com" })
  })

  it("decodes a bare none exactly as before", ({ expect }) => {
    const result = _decode({ ...validConfig, dns: { module: "none" } })

    expect(Result.isSuccess(result) ? result.success.dns : undefined).toEqual({ module: "none" })
  })

  it("rejects an empty zone", ({ expect }) => {
    expect(Result.isFailure(_decode({ ...validConfig, dns: { module: "none", zone: "" } }))).toBe(true)
  })

  it("accepts a cdn hostname at the zone apex: none writes no apex record, so bunny DNS is not needed", ({ expect }) => {
    const result = _decode({
      ...validConfig,
      dns: { module: "none", zone: "example.com" },
      cdn: { module: "bunny", name: "stagingeu", origin: { url: "https://203.0.113.10" }, hostnames: ["example.com"] }
    })

    expect(Result.isSuccess(result)).toBe(true)
  })

  it("still requires bunny DNS for a cdn apex hostname with a managed module", ({ expect }) => {
    const result = _decode({
      ...validConfig,
      dns: { module: "hetzner", zone: "example.com", ttl: 300, records: [] },
      cdn: { module: "bunny", name: "stagingeu", origin: { url: "https://203.0.113.10" }, hostnames: ["example.com"] }
    })

    expect(Result.isFailure(result) && JSON.stringify(result.failure).includes("requires dns.module bunny")).toBe(true)
  })
})
