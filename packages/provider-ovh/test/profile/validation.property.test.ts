import { Effect } from "effect"
import { FastCheck as fc } from "effect/testing"
import { it } from "@effect/vitest"
import type { ClusterConfigShape } from "@kumulo/core"
import { makeOvhProfile } from "../../src/profile/ovh.ts"
import { hasOctavia } from "../../src/profile/regions.ts"

const region = fc.constantFrom("GRA5", "BHS1", "made-up-region", "SBG5")
const volumeType = fc.constantFrom("classic", "high-speed", "high-speed-gen2", "bogus-type")

// Property: validation rejects a config iff either rule actually
// fires — never a false positive/negative against the two known checks.
it.prop("rejects exactly when Octavia is missing under HA, or the volume type is unsupported", [
  region,
  fc.boolean(),
  volumeType
], ([r, ha, vt]) =>
  Effect.gen(function*() {
    const profile = makeOvhProfile(r)
    const config: ClusterConfigShape = {
      distro: "k3s",
      worker_pools: [],
      addons: { cni: "flannel" },
      auth: { region: r },
      api_server: { high_availability: ha },
      volumes: { retained: [{ type: vt }] }
    }
    const expectedInvalid = (ha && !hasOctavia(r)) ||
      !["classic", "high-speed", "high-speed-gen2"].includes(vt)
    const result = yield* Effect.result(profile.validate(config))
    return (result._tag === "Failure") === expectedInvalid
  }).pipe(Effect.runSync))
