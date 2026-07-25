import { describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { FastCheck as fc } from "effect/testing"
import { decodeConfig } from "../../src/config/decode.ts"
import { validConfig } from "./fixtures.ts"

const distros = ["k3s", "ovh-mks"] as const
const dnsModules = ["none", "hetzner", "ovh", "designate"] as const

// kumulo: version format is distro-dependent, so vary it with the distro to
// keep the version filter out of the way of the dns/distro property.
const _candidateFor = (distro: (typeof distros)[number], module: (typeof dnsModules)[number]) => ({
  ...validConfig,
  distro,
  version: distro === "k3s" ? "v1.31.4+k3s1" : "v1.31.4",
  dns: { ...validConfig.dns, module }
})

const _isAllowed = (distro: (typeof distros)[number], module: (typeof dnsModules)[number]) =>
  module === "none" || module === "hetzner" || distro === "k3s"

describe("ClusterConfig — dns.module × distro", () => {
  it.prop(
    "accepts exactly the wired dns.module/distro combinations",
    [fc.constantFrom(...distros), fc.constantFrom(...dnsModules)],
    ([distro, module]) =>
      Effect.runSync(
        Effect.gen(function* () {
          const result = yield* Effect.result(decodeConfig(_candidateFor(distro, module)))
          return (result._tag === "Success") === _isAllowed(distro, module)
        })
      )
  )

  it.prop(
    "rejects ovh/designate on ovh-mks with an issue pathed at dns.module",
    [fc.constantFrom("ovh" as const, "designate" as const)],
    ([module]) =>
      Effect.runSync(
        Effect.gen(function* () {
          const failure = yield* Effect.flip(decodeConfig(_candidateFor("ovh-mks", module)))
          return (
            failure._tag === "ConfigInvalid" &&
            failure.issues.some((issue) => issue.path.join(".") === "dns.module")
          )
        })
      )
  )
})
