import { describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { FastCheck as fc } from "effect/testing"
import { decodeConfig } from "../../src/config/decode.ts"
import { validConfig } from "./fixtures.ts"

const distros = ["k3s", "ovh-mks"] as const
const dnsModules = ["ovh", "hetzner"] as const

const realDns = { zone: "example.com", ttl: 300, records: [{ name: "api.prod-eu", target: "api_server" }] }

// kumulo: version format is distro-dependent, so vary it with the distro to
// keep the version filter out of the way of the dns/distro property. `network`
// is dropped for ovh-mks: both distros declare one, but MKS's is a different
// struct (two subnets, no `public_access`), so the k3s block is not a valid
// ovh-mks block and would fail decode for reasons this property is not about.
const _forDistro = (distro: (typeof distros)[number]) => {
  const { network: _k3sOnly, ...withoutNetwork } = validConfig
  return distro === "k3s"
    ? { ...validConfig, distro, version: "v1.31.4+k3s1" }
    : { ...withoutNetwork, distro, version: "v1.31.4" }
}

describe("ClusterConfig — dns × distro", () => {
  it.prop(
    "accepts every real dns.module on every distro (dns is orthogonal to distro)",
    [fc.constantFrom(...distros), fc.constantFrom(...dnsModules)],
    ([distro, module]) =>
      Effect.runSync(
        Effect.gen(function* () {
          const candidate = { ..._forDistro(distro), dns: { ...realDns, module } }
          const result = yield* Effect.result(decodeConfig(candidate))
          return result._tag === "Success"
        })
      )
  )

  it.prop("accepts dns.module: none with no zone/ttl/records on every distro", [fc.constantFrom(...distros)], ([
    distro
  ]) =>
    Effect.runSync(
      Effect.gen(function* () {
        const candidate = { ..._forDistro(distro), dns: { module: "none" as const } }
        const result = yield* Effect.result(decodeConfig(candidate))
        return result._tag === "Success"
      })
    ))

  it.prop(
    "rejects the unimplemented designate module on every distro",
    [fc.constantFrom(...distros)],
    ([distro]) =>
      Effect.runSync(
        Effect.gen(function* () {
          const candidate = { ..._forDistro(distro), dns: { ...realDns, module: "designate" } }
          const failure = yield* Effect.flip(decodeConfig(candidate))
          return failure._tag === "ConfigInvalid"
        })
      )
  )

  it.prop("rejects a real dns.module without a zone", [fc.constantFrom(...dnsModules)], ([module]) =>
    Effect.runSync(
      Effect.gen(function* () {
        const { zone: _dropped, ...dns } = realDns
        const failure = yield* Effect.flip(decodeConfig({ ...validConfig, dns: { ...dns, module } }))
        return failure._tag === "ConfigInvalid"
      })
    ))
})
