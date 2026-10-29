import { Effect, Result, Schema } from "effect"
import { it } from "@effect/vitest"
import type { ClusterConfigFields } from "@kumulo/core"
import { makeOvhProfile } from "../../src/profile/ovh.ts"
import { hasOctavia } from "../../src/profile/regions.ts"

const region = Schema.Literals(["GRA5", "BHS1", "made-up-region", "SBG5"])
const volumeType = Schema.Literals(["classic", "high-speed", "high-speed-gen2", "bogus-type"])

// Property: validation rejects a config iff either rule actually
// fires — never a false positive/negative against the two known checks.
it.prop("rejects exactly when Octavia is missing under HA, or the volume type is unsupported", [
  region,
  Schema.Boolean,
  volumeType
], ([r, ha, vt]) =>
  Effect.gen(function*() {
    const profile = makeOvhProfile(r)

    const config: ClusterConfigFields = {
      distro: "k3s",
      worker_pools: [],
      addons: { cni: "flannel" },
      auth: { region: r },
      api_server: { high_availability: ha },
      volumes: { managed: [{ type: vt }] }
    }

    const expectedInvalid = (ha && !hasOctavia(r)) ||
      !["classic", "high-speed", "high-speed-gen2"].includes(vt)

    const result = yield* Effect.result(profile.validate(config))

    return Result.isFailure(result) === expectedInvalid
  }).pipe(Effect.runSync))
