import { describe, it } from "@effect/vitest"
import { Effect, Predicate, Result, Schema } from "effect"
import { decodeConfig } from "../../src/cluster-config.ts"
import { validConfig } from "./fixtures.ts"

const distros = ["k3s", "ovh-mks"] as const
const dnsModules = ["ovh", "hetzner", "bunny", "godaddy"] as const

const realDns = { zone: "example.com", ttl: 600, records: [{ name: "api.prod-eu", target: "api_server" }] }

const _forDistro = (distro: (typeof distros)[number]) => {
  const { network: _k3sOnly, ...withoutNetwork } = validConfig

  return distro === "k3s"
    ? { ...validConfig, distro, version: "v1.31.4+k3s1" }
    : { ...withoutNetwork, distro, version: "v1.31.4" }
}

describe("ClusterConfig — dns × distro", () => {
  it.prop(
    "accepts every real dns.module on every distro (dns is orthogonal to distro)",
    [Schema.Literals(distros), Schema.Literals(dnsModules)],
    ([distro, module]) =>
      Effect.runSync(
        Effect.gen(function* () {
          const candidate = { ..._forDistro(distro), dns: { ...realDns, module } }
          const result = yield* Effect.result(decodeConfig(candidate))

          return Result.isSuccess(result)
        })
      )
  )

  it.prop("accepts dns.module: none with no zone/ttl/records on every distro", [Schema.Literals(distros)], ([
    distro
  ]) =>
    Effect.runSync(
      Effect.gen(function* () {
        const candidate = { ..._forDistro(distro), dns: { module: "none" as const } }
        const result = yield* Effect.result(decodeConfig(candidate))

        return Result.isSuccess(result)
      })
    ))

  it.prop(
    "rejects the unimplemented designate module on every distro",
    [Schema.Literals(distros)],
    ([distro]) =>
      Effect.runSync(
        Effect.gen(function* () {
          const candidate = { ..._forDistro(distro), dns: { ...realDns, module: "designate" } }
          const failure = yield* Effect.flip(decodeConfig(candidate))

          return Predicate.isTagged(failure, "ConfigInvalid")
        })
      )
  )

  it.prop("rejects a real dns.module without a zone", [Schema.Literals(dnsModules)], ([module]) =>
    Effect.runSync(
      Effect.gen(function* () {
        const { zone: _dropped, ...dns } = realDns
        const failure = yield* Effect.flip(decodeConfig({ ...validConfig, dns: { ...dns, module } }))

        return Predicate.isTagged(failure, "ConfigInvalid")
      })
    ))
})
