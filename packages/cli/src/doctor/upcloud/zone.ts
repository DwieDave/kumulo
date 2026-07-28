import { Effect } from "effect"
import type { ZoneClient } from "@kumulo/upcloud"
import type { DoctorCheck } from "../types.ts"

const _name = "upcloud-zone-exists"

/**
 * Zone validity, asked of UpCloud rather than compared against a list kumulo
 * keeps. The hand-transcribed set this replaced held 13 entries against
 * intent.md's own count of 15 — a doctor that fails a perfectly valid zone is
 * worse than one that never ran, and any static list rots the moment UpCloud
 * opens a location.
 *
 * kumulo: private-cloud zones (`public: "no"`) are excluded — a normal account
 * cannot place a cluster in one, so accepting it would move the failure to
 * apply time.
 */
export const zoneExistsCheck = (
  { zone, zones }: { readonly zone: string; readonly zones: ZoneClient }
): DoctorCheck => ({
  name: _name,
  run: zones.list().pipe(
    Effect.map((known) => {
      const usable = known.filter((entry) => entry.public !== "no").map((entry) => entry.id)
      return usable.includes(zone)
        ? { name: _name, status: "pass" as const, message: `Zone "${zone}" exists.` }
        : {
          name: _name,
          status: "fail" as const,
          message: `Zone "${zone}" is not one of UpCloud's zones (${usable.join(", ")}).`
        }
    }),
    // kumulo: `DoctorCheckResult` is pass/fail only, so an unreachable endpoint
    // reports as a fail — but the message says the zone could not be *verified*
    // rather than claiming it is invalid, which would be a diagnosis this check
    // has no evidence for. The auth check alongside it names the real cause.
    Effect.catch(() =>
      Effect.succeed({
        name: _name,
        status: "fail" as const,
        message: `Could not list UpCloud zones to verify "${zone}" — the zone may be fine; check the API token first.`
      })
    )
  )
})
